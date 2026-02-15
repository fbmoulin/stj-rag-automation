/**
 * Embeddings Service - Generates embeddings via Gemini API and stores in ChromaDB
 */
import { ChromaClient, Collection } from "chromadb";
import type { TextChunk } from "./chunker";
import fs from "fs";
import path from "path";
import { logger } from "./_core/logger";
import { incMetric, recordTiming } from "./_core/metrics";
import { isQdrantConfigured, ensureCollection as ensureQdrantCollection, upsertPoints as qdrantUpsertPoints, searchCollection as qdrantSearchCollection } from "./vector/qdrant";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_EMBED_URL =
  process.env.GEMINI_EMBED_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
const GEMINI_BATCH_EMBED_URL =
  process.env.GEMINI_BATCH_EMBED_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:asyncBatchEmbedContent";
const GEMINI_LIST_MODELS_URL =
  process.env.GEMINI_LIST_MODELS_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models";

const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION || "768");
const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || "50"); // Gemini batch limit
const MAX_RETRIES = Number(process.env.EMBEDDING_MAX_RETRIES || "3");
const RETRY_BACKOFF_BASE_MS = Number(process.env.EMBEDDING_RETRY_BASE_MS || "300");
const EMBEDDING_CONCURRENCY = Number(process.env.EMBEDDING_CONCURRENCY || "1");

let chromaClient: ChromaClient | null = null;
import pLimit from "p-limit";
import { randomUUID } from "crypto";

