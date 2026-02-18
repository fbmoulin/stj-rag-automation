# STJ RAG Clean Repo Design

**Date:** 2026-02-18
**Goal:** Create a clean STJ RAG repo by stripping Manus legacy code, fixing critical bugs, and adding BullMQ async processing.

## Approach

Port the 24 KEEP modules from `stj-rag-automation` into a clean repo, drop 8 Manus-only modules, fix 5 modules during port, add BullMQ for async pipeline.

## Modules

### KEEP (24 files)
- `server/chunker.ts` — text chunking with STJ metadata enrichment
- `server/entity-extractor.ts` — Gemini entity/relation extraction
- `server/graph-engine.ts` — Leiden community detection + graph construction
- `server/graphrag-query.ts` — hybrid local/global/vector RAG queries
- `server/stj-extractor.ts` — STJ CKAN API client + static dataset list
- `server/document-processor.ts` — PDF/DOCX/TXT extraction + embedding pipeline
- `server/storage.ts` — Supabase Storage upload/download
- `server/db.ts` — Drizzle ORM data access layer (9 MySQL tables)
- `server/vector/qdrant.ts` — Qdrant HTTP client
- `server/routers.ts` — tRPC router (7 sub-routers)
- `server/_core/auth.ts` — JWT password authentication
- `server/_core/llm.ts` — Gemini API via OpenAI-compatible endpoint
- `server/_core/logger.ts` — Pino logger
- `server/_core/env.ts` — env validation
- `server/_core/metrics.ts` — Prometheus metrics
- `server/_core/trpc.ts` — tRPC initialization
- `server/_core/context.ts` — tRPC context factory
- `server/_core/cookies.ts` — secure cookie options
- `server/_core/index.ts` — Express server entry point
- `server/_core/static.ts` — production static file serving
- `server/_core/vite.ts` — Vite dev middleware
- `server/_core/systemRouter.ts` — health endpoint
- `server/_core/types/cookie.d.ts` — type declaration
- Frontend: all pages, components, hooks (minus Manus components)

### DROP (8 files)
- `server/_core/sdk.ts` — Manus OAuth (replaced by auth.ts)
- `server/_core/oauth.ts` — Manus OAuth callback
- `server/_core/dataApi.ts` — Manus Forge data proxy
- `server/_core/imageGeneration.ts` — Manus Forge image gen
- `server/_core/map.ts` — Manus Forge Maps
- `server/_core/notification.ts` — Manus Forge push notifications
- `server/_core/voiceTranscription.ts` — Manus Forge Whisper
- `server/_core/types/manusTypes.ts` — Manus protobuf types
- `client/src/components/AIChatBox.tsx` — Manus chat widget
- `client/src/components/ManusDialog.tsx` — Manus dialog
- `client/src/components/Map.tsx` — Manus maps

### FIX during port (5 files)
1. `document-processor.ts` — Replace broken pdf-parse API with pdfjs-dist
2. `embeddings.ts` — Remove ChromaDB fallback, Qdrant-only
3. `env.ts` — Remove 5 Manus legacy vars
4. `systemRouter.ts` — Remove notifyOwner procedure
5. `routers.ts` — Add BullMQ queue for resources.process and documents.process

## New: BullMQ Async Pipeline

### Architecture
```
POST /api/trpc/resources.process
  → Validate input
  → Queue job via BullMQ
  → Return { jobId, status: "queued" }

Worker (same process or separate):
  → Pop job from Redis queue
  → Download STJ resource
  → Chunk records
  → Extract entities (Gemini LLM)
  → Generate embeddings (Gemini)
  → Upsert to Qdrant
  → Build graph edges in MySQL
  → Update resource status at each step

Frontend polls:
  resources.status(resourceId) → { status, progress, error }
```

### Dependencies
- `bullmq` — Redis-backed job queue
- Redis — Railway plugin (~$3/mo)

## Stack
- Express 4 + tRPC 11
- MySQL 8 (Railway plugin) + Drizzle ORM
- Qdrant Cloud (768d Gemini embeddings)
- Supabase Storage (documents bucket)
- Gemini 2.5 Flash (LLM + embeddings)
- BullMQ + Redis (async pipeline)
- React 19 + Vite 7 + shadcn/ui
- Railway deploy

## Execution Plan
1. Delete Manus DROP files from current repo
2. Fix the 5 KEEP+FIX files
3. Add Redis plugin to Railway
4. Add BullMQ for async resources.process and documents.process
5. Add status polling endpoint
6. Test all 59 existing tests pass
7. Push to main → Railway auto-deploys
