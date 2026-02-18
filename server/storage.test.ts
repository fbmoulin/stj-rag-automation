import { vi, describe, it, expect, beforeEach } from "vitest";

const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  upload: mockUpload,
  createSignedUrl: mockCreateSignedUrl,
}));
const mockStorage = { from: mockStorageFrom };

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ storage: mockStorage })),
}));

// Set env vars before importing the module
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "test-service-key";

import { storagePut } from "./storage";

beforeEach(() => {
  vi.clearAllMocks();
  mockStorageFrom.mockReturnValue({
    upload: mockUpload,
    createSignedUrl: mockCreateSignedUrl,
  });
});

describe("storagePut", () => {
  it("uploads data and returns key + url", async () => {
    mockUpload.mockResolvedValueOnce({ error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://test.supabase.co/storage/v1/signed/documents/test.pdf?token=xxx" },
    });

    const result = await storagePut("documents/test.pdf", Buffer.from("pdf data"), "application/pdf");
    expect(result.key).toBe("documents/test.pdf");
    expect(result.url).toContain("supabase.co");
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("throws on upload failure", async () => {
    mockUpload.mockResolvedValueOnce({ error: { message: "Server error" } });

    await expect(
      storagePut("documents/fail.pdf", Buffer.from("data"), "application/pdf")
    ).rejects.toThrow("Storage upload failed");
  });

  it("normalizes key by stripping leading slashes", async () => {
    mockUpload.mockResolvedValueOnce({ error: null });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://test.supabase.co/storage/test.txt" },
    });

    const result = await storagePut("///test.txt", Buffer.from("data"));
    expect(result.key).toBe("test.txt");
  });
});
