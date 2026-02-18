/**
 * Embeddings Service - Generates embeddings via Gemini API and stores in Qdrant
 */
import type { TextChunk } from "./chunker";
import { logger } from "./_core/logger";
import { incMetric, recordTiming } from "./_core/metrics";
import { ensureCollection as ensureQdrantCollection, upsertPoints as qdrantUpsertPoints, searchCollection as qdrantSearchCollection } from "./vector/qdrant";
import pLimit from "p-limit";
import { randomUUID } from "crypto";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_EMBED_URL =
  process.env.GEMINI_EMBED_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const GEMINI_BATCH_EMBED_URL =
  process.env.GEMINI_BATCH_EMBED_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:asyncBatchEmbedContent";

const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION || "768");
const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || "50"); // Gemini batch limit
const MAX_RETRIES = Number(process.env.EMBEDDING_MAX_RETRIES || "3");
const RETRY_BACKOFF_BASE_MS = Number(process.env.EMBEDDING_RETRY_BASE_MS || "300");
const EMBEDDING_CONCURRENCY = Number(process.env.EMBEDDING_CONCURRENCY || "1");

export async function fetchWithRetry(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let lastError: any = null;
  for (let attempt = 0; attempt < Math.max(1, MAX_RETRIES); attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      lastError = new Error(`HTTP ${res.status}: ${text}`);
      logger.warn({ attempt, status: res.status, url: String(input) }, "fetchWithRetry non-ok response");
    } catch (err: any) {
      lastError = err;
      logger.warn({ attempt, err: String(err), url: String(input) }, "fetchWithRetry network error");
    }
    // backoff with jitter
    const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw lastError || new Error("fetchWithRetry failed");
}

/** Generate embedding for a single text using Gemini API */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const payload = {
    model: "models/gemini-embedding-001",
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  };

  const res = await fetchWithRetry(GEMINI_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return data.embedding?.values || [];
}

