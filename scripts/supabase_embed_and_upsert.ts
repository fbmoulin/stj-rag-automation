#!/usr/bin/env tsx
/**
 * scripts/supabase_embed_and_upsert.ts
 *
 * Usage:
 *   pnpm tsx scripts/supabase_embed_and_upsert.ts <input.txt|jsonl> <qdrant_collection>
 *
 * Behavior:
 *  - Reads input file (plain text lines or JSONL with {"text": "..."}).
 *  - Generates embeddings per-item with retries and concurrency (env-controlled).
 *  - Upserts vectors into Qdrant collection.
 *
 * Env:
 *  - GEMINI_API_KEY (required)
 *  - GEMINI_EMBED_URL (optional override)
 *  - EMBEDDING_MAX_RETRIES, EMBEDDING_RETRY_BASE_MS, EMBEDDING_CONCURRENCY
 *  - QDRANT_URL, QDRANT_API_KEY
 */
import fs from "fs";
import path from "path";
import pLimit from "p-limit";
import crypto from "crypto";

const [
  ,
  ,
  inputPath = "",
  collection = process.env.QDRANT_COLLECTION || "default_collection",
] = process.argv;

if (!inputPath) {
  console.error("Usage: tsx scripts/supabase_embed_and_upsert.ts <input.txt|jsonl> <qdrant_collection>");
  process.exit(2);
}

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || "gemini").toLowerCase();
const LOCAL_EMBEDDING_URL = (process.env.LOCAL_EMBEDDING_URL || "http://localhost:8100").replace(/\/$/, "");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_EMBED_URL = process.env.GEMINI_EMBED_URL || "";
const QDRANT_URL = (process.env.QDRANT_URL || "http://localhost:6333").replace(/\/$/, "");
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";

const MAX_RETRIES = Number(process.env.EMBEDDING_MAX_RETRIES || 3);
const RETRY_BASE_MS = Number(process.env.EMBEDDING_RETRY_BASE_MS || 300);
const CONCURRENCY = Number(process.env.EMBEDDING_CONCURRENCY || 4);

if (EMBEDDING_PROVIDER === "gemini" && !GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in env (required when EMBEDDING_PROVIDER=gemini)");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function localEmbed(texts: string[]): Promise<number[][]> {
  const prefixed = texts.map((t) => (t.startsWith("passage: ") ? t : "passage: " + t));
  const res = await fetch(`${LOCAL_EMBEDDING_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: prefixed, normalize: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`local embed failed ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.embeddings;
}

async function embedWithRetry(text: string) {
  if (EMBEDDING_PROVIDER === "local") {
    const [vector] = await localEmbed([text]);
    return vector;
  }

  let attempt = 0;
  while (true) {
    try {
      const url =
        GEMINI_EMBED_URL ||
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Support API key (x-goog-api-key) or bearer token
      if (GEMINI_API_KEY && GEMINI_API_KEY.startsWith("ya29")) {
        headers["Authorization"] = `Bearer ${GEMINI_API_KEY}`;
      } else if (GEMINI_API_KEY) {
        headers["x-goog-api-key"] = GEMINI_API_KEY;
      }
      const payload = {
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      };
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`embed failed ${res.status} ${body}`);
      }
      const j = await res.json().catch(() => null);
      const vector =
        j?.embedding?.values ||
        j?.response?.embedding?.values ||
        j?.output?.embeddings?.[0]?.values ||
        j?.data?.[0]?.embedding ||
        (Array.isArray(j) && j[0]?.embedding?.values) ||
        null;
      if (!vector) {
        // fallback: try to find first numeric array in response
        const found = Object.values(j || {}).find((v) => Array.isArray(v) && typeof v[0] === "number");
        if (found) return found as number[];
        throw new Error("no embedding in response");
      }
      return vector as number[];
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) throw err;
      const backoff = RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      console.warn(`embed attempt ${attempt} failed, retrying in ${backoff}ms:`, (err as Error).message);
      await sleep(backoff);
    }
  }
}

async function upsertToQdrant(points: Array<{ id: string; vector: number[]; payload?: any }>) {
  const url = `${QDRANT_URL}/collections/${collection}/points`;
  const body = { points };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (QDRANT_API_KEY) headers["api-key"] = QDRANT_API_KEY;
  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`qdrant upsert failed ${res.status} ${txt}`);
  }
  return true;
}

function readInputs(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];
  // detect jsonl
  for (const l of lines) {
    if (l.startsWith("{")) {
      try {
        const j = JSON.parse(l);
        if (j.text) items.push(String(j.text));
        else items.push(JSON.stringify(j));
      } catch {
        items.push(l);
      }
    } else {
      items.push(l);
    }
  }
  return items;
}

async function main() {
  const inputs = readInputs(inputPath);
  console.log(`Read ${inputs.length} items from ${inputPath}`);
  const limit = pLimit(CONCURRENCY);
  const results: Array<{ id: string; ok: boolean; err?: string }> = [];
  const batch: Array<{ id: string; vector: number[]; payload: any }> = [];

  const tasks = inputs.map((text, idx) =>
    limit(async () => {
      const id = crypto.randomUUID();
      try {
        const start = Date.now();
        const vector = await embedWithRetry(text);
        const elapsed = Date.now() - start;
        console.log(`Embedded item ${idx} id=${id} len=${vector.length} time=${elapsed}ms`);
        batch.push({ id, vector, payload: { source: path.basename(inputPath), index: idx } });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, err: (err as Error).message });
        console.error(`Failed embedding item ${idx} id=${id}:`, (err as Error).message);
      }
    })
  );

  await Promise.all(tasks);

  // Upsert in batches of 64
  const chunkSize = 64;
  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    console.log(`Upserting chunk ${i / chunkSize + 1} (${chunk.length} points) to Qdrant collection=${collection}`);
    await upsertToQdrant(chunk);
  }

  const succ = results.filter((r) => r.ok).length;
  const fail = results.length - succ;
  console.log(`Done. Success=${succ} Failed=${fail}`);
  if (fail > 0) process.exit(3);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

