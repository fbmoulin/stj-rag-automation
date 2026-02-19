/**
 * BullMQ queue definitions for async processing jobs.
 */
import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { logger } from "../_core/logger";

export const QUEUE_NAMES = {
  RESOURCE_PROCESS: "resource-process",
  DOCUMENT_PROCESS: "document-process",
} as const;

export interface ResourceProcessJob {
  resourceId: string;
}

export interface DocumentProcessJob {
  documentId: number;
}

let _resourceQueue: Queue<ResourceProcessJob> | null = null;
let _documentQueue: Queue<DocumentProcessJob> | null = null;

export function getResourceQueue(): Queue<ResourceProcessJob> | null {
  if (_resourceQueue) return _resourceQueue;
  const connection = getRedisConnection();
  if (!connection) return null;
  _resourceQueue = new Queue(QUEUE_NAMES.RESOURCE_PROCESS, { connection: connection as any }) as Queue<ResourceProcessJob>;
  return _resourceQueue;
}

export function getDocumentQueue(): Queue<DocumentProcessJob> | null {
  if (_documentQueue) return _documentQueue;
  const connection = getRedisConnection();
  if (!connection) return null;
  _documentQueue = new Queue(QUEUE_NAMES.DOCUMENT_PROCESS, { connection: connection as any }) as Queue<DocumentProcessJob>;
  return _documentQueue;
}

/** Add a resource processing job to the queue. Returns jobId or null if queue unavailable. */
export async function enqueueResourceProcess(resourceId: string): Promise<string | null> {
  const queue = getResourceQueue();
  if (!queue) return null;
  const job = await queue.add("process", { resourceId }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
  logger.info({ jobId: job.id, resourceId }, "[Queue] Resource process job enqueued");
  return job.id!;
}

/** Add a document processing job to the queue. Returns jobId or null if queue unavailable. */
export async function enqueueDocumentProcess(documentId: number): Promise<string | null> {
  const queue = getDocumentQueue();
  if (!queue) return null;
  const job = await queue.add("process", { documentId }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  });
  logger.info({ jobId: job.id, documentId }, "[Queue] Document process job enqueued");
  return job.id!;
}

export async function closeQueues(): Promise<void> {
  if (_resourceQueue) { await _resourceQueue.close().catch(() => {}); _resourceQueue = null; }
  if (_documentQueue) { await _documentQueue.close().catch(() => {}); _documentQueue = null; }
}
