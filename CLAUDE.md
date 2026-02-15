# CLAUDE.md — STJ RAG Automation

## Project Overview

Full-stack GraphRAG system for Brazilian STJ jurisprudence. Ingests open data from STJ's CKAN API, builds a knowledge graph, generates Gemini embeddings, and provides a chat-based RAG query interface.

## Tech Stack

- **Frontend:** React 19 + Vite 7 + shadcn/ui + wouter + tRPC client
- **Backend:** Express 4 + tRPC 11 + Drizzle ORM + MySQL 8
- **Vector:** ChromaDB + Qdrant (dual storage)
- **Embeddings:** Gemini `gemini-embedding-001` (768d)
- **LLM:** via `_core/llm.ts` (invokeLLM)
- **Package manager:** pnpm 10.4.1
- **Test runner:** Vitest 2

## Critical Rules

- **DO NOT EDIT** anything in `_core/` directories — these are Manus platform framework files
- **DO NOT EDIT** `client/src/_core/` or `server/_core/` — framework-provided
- `.env` is gitignored. Use `.env.example` as reference

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Dev server (http://localhost:3000)
pnpm build            # Build for production
pnpm test             # Run all tests (vitest run)
pnpm run check        # TypeScript type check
```

## Tests (58 passing, 10 suites)

```bash
pnpm test                                    # All tests
pnpm test server/chunker.test.ts             # Single file
```

### Test Architecture

- **Pure tests:** chunker.test.ts (15), graph-engine detectCommunities (5)
- **Mock LLM:** entity-extractor.test.ts (9), graphrag-query.test.ts (6)
- **Mock DB:** graph-engine.test.ts (9), document-processor.test.ts (6)
- **Mock fetch/ENV:** storage.test.ts (3), qdrant.test.ts (3)
- **Static data:** stj-extractor.test.ts (5)

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

### Known Issues

- `embeddings.test.ts` has 1 failing test that requires `GEMINI_API_KEY` env var

## Architecture

### Core Modules (server/)

| Module | Purpose |
|--------|---------|
| `stj-extractor.ts` | STJ CKAN API client (12 datasets) |
| `chunker.ts` | Semantic text chunking (1000 chars, 200 overlap) |
| `embeddings.ts` | Gemini embeddings + ChromaDB/Qdrant dual storage |
| `entity-extractor.ts` | LLM-based entity/relationship extraction (9 types) |
| `graph-engine.ts` | In-memory graph + Leiden community detection |
| `graphrag-query.ts` | Local/global/hybrid GraphRAG query engine |
| `document-processor.ts` | PDF/DOCX/TXT text extraction pipeline |
| `storage.ts` | S3-compatible file storage |
| `vector/qdrant.ts` | Qdrant HTTP client with retry |
| `db.ts` | Drizzle ORM queries (MySQL 8) |
| `routers.ts` | All tRPC routes |

### Database (MySQL 8, 9 tables)

users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries

### Frontend Pages

Home (dashboard), Datasets, Documents, Graph (visualization), Query (RAG chat), Logs

## Environment Variables

See `.env.example`. Key vars:
- `DATABASE_URL` — MySQL connection
- `GEMINI_API_KEY` — Gemini embeddings
- `QDRANT_URL` — Qdrant vector store
- `QDRANT_API_KEY` — Qdrant auth (optional)

## Deployment

- `Dockerfile` — multi-stage build
- `docker-compose.yml` — MySQL 8 + App + Qdrant
- `.github/workflows/ci.yml` — GitHub Actions (test + typecheck + build)
- `DEPLOY_PLAN.md` — detailed deploy plan

## Coding Patterns

- Structured logging: `logger.debug('msg', { key: value })` — never string concat
- All tRPC protected routes use `protectedProcedure`
- Entity types: MINISTRO, PROCESSO, ORGAO_JULGADOR, TEMA, LEGISLACAO, PARTE, PRECEDENTE, DECISAO, CONCEITO_JURIDICO
- Relationship types: RELATOR_DE, JULGADO_POR, REFERENCIA, CITA_PRECEDENTE, TRATA_DE, etc.
