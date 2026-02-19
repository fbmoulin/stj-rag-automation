import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";
import { checkRateLimit } from "./rate-limit";
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
import { getCollectionStats, listCollections } from "./embeddings";
import { buildCommunities, getGraphVisualizationData } from "./graph-engine";
import { graphRAGQuery } from "./graphrag-query";
import { updateResourceStatus } from "./db";
import { enqueueResourceProcess, enqueueDocumentProcess, getResourceQueue } from "./queue/queues";

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

        // Queue async job if Redis is available
        const jobId = await enqueueResourceProcess(input.resourceId);
        if (jobId) {
          await updateResourceStatus(input.resourceId, "queued");
          return { jobId, status: "queued" as const, resourceId: input.resourceId };
        }

        // Fallback: synchronous processing (no Redis)
        throw new Error("Async processing required — REDIS_URL not configured");
      }),
    status: publicProcedure
      .input(z.object({ resourceId: z.string() }))
      .query(async ({ input }) => {
        const resource = await getResourceByResourceId(input.resourceId);
        if (!resource) throw new Error("Resource not found");

        // Try to get job progress from BullMQ
        const queue = getResourceQueue();
        let jobProgress: number | undefined;
        if (queue) {
          const jobs = await queue.getJobs(["active", "waiting", "completed", "failed"]);
          const job = jobs.find(j => j.data.resourceId === input.resourceId);
          if (job) {
            const progress = job.progress;
            jobProgress = typeof progress === "number" ? progress : undefined;
          }
        }

        return {
          resourceId: input.resourceId,
          status: resource.status,
          progress: jobProgress,
          error: resource.errorMessage || undefined,
        };
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
        filename: z.string().max(500),
        mimeType: z.string().max(100),
        base64Data: z.string().max(10_485_760), // ~7.5 MB file limit (base64 overhead)
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

        // Queue async job if Redis is available
        const jobId = await enqueueDocumentProcess(input.documentId);
        if (jobId) {
          return { jobId, status: "queued" as const, documentId: input.documentId };
        }

        // Fallback: synchronous processing (no Redis)
        throw new Error("Async processing required — REDIS_URL not configured");
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
        const limit = checkRateLimit(`rag:${ctx.user.id}`, 10, 60_000);
        if (!limit.allowed) {
          throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s`);
        }
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
