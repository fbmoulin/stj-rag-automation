import { vi, describe, it, expect, beforeEach } from "vitest";
import { fetchWithRetry, generateBatchEmbeddings, storeChunksInChroma } from "./embeddings";
import { getMetricsSnapshot, resetMetrics } from "./_core/metrics";

beforeEach(() => {
  vi.restoreAllMocks();
  resetMetrics();
});

describe("fetchWithRetry", () => {
  it("retries on non-ok and eventually succeeds", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    // @ts-ignore
    global.fetch = fetchMock;

    const res = await fetchWithRetry("https://example.com", { method: "POST" });
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("generateBatchEmbeddings", () => {
  it("returns embeddings for texts", async () => {
    const embeddingsResp = { embeddings: [{ values: [0.1, 0.2, 0.3] }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => embeddingsResp });
    // @ts-ignore
    global.fetch = fetchMock;

    const result = await generateBatchEmbeddings(["hello"]);
    expect(result).toEqual([[0.1, 0.2, 0.3]]);
  });
});

