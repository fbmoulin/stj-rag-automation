# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack GraphRAG system for Brazilian STJ jurisprudence. Ingests open data from STJ's CKAN API, builds a knowledge graph, generates embeddings (Gemini or local GPU), and provides a chat-based RAG query interface.

## Commands

```bash
pnpm install                        # Install dependencies
pnpm dev                            # Dev server with hot reload (http://localhost:3000)
pnpm build                          # Vite (client) + esbuild (server) → dist/
pnpm test                           # Run all tests (vitest run)
pnpm test server/chunker.test.ts    # Single test file
pnpm run check                      # TypeScript type check (tsc --noEmit)
pnpm lint                           # ESLint flat config
pnpm lint:fix                       # ESLint with auto-fix
pnpm db:push                        # Drizzle generate + migrate
```

## Tech Stack

- **Frontend:** React 19 + Vite 7 + shadcn/ui + wouter (routing) + tRPC client
- **Backend:** Express 4 + tRPC 11 + Drizzle ORM + MySQL 8 + BullMQ
- **Vector store:** Qdrant (sole — ChromaDB removed)
- **Embeddings:** Gemini `gemini-embedding-001` (768d) OR local GPU via `EMBEDDING_PROVIDER=local`
- **Auth:** JWT password-based (`jose`) + httpOnly cookie sessions (30d)
- **Storage:** Supabase Storage (S3-compatible)
- **LLM:** Gemini API direct
- **Package manager:** pnpm
- **Testing:** Vitest 2 (node environment)
- **Linting:** ESLint 10 + @typescript-eslint 8 (flat config: `eslint.config.mjs`)
- **Deploy:** Railway + Docker

## Architecture

### Processing Pipeline

```
STJ CKAN API → Download → Chunk (1000 chars, 200 overlap) → Extract Entities (LLM) → Embed → Qdrant
```

### Embedding Providers (server/embeddings.ts)

Controlled by `EMBEDDING_PROVIDER` env var:

- **`gemini`** (default): Gemini API with `batchEmbedContents`, 768d. Requires `GEMINI_API_KEY`.
- **`local`**: Local GPU service via HTTP. Requires `LOCAL_EMBEDDING_URL` (default `http://localhost:8100`). Uses `intfloat/multilingual-e5-base` (768d). Auto-prefixes `"passage: "` for documents, `"query: "` for queries.

Switching providers requires re-indexing Qdrant — vector spaces are incompatible.

### Core Modules (server/)

| Module | Purpose |
|--------|---------|
| `embeddings.ts` | Dual-provider embeddings (Gemini/local GPU) + Qdrant storage |
| `stj-extractor.ts` | STJ CKAN API client (12 datasets) |
| `chunker.ts` | Semantic text chunking (sentence boundaries) |
| `entity-extractor.ts` | LLM entity/relationship extraction (9 entity types) |
| `graph-engine.ts` | In-memory graph + Leiden community detection |
| `graphrag-query.ts` | Local/global/hybrid GraphRAG query engine |
| `document-processor.ts` | PDF/DOCX/TXT text extraction |
| `vector/qdrant.ts` | Qdrant HTTP client with retry |
| `db.ts` | Drizzle ORM queries |
| `queue/` | BullMQ queues + worker (no-op if Redis absent) |
| `routers.ts` | All tRPC routes |

### Core Framework (server/_core/)

`index.ts` (Express setup, /health, auth login, shutdown), `auth.ts` (JWT 30d), `cookies.ts`, `env.ts` (startup validation), `logger.ts` (Pino), `context.ts` (tRPC context), `trpc.ts` (publicProcedure, protectedProcedure, adminProcedure).

These files are editable (self-hosted) but keep changes minimal.

### Database (MySQL 8, 9 tables)

users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries

### Frontend

React 19 + wouter pages: Home (dashboard), Datasets, Documents, Graph (visualization), Query (RAG chat), Logs. tRPC client with React Query 5.

## Tests (61 passing, 10 suites)

### Mock Patterns

```typescript
// Logger — suppress in all test files
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// LLM
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

// DB — only mock functions the module imports
vi.mock("./db", () => ({ getAllGraphNodes: vi.fn(), getAllGraphEdges: vi.fn() }));

// Embeddings provider switch — use vi.stubEnv before vi.resetModules + dynamic import
vi.stubEnv("EMBEDDING_PROVIDER", "local");
vi.resetModules();
const { generateBatchEmbeddings } = await import("./embeddings");
```

## Critical Gotchas

- **Gemini default dimension is 3072, NOT 768.** Always set `outputDimensionality: 768` in every `embedContent`/`batchEmbedContents` call.
- **Qdrant silent vector drop:** Upserts with wrong dimension return HTTP 200 "acknowledged" but store 0 points — no error thrown.
- **Drizzle mysql2 `db.execute()`:** Returns `[rows, fields]` tuple — destructure as `const [resultRows] = rows` then `resultRows[0]`.
- **`batchEmbedContents`** is synchronous (not `asyncBatchEmbedContent`). Each request in the batch needs its own `model`, `content`, `taskType`, `outputDimensionality`.
- **e5 prefix convention:** When using local GPU provider, texts must be prefixed with `"query: "` or `"passage: "`. The embeddings module handles this automatically.
- **Env validation:** Missing required vars in production cause `process.exit(1)`.

## Environment Variables

**Required:** `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `QDRANT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

**Required for Gemini provider:** `GEMINI_API_KEY`

**Optional:** `EMBEDDING_PROVIDER` (gemini|local), `LOCAL_EMBEDDING_URL` (default http://localhost:8100), `QDRANT_API_KEY`, `REDIS_URL`, `NODE_ENV`, `PORT`, `LOG_LEVEL`, `EMBEDDING_DIMENSION` (default 768), `EMBEDDING_BATCH_SIZE` (default 50)

## Coding Patterns

- Structured logging: `logger.info({ key: value }, 'message')` — never string concatenation
- All protected tRPC routes use `protectedProcedure` (checks JWT cookie)
- Timing-safe password comparison in login (`crypto.timingSafeEqual`)
- Supabase calls always destructure `{ data, error }` and check error
- Entity types: MINISTRO, PROCESSO, ORGAO_JULGADOR, TEMA, LEGISLACAO, PARTE, PRECEDENTE, DECISAO, CONCEITO_JURIDICO
- `fetchWithRetry` in both embeddings.ts and qdrant.ts: 3 attempts, exponential backoff with jitter

## Deployment

- `Dockerfile` — multi-stage (Node 20 Alpine, non-root user, HEALTHCHECK)
- `docker-compose.yml` — MySQL 8 + Qdrant + Redis 7 + App (with healthchecks)
- `.github/workflows/ci.yml` — type check + test + build
- `.github/workflows/deploy.yml` — auto-deploy to Railway on push to main
- **Live:** `https://stj-rag-production.up.railway.app`

## Scripts

| Script | Usage |
|--------|-------|
| `scripts/reindex_local_gpu.ts` | Re-index Qdrant with local GPU embeddings (fetches STJ data) |
| `scripts/supabase_embed_and_upsert.ts` | Embed text file/JSONL and upsert to Qdrant |
| `scripts/qdrant_import.ts` | Import pre-computed embeddings into Qdrant |
