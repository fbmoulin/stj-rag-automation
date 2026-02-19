# STJ RAG Automation

Full-stack GraphRAG system for Brazilian STJ jurisprudence. Ingests open data from STJ's CKAN API, builds a knowledge graph, generates Gemini embeddings, and provides a chat-based RAG query interface.

## Stack

- **Frontend:** React 19 + Vite 7 + shadcn/ui + wouter + tRPC client
- **Backend:** Express 4 + tRPC 11 + Drizzle ORM + MySQL 8 + BullMQ
- **Vector store:** Qdrant (sole vector store)
- **Embeddings:** Gemini `gemini-embedding-001` (768d)
- **Auth:** JWT password-based (`jose`) + cookie sessions (30d, sameSite: lax)
- **Storage:** Supabase Storage (S3-compatible)
- **Observability:** Pino structured logs + `/metrics` (Prometheus format) + `/health`
- **Linting:** ESLint 10 + @typescript-eslint 8.56 + Prettier
- **CI/CD:** GitHub Actions (test + typecheck + build)
- **Deploy:** Railway (live at `stj-rag-production.up.railway.app`)

## Quick Start

```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server (http://localhost:3000)
pnpm test             # Run all tests (59 passing, 10 suites)
pnpm run check        # TypeScript type check (0 errors)
pnpm lint             # ESLint (0 errors)
pnpm build            # Build for production
```

## Production

```bash
NODE_ENV=production node dist/index.js
```

Or via Docker:

```bash
docker compose up --build
```

## Tests (59 passing, 10 suites)

| Suite | Tests | Type |
|-------|:-----:|------|
| chunker.test.ts | 15 | Pure functions |
| entity-extractor.test.ts | 9 | Mock LLM |
| graph-engine.test.ts | 9 | Pure + Mock DB |
| graphrag-query.test.ts | 6 | Mock all |
| document-processor.test.ts | 6 | Mock DB + embeddings |
| stj-extractor.test.ts | 5 | Static data |
| vector/qdrant.test.ts | 3 | Mock fetch |
| storage.test.ts | 3 | Mock Supabase |
| embeddings.test.ts | 2 | Mock fetch + retry |
| auth.logout.test.ts | 1 | Cookie clearing |

## Key Endpoints

- `GET /health` — Health check (used by Docker HEALTHCHECK and Railway)
- `GET /metrics` — Prometheus-format metrics
- `POST /api/auth/login` — Password-based login
- `/api/trpc` — tRPC API (all business logic)

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `DATABASE_URL` | Yes | MySQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `ADMIN_PASSWORD` | Yes | Login password |
| `GEMINI_API_KEY` | Yes | Gemini embeddings API key |
| `QDRANT_URL` | Yes | Qdrant vector store URL |
| `QDRANT_API_KEY` | No | Qdrant auth token |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |

## Scripts

- `pnpm qdrant:test-ingest` — Test ingest to Qdrant (uses GEMINI_API_KEY)
- `pnpm qdrant:import` — Import JSON embeddings to Qdrant
- `pnpm tsx scripts/gemini_gcs_batch.ts <input> <collection>` — Async batch embeddings via GCS

## Architecture

See `CLAUDE.md` for full architecture documentation.

## Deploy

See `DEPLOY_PLAN.md` for the detailed deploy plan (Docker, Railway, migrations, rollback).

## Recent Changes (v1.0.2)

- Replaced Manus platform dependencies with self-hosted auth (JWT), storage (Supabase), LLM (Gemini direct)
- Removed ChromaDB — Qdrant is the sole vector store
- Added BullMQ async pipeline for resource/document processing
- Hardened security: timing-safe password comparison, Supabase error handling, 30d session duration, sameSite: lax cookies
- Added DB indexes, combined dashboard stats query, RAG rate limiting
- Added /health endpoint, graceful shutdown, env validation, .dockerignore
- Added ESLint + TypeScript ESLint (0 errors, flat config)
- Enhanced logger: silent in test, pretty in dev, JSON in prod
- Deployed to Railway (`stj-rag-production.up.railway.app`)
