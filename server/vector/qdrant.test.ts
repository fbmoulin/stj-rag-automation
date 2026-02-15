import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { isQdrantConfigured } from "./qdrant";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("isQdrantConfigured", () => {
  it("returns true when QDRANT_URL is set", () => {
    vi.stubEnv("QDRANT_URL", "http://localhost:6333");
    expect(isQdrantConfigured()).toBe(true);
  });

  it("returns false when QDRANT_URL is empty", () => {
    vi.stubEnv("QDRANT_URL", "");
    expect(isQdrantConfigured()).toBe(false);
  });

  it("returns false when QDRANT_URL is not set", () => {
    delete process.env.QDRANT_URL;
    expect(isQdrantConfigured()).toBe(false);
  });
});
