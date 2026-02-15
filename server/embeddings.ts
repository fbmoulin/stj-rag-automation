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
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const GEMINI_BATCH_EMBED_URL =
  process.env.GEMINI_BATCH_EMBED_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents";

const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION || "768");
const BATCH_SIZE = Number(process.env.EMBEDDING_BATCH_SIZE || "50"); // Gemini batch limit
const MAX_RETRIES = Number(process.env.EMBEDDING_MAX_RETRIES || "3");
const RETRY_BACKOFF_BASE_MS = Number(process.env.EMBEDDING_RETRY_BASE_MS || "300");
const EMBEDDING_CONCURRENCY = Number(process.env.EMBEDDING_CONCURRENCY || "1");

let chromaClient: ChromaClient | null = null;
import pLimit from "p-limit";

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
    model: "models/text-embedding-004",
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

  const requests = texts.map((text) => ({
    model: "models/text-embedding-004",
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));

  const res = await fetchWithRetry(GEMINI_BATCH_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({ requests }),
  });

  const data = await res.json();
  return (data.embeddings || []).map((e: any) => e.values || []);
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
            id: `${collectionName}_${batchIndex + idx}_${Date.now()}`,
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
    model: "models/text-embedding-004",
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
