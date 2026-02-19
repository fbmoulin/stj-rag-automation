# CLAUDE.md — STJ RAG Automation

## Project Overview

Full-stack GraphRAG system for Brazilian STJ jurisprudence. Ingests open data from STJ's CKAN API, builds a knowledge graph, generates Gemini embeddings, and provides a chat-based RAG query interface.

## Tech Stack

- **Frontend:** React 19 + Vite 7 + shadcn/ui + wouter + tRPC client
- **Backend:** Express 4 + tRPC 11 + Drizzle ORM + MySQL 8 + BullMQ
- **Vector:** Qdrant (sole vector store — ChromaDB removed)
- **Embeddings:** Gemini `gemini-embedding-001` (768d)
- **Auth:** JWT password-based (`jose`) + cookie sessions (30d, sameSite: lax)
- **Storage:** Supabase Storage (replaced Manus Forge proxy)
- **LLM:** Gemini API direct (`GEMINI_API_KEY`)
- **Package manager:** pnpm 10.4.1
- **Test runner:** Vitest 2
- **Linter:** ESLint 10 + @typescript-eslint 8.56 (flat config, `eslint.config.mjs`)
- **Deploy:** Railway (`stj-rag-production.up.railway.app`)

## Critical Rules

- `server/_core/` files are editable (self-hosted, no third-party platform dependencies) but keep changes minimal
- `.env` is gitignored. Required vars: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `GEMINI_API_KEY`, `QDRANT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Env validation runs at startup — missing required vars in production cause `process.exit(1)`

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server (http://localhost:3000)
pnpm build            # Build for production
pnpm test             # Run all tests (vitest run)
pnpm run check        # TypeScript type check
pnpm lint             # ESLint (0 errors, warnings only)
pnpm lint:fix         # ESLint with auto-fix
```

## Tests (59 passing, 10 suites)

```bash
pnpm test                                    # All tests
pnpm test server/chunker.test.ts             # Single file
```

### Test Architecture

- **Pure tests:** chunker.test.ts (15), graph-engine detectCommunities (5)
- **Mock LLM:** entity-extractor.test.ts (9), graphrag-query.test.ts (6)
- **Mock DB:** graph-engine.test.ts (9), document-processor.test.ts (6)
- **Mock fetch/ENV:** storage.test.ts (3), qdrant.test.ts (3), embeddings.test.ts (2)
- **Cookie/auth:** auth.logout.test.ts (1)

### Mock Patterns

```typescript
// Logger — suppress output in all test files
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// LLM — mock invokeLLM
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

// DB — mock specific functions used by module
vi.mock("./db", () => ({
  getAllGraphNodes: vi.fn(),
  getAllGraphEdges: vi.fn(),
  // ... only what the module imports
}));
```

## Architecture

### Core Modules (server/)

| Module | Purpose |
|--------|---------|
| `stj-extractor.ts` | STJ CKAN API client (12 datasets) |
| `chunker.ts` | Semantic text chunking (1000 chars, 200 overlap) |
| `embeddings.ts` | Gemini embeddings + Qdrant storage |
| `entity-extractor.ts` | LLM-based entity/relationship extraction (9 types) |
| `graph-engine.ts` | In-memory graph + Leiden community detection |
| `graphrag-query.ts` | Local/global/hybrid GraphRAG query engine |
| `document-processor.ts` | PDF/DOCX/TXT text extraction pipeline |
| `storage.ts` | Supabase Storage client |
| `vector/qdrant.ts` | Qdrant HTTP client with retry |
| `db.ts` | Drizzle ORM queries (MySQL 8) |
| `rate-limit.ts` | In-memory rate limiter for RAG queries |
| `queue/` | BullMQ queues + worker for async processing |
| `routers.ts` | All tRPC routes |

### Core Framework (server/_core/)

| Module | Purpose |
|--------|---------|
| `index.ts` | Express app setup, /health, /api/auth/login, graceful shutdown |
| `auth.ts` | JWT session tokens (30d), cookie-based auth |
| `cookies.ts` | Cookie options (httpOnly, sameSite: lax, secure) |
| `env.ts` | Startup env validation (fail fast in production) |
| `logger.ts` | Pino structured logger (silent in test, pretty in dev, JSON in prod) |
| `context.ts` | tRPC context creation |

### Database (MySQL 8, 9 tables)

users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries

### Frontend Pages

Home (dashboard), Datasets, Documents, Graph (visualization), Query (RAG chat), Logs

## Environment Variables

Required: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, `GEMINI_API_KEY`, `QDRANT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

Optional: `QDRANT_API_KEY`, `REDIS_URL`, `NODE_ENV`, `PORT`

## Deployment

- `Dockerfile` — multi-stage build (pnpm 10, HEALTHCHECK, STOPSIGNAL)
- `docker-compose.yml` — MySQL 8 + Qdrant + Redis 7 + App (healthchecks, service_healthy depends_on)
- `.github/workflows/ci.yml` — GitHub Actions (test + typecheck + build)
- `railway.toml` — Railway deploy config (/health healthcheck)
- **Live:** `https://stj-rag-production.up.railway.app` (MySQL + Qdrant Cloud + Supabase)
- `DEPLOY_PLAN.md` — detailed deploy plan

## Coding Patterns

- Structured logging: `logger.debug('msg', { key: value })` — never string concat
- All tRPC protected routes use `protectedProcedure`
- Timing-safe password comparison (`crypto.timingSafeEqual`) in login endpoint
- Supabase calls always check `{ data, error }` response
- Entity types: MINISTRO, PROCESSO, ORGAO_JULGADOR, TEMA, LEGISLACAO, PARTE, PRECEDENTE, DECISAO, CONCEITO_JURIDICO
- Relationship types: RELATOR_DE, JULGADO_POR, REFERENCIA, CITA_PRECEDENTE, TRATA_DE, etc.

## Security

- JWT sessions: 30d expiration (was 365d)
- Cookie: `httpOnly: true`, `sameSite: "lax"`, `secure` based on request protocol
- Password comparison: `crypto.timingSafeEqual` (constant-time)
- Supabase Storage: error handling on all `createSignedUrl` calls
- Rate limiting on RAG queries
- Upload size limits
- Startup env validation prevents running without required secrets
