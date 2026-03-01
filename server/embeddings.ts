/**
 * Embeddings Service - Generates embeddings via Gemini API or local GPU service, stores in Qdrant
 *
 * Provider selection via EMBEDDING_PROVIDER env var:
 *   - "gemini" (default): uses Gemini API (requires GEMINI_API_KEY)
 *   - "local": uses local GPU service (requires LOCAL_EMBEDDING_URL, default http://localhost:8100)
 *
 * NOTE: Switching providers requires re-indexing — vector spaces are incompatible.
 */
import type { TextChunk } from "./chunker";
import { logger } from "./_core/logger";
import { incMetric, recordTiming } from "./_core/metrics";
import { ensureCollection as ensureQdrantCollection, upsertPoints as qdrantUpsertPoints, searchCollection as qdrantSearchCollection } from "./vector/qdrant";
import pLimit from "p-limit";
import { randomUUID } from "crypto";

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "gemini").toLowerCase();
if (!["gemini", "local"].includes(EMBEDDING_PROVIDER)) {
  throw new Error(`Invalid EMBEDDING_PROVIDER: "${EMBEDDING_PROVIDER}". Must be "gemini" or "local".`);
}
const LOCAL_EMBEDDING_URL = (process.env.LOCAL_EMBEDDING_URL || "http://localhost:8100").replace(/\/$/, "");

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

// ---------------------------------------------------------------------------
// Local GPU provider helpers
// ---------------------------------------------------------------------------

async function localGenerateEmbeddings(texts: string[], taskType: "document" | "query"): Promise<number[][]> {
  // intfloat/multilingual-e5-base requires prefix: "query: " for queries, "passage: " for documents
  const prefix = taskType === "query" ? "query: " : "passage: ";
  const prefixedTexts = texts.map((t) => (t.startsWith(prefix) ? t : prefix + t));

  const startMs = Date.now();
  const res = await fetchWithRetry(`${LOCAL_EMBEDDING_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: prefixedTexts, normalize: true }),
  });
  recordTiming("embedding_local_request_ms", Date.now() - startMs);

  const body = await res.json();
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
    throw new Error(`Local embedding returned ${body.embeddings?.length ?? 0} vectors for ${texts.length} texts`);
  }
  return body.embeddings;
}

// ---------------------------------------------------------------------------
// Gemini provider helpers
// ---------------------------------------------------------------------------

async function geminiGenerateEmbedding(text: string): Promise<number[]> {
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

async function geminiGenerateQueryEmbedding(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  const payload = {
    model: "models/gemini-embedding-001",
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_QUERY",
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

async function geminiBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

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
        return embeddings.map((e: any) => e.values || []);
      }
    }
  } catch (err: any) {
    logger.warn({ err: String(err) }, "batchEmbedContents failed");
  }

  logger.warn("batchEmbedContents did not produce a complete result; falling back to per-item embeddings");

  // Per-item fallback
  const limit = pLimit(EMBEDDING_CONCURRENCY);
  const results: (number[] | null)[] = await Promise.all(
    texts.map((text, idx) =>
      limit(async () => {
        for (let attempt = 1; attempt <= Math.max(1, MAX_RETRIES); attempt++) {
          try {
            return await geminiGenerateEmbedding(text);
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
    throw new Error(`Per-item fallback failed for ${failed}/${texts.length} items`);
  }
  return results.map((r) => r as number[]);
}

// ---------------------------------------------------------------------------
// Public API — routes to the configured provider
// ---------------------------------------------------------------------------

/** Generate embedding for a single text */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (EMBEDDING_PROVIDER === "local") {
    const [embedding] = await localGenerateEmbeddings([text], "document");
    return embedding;
  }
  return geminiGenerateEmbedding(text);
}

/** Generate embedding for a query (uses RETRIEVAL_QUERY task type / "query: " prefix) */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  if (EMBEDDING_PROVIDER === "local") {
    const [embedding] = await localGenerateEmbeddings([text], "query");
    return embedding;
  }
  return geminiGenerateQueryEmbedding(text);
}

/** Generate embeddings for a batch of texts */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  incMetric("embedding_batch_jobs_started");

  try {
    let result: number[][];
    if (EMBEDDING_PROVIDER === "local") {
      // Local GPU service handles batching internally — no per-item fallback needed
      result = await localGenerateEmbeddings(texts, "document");
    } else {
      result = await geminiBatchEmbeddings(texts);
    }
    incMetric("embedding_batch_jobs_succeeded");
    return result;
  } catch (err: any) {
    incMetric("embedding_batch_jobs_failed_per_item");
    throw err;
  }
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
  const queryEmbedding = await generateQueryEmbedding(queryText);

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
