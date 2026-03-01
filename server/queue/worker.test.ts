import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock all dependencies before importing worker
vi.mock("./connection", () => ({
  getRedisConnection: vi.fn().mockReturnValue(null),
}));
vi.mock("./queues", () => ({
  QUEUE_NAMES: { RESOURCE_PROCESS: "resource-process", DOCUMENT_PROCESS: "document-process" },
}));
vi.mock("bullmq", () => ({
  Worker: vi.fn(),
}));
vi.mock("../_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../db", () => ({
  getResourceByResourceId: vi.fn(),
  getDatasetBySlug: vi.fn(),
  getAllDatasets: vi.fn().mockResolvedValue([]),
  createLog: vi.fn().mockResolvedValue(1),
  updateLog: vi.fn(),
  batchUpsertGraphNodes: vi.fn(),
  batchInsertGraphEdges: vi.fn(),
  getDocumentById: vi.fn(),
  updateResourceStatus: vi.fn(),
}));
vi.mock("../stj-extractor", () => ({
  downloadResource: vi.fn(),
}));
vi.mock("../chunker", () => ({
  processSTJRecords: vi.fn().mockReturnValue([{ text: "chunk1", index: 0, metadata: {} }]),
}));
vi.mock("../embeddings", () => ({
  storeChunks: vi.fn().mockResolvedValue({ stored: 1 }),
}));
vi.mock("../entity-extractor", () => ({
  extractEntitiesFromChunks: vi.fn().mockResolvedValue({ entities: [], relationships: [] }),
}));
vi.mock("../document-processor", () => ({
  processDocument: vi.fn().mockResolvedValue({ chunks: 1, embeddings: 1 }),
}));

// We can't directly call handleResourceProcess/handleDocumentProcess since they're not exported.
// Instead, test startWorkers behavior and use the Worker mock to capture the handler functions.
import { startWorkers, stopWorkers } from "./worker";
import { getRedisConnection } from "./connection";
import { getResourceByResourceId, getDocumentById, updateResourceStatus } from "../db";
import { downloadResource } from "../stj-extractor";
import { Worker } from "bullmq";

const mockGetRedis = vi.mocked(getRedisConnection);
const mockGetResource = vi.mocked(getResourceByResourceId);
const mockGetDoc = vi.mocked(getDocumentById);
const mockDownload = vi.mocked(downloadResource);
const mockUpdateStatus = vi.mocked(updateResourceStatus);
const MockWorker = vi.mocked(Worker);

// Helper to create a mock BullMQ Job
function createMockJob(data: Record<string, unknown>) {
  return {
    data,
    id: "test-job-1",
    updateProgress: vi.fn(),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset global fetch mock
  vi.stubGlobal("fetch", vi.fn());
});

describe("startWorkers", () => {
  it("does not start when Redis is unavailable", () => {
    mockGetRedis.mockReturnValue(null);
    startWorkers();
    expect(MockWorker).not.toHaveBeenCalled();
  });

  it("creates resource and document workers when Redis is available", () => {
    mockGetRedis.mockReturnValue({} as any);
    // Mock Worker constructor to return an object with .on()
    MockWorker.mockImplementation((() => ({
      on: vi.fn().mockReturnThis(),
    })) as any);

    startWorkers();

    expect(MockWorker).toHaveBeenCalledTimes(2);
    expect(MockWorker).toHaveBeenCalledWith(
      "resource-process",
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
    expect(MockWorker).toHaveBeenCalledWith(
      "document-process",
      expect.any(Function),
      expect.objectContaining({ concurrency: 2 }),
    );
  });
});

describe("handleDocumentProcess (via Worker handler)", () => {
  let documentHandler: (job: any) => Promise<void>;

  beforeEach(() => {
    // Start workers and capture the handler function
    mockGetRedis.mockReturnValue({} as any);
    MockWorker.mockImplementation(((name: string, handler: any) => {
      if (name === "document-process") {
        documentHandler = handler;
      }
      return { on: vi.fn().mockReturnThis() };
    }) as any);
    startWorkers();
  });

  it("throws when document is not found", async () => {
    mockGetDoc.mockResolvedValue(null as any);
    const job = createMockJob({ documentId: 999 });
    await expect(documentHandler(job)).rejects.toThrow("Document not found: 999");
  });

  it("throws when fileUrl is null", async () => {
    mockGetDoc.mockResolvedValue({
      id: 1, fileUrl: null, mimeType: "text/plain", filename: "doc.txt",
    } as any);
    const job = createMockJob({ documentId: 1 });
    await expect(documentHandler(job)).rejects.toThrow("has no fileUrl");
  });

  it("throws when fetch returns non-ok response", async () => {
    mockGetDoc.mockResolvedValue({
      id: 1, fileUrl: "https://example.com/file.pdf", mimeType: "text/plain", filename: "doc.txt",
    } as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden",
    }));
    const job = createMockJob({ documentId: 1 });
    await expect(documentHandler(job)).rejects.toThrow("HTTP 403 Forbidden");
  });

  it("processes document successfully", async () => {
    mockGetDoc.mockResolvedValue({
      id: 1, fileUrl: "https://example.com/file.txt", mimeType: "text/plain", filename: "doc.txt",
    } as any);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    }));
    const job = createMockJob({ documentId: 1 });
    await documentHandler(job);
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });
});

describe("handleResourceProcess (via Worker handler)", () => {
  let resourceHandler: (job: any) => Promise<void>;

  beforeEach(() => {
    mockGetRedis.mockReturnValue({} as any);
    MockWorker.mockImplementation(((name: string, handler: any) => {
      if (name === "resource-process") {
        resourceHandler = handler;
      }
      return { on: vi.fn().mockReturnThis() };
    }) as any);
    startWorkers();
  });

  it("throws when resource is not found", async () => {
    mockGetResource.mockResolvedValue(null as any);
    const job = createMockJob({ resourceId: "missing-id" });
    await expect(resourceHandler(job)).rejects.toThrow("Resource not found: missing-id");
  });

  it("marks resource as error on downstream failure", async () => {
    mockGetResource.mockResolvedValue({ id: 1, name: "test", datasetId: 1 } as any);
    mockDownload.mockRejectedValue(new Error("download failed"));
    const job = createMockJob({ resourceId: "res-1" });

    await expect(resourceHandler(job)).rejects.toThrow("download failed");
    expect(mockUpdateStatus).toHaveBeenCalledWith("res-1", "error", expect.objectContaining({
      errorMessage: "download failed",
    }));
  });
});