export async function fetchWithRetry(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let lastError: any = null;
  for (let attempt = 0; attempt < Math.max(1, MAX_RETRIES); attempt++) {
    try {
      const start = Date.now();
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

/** Get or create ChromaDB client */
export function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    // Use configured CHROMA_PATH or default to /data/chroma (suitable for docker-compose mount)
    const chromaPath = process.env.CHROMA_PATH || path.resolve(process.cwd(), "data", "chroma");
    try {
      fs.mkdirSync(chromaPath, { recursive: true });
    } catch (err: any) {
      logger.error({ err: String(err), chromaPath }, "Failed to create CHROMA_PATH directory, falling back to in-memory");
      chromaClient = new ChromaClient({ path: undefined });
      return chromaClient;
    }
    // Try to initialize a file-backed Chroma using duckdb+parquet backend when available.
    try {
      chromaClient = new ChromaClient({
        path: chromaPath,
        settings: {
          chroma_db_impl: "duckdb+parquet",
          persist_directory: chromaPath,
        },
      } as any);
    } catch {
      // Fallback: try simple path option
      chromaClient = new ChromaClient({ path: chromaPath } as any);
    }
    logger.info({ chromaPath }, "Chroma client initialized with persistent path");
  }
  return chromaClient;
}

/** Get or create a ChromaDB collection */
export async function getOrCreateCollection(name: string): Promise<Collection> {
  const client = getChromaClient();
  return client.getOrCreateCollection({
    name,
    metadata: { "hnsw:space": "cosine" },
  });
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
  // Attempt async batch embed via Gemini's asyncBatchEmbedContent endpoint.
  // Metrics / tuning
  incMetric("embedding_batch_jobs_started");
  const pollIntervalMs = Number(process.env.EMBEDDING_ASYNC_POLL_INTERVAL_MS || "1000");
  const maxMs = Number(process.env.EMBEDDING_ASYNC_TIMEOUT_MS || "60000");

  // Try multiple async batch payload shapes. Some Gemini Batch APIs accept NDJSON (JSONL) lines
  // of {"key": "...", "request": {...}} while others accept a JSON { requests: [...] } body.
  // We'll try in order: JSON body, NDJSON lines.
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
      // If immediate response contains embeddings, return them
      if (res.ok) {
        const body = await res.json().catch(() => null);
        // If operation-style response with name
        if (body && body.done && body.response) {
          const embeddings = extractEmbeddingsFromOperationResponse(body.response);
          if (embeddings) {
            incMetric("embedding_batch_jobs_succeeded");
            return embeddings;
          }
        }
        const opName = body?.name || body?.operation?.name || body?.operationName || body?.operation?.operationId;
        if (opName) {
          // Poll operations endpoint
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
        // Inline embeddings returned?
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

    // 2) Try NDJSON / JSONL payload shape commonly used by batch endpoints
    try {
      const lines = texts.map((text, idx) =>
        JSON.stringify({
          key: `r${idx}`,
          request: {
            content: { parts: [{ text }] },
            // optional parameters can be added per-request
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
          // some implementations return responses inline as array
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
  // Async batch did not return a complete result — fall back to per-item embedding with retries.
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
  // At this point, results are non-null arrays
  return results.map((r) => r as number[]);
}

function extractEmbeddingsFromOperationResponse(resp: any): number[][] | null {
  // Try multiple common shapes
  // 1) resp.result?.embeddings
  if (resp?.result?.embeddings && Array.isArray(resp.result.embeddings)) {
    return resp.result.embeddings.map((e: any) => e.values || []);
  }
  // 2) resp.embeddings
  if (resp?.embeddings && Array.isArray(resp.embeddings)) {
    return resp.embeddings.map((e: any) => e.values || []);
  }
  // 3) resp.output?.embeddings
  if (resp?.output?.embeddings && Array.isArray(resp.output.embeddings)) {
    return resp.output.embeddings.map((e: any) => e.values || []);
  }
  return null;
}

/** Store chunks with embeddings in ChromaDB */
export async function storeChunksInChroma(
  collectionName: string,
  chunks: TextChunk[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ stored: number; errors: number }> {
  // If Qdrant is configured, route storage to Qdrant
  if (isQdrantConfigured()) {
    // Ensure collection exists with the expected embedding dimension
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
          logger.error({ err: String(error), index: batchIndex }, `[Embeddings][Qdrant] Batch error at index ${batchIndex}`);
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

  // Fallback to Chroma if Qdrant not configured (existing behavior)
  const collection = await getOrCreateCollection(collectionName);
  let stored = 0;
  let errors = 0;

  // Optional deduplication by text content
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

        const ids = batch.map((c, idx) => `${collectionName}_${batchIndex + idx}_${Date.now()}`);
        const documents = texts;
        const metadatas = batch.map((c) => {
          const flat: Record<string, string | number | boolean> = {};
          for (const [k, v] of Object.entries(c.metadata)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              flat[k] = v;
            } else if (v !== null && v !== undefined) {
              flat[k] = String(v);
            }
          }
          return flat;
        });

        await collection.add({
          ids,
          documents,
          embeddings,
          metadatas,
        });

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
  stored = results.reduce((s, r) => s + r.stored, 0);
  errors = results.reduce((e, r) => e + r.errors, 0);

  return { stored, errors };
}

/** Query ChromaDB for similar documents */
export async function queryChroma(
  collectionName: string,
  queryText: string,
  nResults = 10,
  filter?: Record<string, any>
): Promise<{
  documents: string[];
  metadatas: Record<string, any>[];
  distances: number[];
}> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  // Generate query embedding
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

  // If Qdrant is configured, use it for nearest-neighbor search
  if (isQdrantConfigured()) {
    const hits = await qdrantSearchCollection(collectionName, queryEmbedding, nResults, true);
    return {
      documents: hits.map((h) => (h.payload?.text as string) || ""),
      metadatas: hits.map((h) => h.payload || {}),
      distances: hits.map((h) => (h.score !== null ? h.score : Number.MAX_VALUE)),
    };
  }

  const collection = await getOrCreateCollection(collectionName);
  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
    where: filter,
  });

  return {
    documents: (results.documents?.[0] || []) as string[],
    metadatas: (results.metadatas?.[0] || []) as Record<string, any>[],
    distances: (results.distances?.[0] || []) as number[],
  };
}

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
      const result = await queryChroma(name, queryText, nResults);
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

/** Get collection stats */
export async function getCollectionStats(collectionName: string): Promise<{ count: number }> {
  try {
    const collection = await getOrCreateCollection(collectionName);
    const count = await collection.count();
    return { count };
  } catch {
    return { count: 0 };
  }
}

/** List all collections */
export async function listCollections(): Promise<string[]> {
  const client = getChromaClient();
  const collections = await client.listCollections();
  // listCollections returns an array of strings (collection names) in newer versions
  return collections.map((c: any) => typeof c === 'string' ? c : c.name);
}
