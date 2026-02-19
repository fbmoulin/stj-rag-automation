/**
 * BullMQ workers for async resource and document processing.
 * Started alongside the Express server in index.ts.
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "./connection";
import { QUEUE_NAMES, ResourceProcessJob, DocumentProcessJob } from "./queues";
import { logger } from "../_core/logger";

// Import services (same logic as synchronous routers)
import {
  getResourceByResourceId, getDatasetBySlug, getAllDatasets,
  createLog, updateLog, batchUpsertGraphNodes, batchInsertGraphEdges,
  getDocumentById,
} from "../db";
import { updateResourceStatus } from "../db";
import { downloadResource } from "../stj-extractor";
import { processSTJRecords } from "../chunker";
import { storeChunks } from "../embeddings";
import { extractEntitiesFromChunks } from "../entity-extractor";
import { processDocument as processDocumentService } from "../document-processor";

let _workers: Worker[] = [];

async function handleResourceProcess(job: Job<ResourceProcessJob>): Promise<void> {
  const { resourceId } = job.data;
  const resource = await getResourceByResourceId(resourceId);
  if (!resource) throw new Error(`Resource not found: ${resourceId}`);

  const startTime = Date.now();
  const logId = await createLog({
    action: "process_json",
    resourceId,
    status: "started",
    details: `Processing resource ${resource.name}`,
  });

  try {
    // Download
    await updateResourceStatus(resourceId, "downloading");
    await job.updateProgress(10);
    const data = await downloadResource(resourceId);

    // Get dataset info
    const dataset = await getDatasetBySlug(
      (await getAllDatasets()).find(d => d.id === resource.datasetId)?.slug || ""
    );

    // Chunk
    await updateResourceStatus(resourceId, "processing");
    await job.updateProgress(30);
    const chunks = processSTJRecords(data, dataset?.slug || "unknown", resource.name);

    // Extract entities (limit for performance)
    await updateResourceStatus(resourceId, "extracting_entities");
    await job.updateProgress(50);
    const extraction = await extractEntitiesFromChunks(chunks.slice(0, 50));

    // Store entities in graph
    await batchUpsertGraphNodes(
      extraction.entities.map(e => ({
        entityId: e.entityId,
        name: e.name,
        entityType: e.entityType,
        description: e.description,
        source: "stj",
        sourceRef: dataset?.slug || resourceId,
      }))
    );
    await batchInsertGraphEdges(
      extraction.relationships.map(r => ({
        sourceEntityId: r.sourceEntityId,
        targetEntityId: r.targetEntityId,
        relationshipType: r.relationshipType,
        description: r.description,
        weight: r.weight,
        sourceRef: dataset?.slug || resourceId,
      }))
    );

    // Embeddings
    await updateResourceStatus(resourceId, "embedding");
    await job.updateProgress(80);
    const collectionName = `stj_${dataset?.slug?.replace(/-/g, "_") || "unknown"}`;
    const embedResult = await storeChunks(collectionName, chunks);

    await updateResourceStatus(resourceId, "embedded", {
      processedAt: new Date(),
      embeddedAt: new Date(),
      recordCount: data.length,
      chunkCount: chunks.length,
      entityCount: extraction.entities.length,
      relationshipCount: extraction.relationships.length,
    });

    await job.updateProgress(100);

    const duration = Date.now() - startTime;
    if (logId) {
      await updateLog(logId, {
        status: "completed",
        recordsProcessed: data.length,
        chunksGenerated: chunks.length,
        entitiesExtracted: extraction.entities.length,
        relationshipsExtracted: extraction.relationships.length,
        embeddingsGenerated: embedResult.stored,
        durationMs: duration,
      });
    }

    logger.info({ resourceId, duration, records: data.length }, "[Worker] Resource processed");
  } catch (error: any) {
    await updateResourceStatus(resourceId, "error", { errorMessage: error.message });
    if (logId) {
      await updateLog(logId, {
        status: "failed",
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
      });
    }
    throw error; // BullMQ will retry based on job config
  }
}

async function handleDocumentProcess(job: Job<DocumentProcessJob>): Promise<void> {
  const { documentId } = job.data;
  const doc = await getDocumentById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  await job.updateProgress(10);
  const response = await fetch(doc.fileUrl!);
  const buffer = Buffer.from(await response.arrayBuffer());

  await job.updateProgress(30);
  const collectionName = `doc_${documentId}`;
  await processDocumentService(documentId, buffer, doc.mimeType, doc.filename, collectionName);
  await job.updateProgress(100);

  logger.info({ documentId }, "[Worker] Document processed");
}

export function startWorkers(): void {
  const connection = getRedisConnection();
  if (!connection) {
    logger.warn("[Worker] Redis not available — workers not started");
    return;
  }

  const resourceWorker = new Worker<ResourceProcessJob>(
    QUEUE_NAMES.RESOURCE_PROCESS,
    handleResourceProcess,
    { connection: connection as any, concurrency: 1 },
  );
  resourceWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: String(err) }, "[Worker] Resource job failed");
  });

  const documentWorker = new Worker<DocumentProcessJob>(
    QUEUE_NAMES.DOCUMENT_PROCESS,
    handleDocumentProcess,
    { connection: connection as any, concurrency: 2 },
  );
  documentWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: String(err) }, "[Worker] Document job failed");
  });

  _workers = [resourceWorker, documentWorker];
  logger.info("[Worker] BullMQ workers started (resource: concurrency=1, document: concurrency=2)");
}

export async function stopWorkers(): Promise<void> {
  for (const w of _workers) {
    await w.close().catch(() => {});
  }
  _workers = [];
}
