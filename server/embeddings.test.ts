import { vi, describe, it, expect, beforeEach } from "vitest";
import { fetchWithRetry } from "./embeddings";
import { resetMetrics } from "./_core/metrics";

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
    // @ts-expect-error — mock global fetch
    global.fetch = fetchMock;

    const res = await fetchWithRetry("https://example.com", { method: "POST" });
    const data = await res.json();
    expect(data).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("generateBatchEmbeddings", () => {
  it("returns embeddings for texts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.resetModules();

    const embeddingsResp = { embeddings: [{ values: [0.1, 0.2, 0.3] }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => embeddingsResp });
    // @ts-expect-error — mock global fetch
    global.fetch = fetchMock;

    const { generateBatchEmbeddings: genBatch } = await import("./embeddings");
    const result = await genBatch(["hello"]);
    expect(result).toEqual([[0.1, 0.2, 0.3]]);

    vi.unstubAllEnvs();
  });
});

