/**
 * Embeddings Service - Generates embeddings via Gemini API and stores in ChromaDB
 */
import { ChromaClient, Collection } from "chromadb";
import type { TextChunk } from "./chunker";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";
const GEMINI_BATCH_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents";

const EMBEDDING_DIMENSION = 768;
const BATCH_SIZE = 50; // Gemini batch limit

let chromaClient: ChromaClient | null = null;

/** Get or create ChromaDB client */
export function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    chromaClient = new ChromaClient({ path: undefined }); // ephemeral in-memory
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

  const response = await fetch(`${GEMINI_EMBED_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_DOCUMENT",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini embedding failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

/** Generate embeddings for a batch of texts using Gemini API */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  if (texts.length === 0) return [];

  const requests = texts.map(text => ({
    model: "models/text-embedding-004",
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_DOCUMENT",
  }));

  const response = await fetch(`${GEMINI_BATCH_EMBED_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini batch embedding failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return (data.embeddings || []).map((e: any) => e.values || []);
}

/** Store chunks with embeddings in ChromaDB */
export async function storeChunksInChroma(
  collectionName: string,
  chunks: TextChunk[],
  onProgress?: (processed: number, total: number) => void
): Promise<{ stored: number; errors: number }> {
  const collection = await getOrCreateCollection(collectionName);
  let stored = 0;
  let errors = 0;

  // Process in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    try {
      const embeddings = await generateBatchEmbeddings(texts);

      const ids = batch.map((c, idx) => `${collectionName}_${i + idx}_${Date.now()}`);
      const documents = texts;
      const metadatas = batch.map(c => {
        // ChromaDB metadata must be flat (string, number, boolean)
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

      stored += batch.length;
    } catch (error: any) {
      console.error(`[Embeddings] Batch error at index ${i}:`, error.message);
      errors += batch.length;
    }

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, chunks.length), chunks.length);

    // Rate limiting - small delay between batches
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

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
  const response = await fetch(`${GEMINI_EMBED_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/text-embedding-004",
      content: { parts: [{ text: queryText }] },
      taskType: "RETRIEVAL_QUERY",
    }),
  });

  if (!response.ok) throw new Error(`Gemini query embedding failed: ${response.status}`);
  const data = await response.json();
  const queryEmbedding = data.embedding?.values || [];

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
      console.warn(`[Embeddings] Failed to query collection ${name}:`, error.message);
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
