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
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";

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
    outputDimensionality: EMBEDDING_DIMENSION,
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

  // Try synchronous batchEmbedContents first
  try {
    const requests = texts.map((text) => ({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: EMBEDDING_DIMENSION,
    }));
    const startMs = Date.now();
    const res = await fetchWithRetry(GEMINI_BATCH_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({ requests }),
    });
    recordTiming("embedding_batch_request_ms", Date.now() - startMs);
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const embeddings = body?.embeddings;
      if (Array.isArray(embeddings) && embeddings.length === texts.length) {
        incMetric("embedding_batch_jobs_succeeded");
        return embeddings.map((e: any) => e.values || []);
      }
    }
  } catch (err: any) {
    logger.warn({ err: String(err) }, "batchEmbedContents failed");
  }
  incMetric("embedding_batch_jobs_failed_async");
  logger.warn("batchEmbedContents did not produce a complete result; falling back to per-item embeddings");

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
    outputDimensionality: EMBEDDING_DIMENSION,
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
