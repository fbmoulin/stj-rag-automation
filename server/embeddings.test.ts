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

describe("generateBatchEmbeddings (gemini)", () => {
  it("returns embeddings for texts", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("EMBEDDING_PROVIDER", "gemini");
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

describe("generateBatchEmbeddings (local)", () => {
  it("calls local GPU service with passage prefix", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "local");
    vi.stubEnv("LOCAL_EMBEDDING_URL", "http://localhost:8100");
    vi.resetModules();

    const localResp = { embeddings: [[0.4, 0.5, 0.6]], dimension: 768, model: "test", count: 1, elapsed_ms: 10 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => localResp });
    // @ts-expect-error — mock global fetch
    global.fetch = fetchMock;

    const { generateBatchEmbeddings: genBatch } = await import("./embeddings");
    const result = await genBatch(["Direito processual"]);
    expect(result).toEqual([[0.4, 0.5, 0.6]]);

    // Verify it called the local endpoint with passage prefix
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8100/embeddings");
    const body = JSON.parse(opts.body);
    expect(body.texts[0]).toBe("passage: Direito processual");
    expect(body.normalize).toBe(true);

    vi.unstubAllEnvs();
  });
});

describe("generateQueryEmbedding (local)", () => {
  it("calls local GPU service with query prefix", async () => {
    vi.stubEnv("EMBEDDING_PROVIDER", "local");
    vi.stubEnv("LOCAL_EMBEDDING_URL", "http://localhost:8100");
    vi.resetModules();

    const localResp = { embeddings: [[0.7, 0.8, 0.9]], dimension: 768, model: "test", count: 1, elapsed_ms: 5 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => localResp });
    // @ts-expect-error — mock global fetch
    global.fetch = fetchMock;

    const { generateQueryEmbedding: genQuery } = await import("./embeddings");
    const result = await genQuery("recurso especial");
    expect(result).toEqual([0.7, 0.8, 0.9]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.texts[0]).toBe("query: recurso especial");

    vi.unstubAllEnvs();
  });
});