/** Generate embeddings for a batch of texts using Gemini API */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  if (texts.length === 0) return [];
  incMetric("embedding_batch_jobs_started");
  const pollIntervalMs = Number(process.env.EMBEDDING_ASYNC_POLL_INTERVAL_MS || "1000");
  const maxMs = Number(process.env.EMBEDDING_ASYNC_TIMEOUT_MS || "60000");

  const tryAsyncBatch = async (): Promise<number[][] | null> => {
    // 1) Try JSON array payload (requests)
    try {
      const requests = texts.map((text) => ({
        input: { text },
      }));
      const startMs = Date.now();
      const res = await fetchWithRetry(GEMINI_BATCH_EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({ requests, model: "models/gemini-embedding-001" }),
      });
      recordTiming("embedding_batch_request_ms", Date.now() - startMs);
      if (!res) throw new Error("no response from batch endpoint");
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.done && body.response) {
          const embeddings = extractEmbeddingsFromOperationResponse(body.response);
          if (embeddings) {
            incMetric("embedding_batch_jobs_succeeded");
            return embeddings;
          }
        }
        const opName = body?.name || body?.operation?.name || body?.operationName || body?.operation?.operationId;
        if (opName) {
          const base = GEMINI_BATCH_EMBED_URL.replace(/\/models\/.*$/, "");
          const opUrl = `${base}/operations/${encodeURIComponent(opName)}`;
          const start = Date.now();
          let attempt = 0;
          while (Date.now() - start < maxMs) {
            await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs * Math.pow(2, attempt), 5000)));
            attempt++;
            const pollRes = await fetchWithRetry(opUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
            });
            if (!pollRes.ok) continue;
            const pollBody = await pollRes.json().catch(() => null);
            if (pollBody?.done && pollBody?.response) {
              const embeddings = extractEmbeddingsFromOperationResponse(pollBody.response);
              if (embeddings) {
                incMetric("embedding_batch_jobs_succeeded");
                recordTiming("embedding_batch_job_poll_ms", Date.now() - start);
                return embeddings;
              }
              break;
            }
          }
          incMetric("embedding_batch_jobs_timedout");
          return null;
        }
        const extracted = extractEmbeddingsFromOperationResponse(body);
        if (extracted) {
          incMetric("embedding_batch_jobs_succeeded");
          return extracted;
        }
      } else {
        const txt = await res.text().catch(() => "");
        logger.warn({ status: res.status, body: txt }, "async batch json payload returned non-ok");
      }
    } catch (err: any) {
      logger.warn({ err: String(err) }, "async batch json payload failed");
    }

    // 2) Try NDJSON / JSONL payload shape
    try {
      const lines = texts.map((text, idx) =>
        JSON.stringify({
          key: `r${idx}`,
          request: {
            content: { parts: [{ text }] },
          },
        })
      );
      const ndjson = lines.join("\n");
      const startMs = Date.now();
      const res = await fetchWithRetry(GEMINI_BATCH_EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: ndjson,
      });
      recordTiming("embedding_batch_request_ms", Date.now() - startMs);
      if (!res) throw new Error("no response from batch endpoint (ndjson)");
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const opName = body?.name || body?.operation?.name;
        if (body && Array.isArray(body.responses) && body.responses.length) {
          const embeddings = body.responses.map((r: any) => r.embedding?.values || []);
          incMetric("embedding_batch_jobs_succeeded");
          return embeddings;
        }
        if (opName) {
          const base = GEMINI_BATCH_EMBED_URL.replace(/\/models\/.*$/, "");
          const opUrl = `${base}/operations/${encodeURIComponent(opName)}`;
          const start = Date.now();
          let attempt = 0;
          while (Date.now() - start < maxMs) {
            await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs * Math.pow(2, attempt), 5000)));
            attempt++;
            const pollRes = await fetchWithRetry(opUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
            });
            if (!pollRes.ok) continue;
            const pollBody = await pollRes.json().catch(() => null);
            if (pollBody?.done && pollBody?.response) {
              const embeddings = extractEmbeddingsFromOperationResponse(pollBody.response);
              if (embeddings) {
                incMetric("embedding_batch_jobs_succeeded");
                recordTiming("embedding_batch_job_poll_ms", Date.now() - start);
                return embeddings;
              }
              break;
            }
          }
          incMetric("embedding_batch_jobs_timedout");
          return null;
        }
      } else {
        const txt = await res.text().catch(() => "");
        logger.warn({ status: res.status, body: txt }, "async batch ndjson payload returned non-ok");
      }
    } catch (err: any) {
      logger.warn({ err: String(err) }, "async batch ndjson payload failed");
    }

    return null;
  };

  const startAll = Date.now();
  const asyncResult = await tryAsyncBatch();
  recordTiming("embedding_batch_total_attempt_ms", Date.now() - startAll);
  if (asyncResult && asyncResult.length === texts.length) {
    return asyncResult;
  }
  incMetric("embedding_batch_jobs_failed_async");
  logger.warn("asyncBatchEmbedContent did not produce a complete result; falling back to per-item embeddings");

  // Per-item embedding fallback with concurrency and retries
  const limit = pLimit(EMBEDDING_CONCURRENCY);
  const results: (number[] | null)[] = await Promise.all(
    texts.map((text, idx) =>
      limit(async () => {
        for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES); attempt++) {
          try {
            const emb = await generateEmbedding(text);
            return emb;
          } catch (err: any) {
            logger.warn({ attempt, err: String(err), index: idx }, "per-item embedding failed, retrying");
            if (attempt < Math.max(1, MAX_RETRIES)) {
              const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
              await new Promise((r) => setTimeout(r, backoff));
            } else {
              logger.error({ err: String(err), index: idx }, "per-item embedding exhausted retries");
              return null;
            }
          }
        }
        return null;
      })
    )
  );

  const failed = results.filter((r) => r === null).length;
  if (failed > 0) {
    logger.error({ failed, total: texts.length }, "per-item fallback encountered failures");
    incMetric("embedding_batch_jobs_failed_per_item");
    throw new Error(`Per-item fallback failed for ${failed}/${texts.length} items`);
  }

  incMetric("embedding_batch_fallback_per_item_used");
  return results.map((r) => r as number[]);
}

function extractEmbeddingsFromOperationResponse(resp: any): number[][] | null {
  if (resp?.result?.embeddings && Array.isArray(resp.result.embeddings)) {
    return resp.result.embeddings.map((e: any) => e.values || []);
  }
  if (resp?.embeddings && Array.isArray(resp.embeddings)) {
    return resp.embeddings.map((e: any) => e.values || []);
  }
  if (resp?.output?.embeddings && Array.isArray(resp.output.embeddings)) {
    return resp.output.embeddings.map((e: any) => e.values || []);
  }
  return null;
}

