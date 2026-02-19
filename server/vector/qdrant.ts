/**
 * Lightweight Qdrant HTTP client wrapper using fetch.
 * Uses QDRANT_URL from environment.
 */
import { logger } from "../_core/logger";

const _DEFAULT_TIMEOUT_MS = 10_000;

function getQdrantUrl() {
  return process.env.QDRANT_URL || "";
}

function getQdrantApiKey() {
  return process.env.QDRANT_API_KEY || "";
}

async function fetchWithRetry(input: RequestInfo, init?: RequestInit, maxRetries = 3): Promise<Response> {
  let lastErr: any = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      lastErr = new Error(`HTTP ${res.status}: ${text}`);
      logger.warn({ attempt: i, status: res.status, url: String(input) }, "qdrant fetch non-ok");
    } catch (err: any) {
      lastErr = err;
      logger.warn({ attempt: i, err: String(err) }, "qdrant fetch error");
    }
    await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
  }
  throw lastErr || new Error("qdrant fetch failed");
}

function makeUrl(path: string) {
  const base = getQdrantUrl();
  if (!base) throw new Error("QDRANT_URL is not configured");
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function ensureCollection(collectionName: string, dimension: number) {
  try {
    const url = makeUrl(`/collections/${encodeURIComponent(collectionName)}`);
    const res = await fetchWithRetry(url, { method: "GET", headers: { "Content-Type": "application/json", ...(getQdrantApiKey() ? { "api-key": getQdrantApiKey() } : {}) } }, 1);
    if (res.ok) return;
  } catch {
    // proceed to create
  }

  const body = {
    vectors: {
      size: dimension,
      distance: "Cosine",
    },
  };
  const createUrl = makeUrl(`/collections/${encodeURIComponent(collectionName)}`);
  await fetchWithRetry(createUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(getQdrantApiKey() ? { "api-key": getQdrantApiKey() } : {}) },
    body: JSON.stringify(body),
  });
  logger.info({ collectionName, dimension }, "qdrant: collection created");
}

export type QdrantPoint = {
  id: string | number;
  vector: number[];
  payload?: Record<string, any>;
};

export async function upsertPoints(collectionName: string, points: QdrantPoint[]) {
  const url = makeUrl(`/collections/${encodeURIComponent(collectionName)}/points`);
  const body = { points };
  const res = await fetchWithRetry(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(getQdrantApiKey() ? { "api-key": getQdrantApiKey() } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`qdrant upsert failed: ${res.status} ${txt}`);
  }
  return true;
}

export async function searchCollection(collectionName: string, vector: number[], limit = 10, withPayload = true) {
  const url = makeUrl(`/collections/${encodeURIComponent(collectionName)}/points/search`);
  const body: any = {
    vector,
    limit,
    with_payload: withPayload,
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(getQdrantApiKey() ? { "api-key": getQdrantApiKey() } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  // data.result is array of points: { id, payload, score }
  const hits = (data.result || []).map((r: any) => ({
    id: r.id,
    payload: r.payload || {},
    score: typeof r.score === "number" ? r.score : null,
  }));
  return hits;
}

export function isQdrantConfigured() {
  return Boolean(getQdrantUrl());
}

