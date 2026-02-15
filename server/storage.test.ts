import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: {
    forgeApiUrl: "https://forge.example.com",
    forgeApiKey: "test-key-123",
  },
}));

import { storagePut } from "./storage";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storagePut", () => {
  it("uploads data and returns key + url", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/documents/test.pdf" }),
    });
    global.fetch = mockFetch as any;

    const result = await storagePut("documents/test.pdf", Buffer.from("pdf data"), "application/pdf");
    expect(result.key).toBe("documents/test.pdf");
    expect(result.url).toBe("https://cdn.example.com/documents/test.pdf");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on upload failure", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    });
    global.fetch = mockFetch as any;

    await expect(
      storagePut("documents/fail.pdf", Buffer.from("data"), "application/pdf")
    ).rejects.toThrow("Storage upload failed");
  });

  it("normalizes key by stripping leading slashes", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: "https://cdn.example.com/test.txt" }),
    });
    global.fetch = mockFetch as any;

    const result = await storagePut("///test.txt", Buffer.from("data"));
    expect(result.key).toBe("test.txt");
  });
});