/** Store chunks with embeddings in Qdrant */
export async function storeChunks(
  collectionName: string,
  chunks: TextChunk[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ stored: number; errors: number }> {
  await ensureQdrantCollection(collectionName, EMBEDDING_DIMENSION);

  const seen = new Set<string>();
  const filtered = chunks.filter((c) => {
    const key = c.text.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const limit = pLimit(EMBEDDING_CONCURRENCY);
  const tasks: Promise<{ stored: number; errors: number }>[] = [];
  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batchIndex = i;
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    const task = limit(async () => {
      try {
        const embeddings = await generateBatchEmbeddings(texts);
        const points = batch.map((c, idx) => ({
          id: randomUUID(),
          vector: embeddings[idx],
          payload: { text: texts[idx], ...c.metadata },
        }));

        await qdrantUpsertPoints(collectionName, points);
        if (onProgress) onProgress(Math.min(batchIndex + BATCH_SIZE, filtered.length), filtered.length);
        return { stored: batch.length, errors: 0 };
      } catch (error: any) {
        logger.error({ err: String(error), index: batchIndex }, `[Embeddings] Batch error at index ${batchIndex}`);
        if (onProgress) onProgress(Math.min(batchIndex + BATCH_SIZE, filtered.length), filtered.length);
        return { stored: 0, errors: batch.length };
      }
    });

    tasks.push(task);
  }

  const results = await Promise.all(tasks);
  const stored = results.reduce((s, r) => s + r.stored, 0);
  const errors = results.reduce((e, r) => e + r.errors, 0);
  return { stored, errors };
}

/** @deprecated Use storeChunks instead */
export const storeChunksInChroma = storeChunks;

/** Query Qdrant for similar documents */
export async function queryCollection(
  collectionName: string,
  queryText: string,
  nResults = 10,
): Promise<{
  documents: string[];
  metadatas: Record<string, any>[];
  distances: number[];
}> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const payload = {
    model: "models/gemini-embedding-001",
    content: { parts: [{ text: queryText }] },
    taskType: "RETRIEVAL_QUERY",
  };

  const response = await fetchWithRetry(GEMINI_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  const queryEmbedding = data.embedding?.values || [];

  const hits = await qdrantSearchCollection(collectionName, queryEmbedding, nResults, true);
  return {
    documents: hits.map((h: any) => (h.payload?.text as string) || ""),
    metadatas: hits.map((h: any) => h.payload || {}),
    distances: hits.map((h: any) => (h.score !== null ? h.score : Number.MAX_VALUE)),
  };
}

/** @deprecated Use queryCollection instead */
export const queryChroma = queryCollection;

/** Query multiple collections and merge results */
export async function queryMultipleCollections(
  collectionNames: string[],
  queryText: string,
  nResults = 10
): Promise<{
  documents: string[];
  metadatas: Record<string, any>[];
  distances: number[];
  collections: string[];
}> {
  const allDocs: string[] = [];
  const allMetas: Record<string, any>[] = [];
  const allDists: number[] = [];
  const allColls: string[] = [];

  for (const name of collectionNames) {
    try {
      const result = await queryCollection(name, queryText, nResults);
      for (let i = 0; i < result.documents.length; i++) {
        allDocs.push(result.documents[i]);
        allMetas.push(result.metadatas[i]);
        allDists.push(result.distances[i]);
        allColls.push(name);
      }
    } catch (error: any) {
      logger.warn({ err: String(error), collection: name }, `[Embeddings] Failed to query collection ${name}`);
    }
  }

  // Sort by distance (ascending = more similar)
  const indices = allDists.map((_, i) => i).sort((a, b) => allDists[a] - allDists[b]);
  const topIndices = indices.slice(0, nResults);

  return {
    documents: topIndices.map(i => allDocs[i]),
    metadatas: topIndices.map(i => allMetas[i]),
    distances: topIndices.map(i => allDists[i]),
    collections: topIndices.map(i => allColls[i]),
  };
}

/** Get collection stats from Qdrant */
export async function getCollectionStats(collectionName: string): Promise<{ count: number }> {
  try {
    const qdrantUrl = process.env.QDRANT_URL || "";
    if (!qdrantUrl) return { count: 0 };
    const apiKey = process.env.QDRANT_API_KEY || "";
    const res = await fetch(`${qdrantUrl.replace(/\/$/, "")}/collections/${encodeURIComponent(collectionName)}`, {
      headers: { "Content-Type": "application/json", ...(apiKey ? { "api-key": apiKey } : {}) },
    });
    if (!res.ok) return { count: 0 };
    const data: any = await res.json();
    return { count: Number(data?.result?.points_count ?? 0) };
  } catch {
    return { count: 0 };
  }
}

/** List all Qdrant collections */
export async function listCollections(): Promise<string[]> {
  try {
    const qdrantUrl = process.env.QDRANT_URL || "";
    if (!qdrantUrl) return [];
    const apiKey = process.env.QDRANT_API_KEY || "";
    const res = await fetch(`${qdrantUrl.replace(/\/$/, "")}/collections`, {
      headers: { "Content-Type": "application/json", ...(apiKey ? { "api-key": apiKey } : {}) },
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.result?.collections || []).map((c: any) => c.name);
  } catch {
    return [];
  }
}
