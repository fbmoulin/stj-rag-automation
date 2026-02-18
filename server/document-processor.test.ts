import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./embeddings", () => ({
  storeChunks: vi.fn().mockResolvedValue({ stored: 5 }),
}));
vi.mock("./db", () => ({
  updateDocument: vi.fn(),
  createLog: vi.fn().mockResolvedValue(1),
  updateLog: vi.fn(),
}));
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { extractText, processDocument } from "./document-processor";
import { updateDocument } from "./db";
import { storeChunks } from "./embeddings";

const mockUpdateDoc = vi.mocked(updateDocument);
const mockStoreChunks = vi.mocked(storeChunks);

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreChunks.mockResolvedValue({ stored: 5 } as any);
});

describe("extractText", () => {
  it("extracts text from TXT buffer", async () => {
    const buffer = Buffer.from("Texto simples para teste.");
    const result = await extractText(buffer, "text/plain", "doc.txt");
    expect(result).toBe("Texto simples para teste.");
  });

  it("extracts text from TXT by filename extension", async () => {
    const buffer = Buffer.from("Conteúdo do arquivo.");
    const result = await extractText(buffer, "application/octet-stream", "nota.txt");
    expect(result).toBe("Conteúdo do arquivo.");
  });

  it("throws for unsupported mime type", async () => {
    const buffer = Buffer.from("data");
    await expect(extractText(buffer, "image/png", "foto.png")).rejects.toThrow("Unsupported file type");
  });
});

describe("processDocument", () => {
  it("processes TXT document through full pipeline", async () => {
    const buffer = Buffer.from("Ementa do processo. Decisão favorável ao autor. Recurso provido pela turma.");
    const result = await processDocument(1, buffer, "text/plain", "doc.txt", "test_collection");

    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.embeddings).toBe(5);
    expect(mockUpdateDoc).toHaveBeenCalled();
    expect(mockStoreChunks).toHaveBeenCalledWith("test_collection", expect.any(Array));
  });

  it("throws when extracted text is empty", async () => {
    const buffer = Buffer.from("");
    await expect(
      processDocument(1, buffer, "text/plain", "empty.txt", "coll")
    ).rejects.toThrow("No text content");
  });

  it("updates document status to error on failure", async () => {
    mockStoreChunks.mockRejectedValueOnce(new Error("ChromaDB down"));
    const buffer = Buffer.from("Algum texto.");

    await expect(
      processDocument(1, buffer, "text/plain", "doc.txt", "coll")
    ).rejects.toThrow("ChromaDB down");

    expect(mockUpdateDoc).toHaveBeenCalledWith(1, expect.objectContaining({ status: "error" }));
  });
});
