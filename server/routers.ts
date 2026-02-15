import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

// DB helpers
import {
  getAllDatasets, getDatasetBySlug, getResourcesByDatasetId, getResourceStats,
  getAllResources, getResourceByResourceId,
  createDocument, getDocumentsByUserId, getAllDocuments, getDocumentById,
  getRecentLogs, getDashboardStats,
  getRecentRagQueries, getAllGraphNodes, getGraphNodesByType, searchGraphNodes,
  getGraphNodeStats, getGraphEdgeStats, getAllCommunities,
} from "./db";

// Services
import { syncDatasets, downloadResource, getStaticDatasetList } from "./stj-extractor";
import { processSTJRecords } from "./chunker";
import { storeChunksInChroma, getCollectionStats, listCollections } from "./embeddings";
import { extractEntitiesFromChunks } from "./entity-extractor";
import { batchUpsertGraphNodes, batchInsertGraphEdges } from "./db";
import { buildCommunities, getGraphVisualizationData } from "./graph-engine";
import { graphRAGQuery } from "./graphrag-query";
import { processDocument as processDocumentService, extractText } from "./document-processor";
import { updateResourceStatus, createLog, updateLog } from "./db";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: router({
    stats: publicProcedure.query(async () => {
      return getDashboardStats();
    }),
    recentLogs: publicProcedure.query(async () => {
      return getRecentLogs(30);
    }),
  }),

  // ─── STJ Datasets ──────────────────────────────────────────────────────────
  datasets: router({
    list: publicProcedure.query(async () => {
      const dbDatasets = await getAllDatasets();
      if (dbDatasets.length > 0) return dbDatasets;
      return getStaticDatasetList();
    }),
    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const dataset = await getDatasetBySlug(input.slug);
        if (!dataset) return null;
        const resources = await getResourcesByDatasetId(dataset.id);
        return { ...dataset, resources };
      }),
    sync: protectedProcedure.mutation(async () => {
      return syncDatasets();
    }),
    resourceStats: publicProcedure.query(async () => {
      return getResourceStats();
    }),
  }),

  // ─── Resources ──────────────────────────────────────────────────────────────
  resources: router({
    list: publicProcedure.query(async () => {
      return getAllResources();
    }),
    download: protectedProcedure
      .input(z.object({ resourceId: z.string() }))
      .mutation(async ({ input }) => {
        const data = await downloadResource(input.resourceId);
        return { recordCount: data.length, status: "downloaded" };
      }),
    process: protectedProcedure
      .input(z.object({ resourceId: z.string() }))
      .mutation(async ({ input }) => {
        const resource = await getResourceByResourceId(input.resourceId);
        if (!resource) throw new Error("Resource not found");

        const startTime = Date.now();
        const logId = await createLog({
          action: "process_json",
          resourceId: input.resourceId,
          status: "started",
          details: `Processing resource ${resource.name}`,
        });

        try {
          // Download the data
          await updateResourceStatus(input.resourceId, "downloading");
          const data = await downloadResource(input.resourceId);

          // Get dataset info
          const dataset = await getDatasetBySlug(
            (await getAllDatasets()).find(d => d.id === resource.datasetId)?.slug || ""
          );

          // Process into chunks
          await updateResourceStatus(input.resourceId, "processing");
          const chunks = processSTJRecords(data, dataset?.slug || "unknown", resource.name);

          // Extract entities from chunks (GraphRAG)
          await updateResourceStatus(input.resourceId, "extracting_entities");
          const extraction = await extractEntitiesFromChunks(chunks.slice(0, 50)); // Limit for performance

          // Store entities in graph
          await batchUpsertGraphNodes(
            extraction.entities.map(e => ({
              entityId: e.entityId,
              name: e.name,
              entityType: e.entityType,
              description: e.description,
              source: "stj",
              sourceRef: dataset?.slug || input.resourceId,
            }))
          );

          await batchInsertGraphEdges(
            extraction.relationships.map(r => ({
              sourceEntityId: r.sourceEntityId,
              targetEntityId: r.targetEntityId,
              relationshipType: r.relationshipType,
              description: r.description,
              weight: r.weight,
              sourceRef: dataset?.slug || input.resourceId,
            }))
          );

          // Generate embeddings
          await updateResourceStatus(input.resourceId, "embedding");
          const collectionName = `stj_${dataset?.slug?.replace(/-/g, "_") || "unknown"}`;
          const embedResult = await storeChunksInChroma(collectionName, chunks);

          await updateResourceStatus(input.resourceId, "embedded", {
            processedAt: new Date(),
            embeddedAt: new Date(),
            recordCount: data.length,
            chunkCount: chunks.length,
            entityCount: extraction.entities.length,
            relationshipCount: extraction.relationships.length,
          });

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

          return {
            records: data.length,
            chunks: chunks.length,
            entities: extraction.entities.length,
            relationships: extraction.relationships.length,
            embeddings: embedResult.stored,
          };
        } catch (error: any) {
          await updateResourceStatus(input.resourceId, "error", { errorMessage: error.message });
          if (logId) {
            await updateLog(logId, {
              status: "failed",
              durationMs: Date.now() - startTime,
              errorMessage: error.message,
            });
          }
          throw error;
        }
      }),
  }),

  // ─── Documents (Upload) ─────────────────────────────────────────────────────
  documents: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDocumentsByUserId(ctx.user.id);
    }),
    listAll: protectedProcedure.query(async () => {
      return getAllDocuments();
    }),
    upload: protectedProcedure
      .input(z.object({
        filename: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.base64Data, "base64");

        // Upload to S3
        const fileKey = `documents/${ctx.user.id}/${nanoid()}-${input.filename}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        // Create document record
        const docId = await createDocument({
          userId: ctx.user.id,
          filename: input.filename,
          mimeType: input.mimeType,
          fileSize: buffer.length,
        originalName: input.filename,
        fileUrl: url,
        status: "uploaded",
        });

        return { documentId: docId, url };
      }),
    process: protectedProcedure
      .input(z.object({ documentId: z.number() }))
      .mutation(async ({ input }) => {
        const doc = await getDocumentById(input.documentId);
        if (!doc) throw new Error("Document not found");

        // Fetch the file from S3
        const response = await fetch(doc.fileUrl!);
        const buffer = Buffer.from(await response.arrayBuffer());

        const collectionName = `doc_${input.documentId}`;
        const result = await processDocumentService(
          input.documentId,
          buffer,
          doc.mimeType,
          doc.filename,
          collectionName
        );

        return result;
      }),
  }),

  // ─── Knowledge Graph ────────────────────────────────────────────────────────
  graph: router({
    nodes: publicProcedure
      .input(z.object({
        type: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().default(100),
      }))
      .query(async ({ input }) => {
        if (input.search) return searchGraphNodes(input.search, input.limit);
        if (input.type) return getGraphNodesByType(input.type, input.limit);
        return getAllGraphNodes();
      }),
    nodeStats: publicProcedure.query(async () => {
      return getGraphNodeStats();
    }),
    edgeStats: publicProcedure.query(async () => {
      return getGraphEdgeStats();
    }),
    communities: publicProcedure
      .input(z.object({ level: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return getAllCommunities(input?.level);
      }),
    buildCommunities: protectedProcedure.mutation(async () => {
      return buildCommunities();
    }),
    visualization: publicProcedure
      .input(z.object({ limit: z.number().default(200) }).optional())
      .query(async ({ input }) => {
        return getGraphVisualizationData(input?.limit || 200);
      }),
  }),

  // ─── Embeddings ─────────────────────────────────────────────────────────────
  embeddings: router({
    collections: publicProcedure.query(async () => {
      const names = await listCollections();
      const stats = await Promise.all(
        names.map(async name => {
          const s = await getCollectionStats(name);
          return { name, count: s.count };
        })
      );
      return stats;
    }),
  }),

  // ─── GraphRAG Query ─────────────────────────────────────────────────────────
  rag: router({
    query: protectedProcedure
      .input(z.object({ query: z.string().min(3) }))
      .mutation(async ({ input, ctx }) => {
        return graphRAGQuery(input.query, ctx.user.id);
      }),
    history: protectedProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ ctx, input }) => {
        return getRecentRagQueries(ctx.user.id, input?.limit || 20);
      }),
  }),
});

export type AppRouter = typeof appRouter;
