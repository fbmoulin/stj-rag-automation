# Project Index: STJ RAG Automation

Generated: 2026-02-15

## Overview

Full-stack **GraphRAG** system for Brazilian STJ (Superior Tribunal de Justiça) jurisprudence. Ingests open data from STJ's CKAN API, builds a knowledge graph with entities/relationships, generates embeddings, and provides a chat-based RAG query interface.

**Built on the Manus platform** (`_core/` directories are framework-provided).

## Project Structure

```
stj-rag-automation/
├── client/src/          # React frontend (Vite + shadcn/ui + wouter)
│   ├── pages/           # 7 pages: Home, Datasets, Documents, Graph, Query, Logs, NotFound
│   ├── components/      # AIChatBox, DashboardLayout, Map + 50 shadcn/ui components
│   ├── lib/trpc.ts      # tRPC client setup
│   └── contexts/        # ThemeContext (dark/light)
├── server/              # Backend (Express + tRPC)
│   ├── routers.ts       # All tRPC routes (auth, dashboard, datasets, resources, documents, graph, embeddings, rag)
│   ├── stj-extractor.ts # STJ CKAN API client (12 datasets, Cloudflare bypass)
│   ├── chunker.ts       # Semantic text chunking (1000 chars, 200 overlap)
│   ├── embeddings.ts    # Gemini embeddings + ChromaDB/Qdrant dual storage
│   ├── entity-extractor.ts # LLM-based entity/relationship extraction (9 entity types, 12 relationship types)
│   ├── graph-engine.ts  # In-memory graph + Leiden community detection + LLM summarization
│   ├── graphrag-query.ts # Local/global/hybrid GraphRAG query engine
│   ├── document-processor.ts # PDF/DOCX/TXT text extraction
│   ├── storage.ts       # S3-compatible file storage
│   ├── db.ts            # Drizzle ORM queries
│   ├── vector/qdrant.ts # Qdrant HTTP client wrapper
│   └── _core/           # Manus framework (DO NOT EDIT)
├── shared/              # Shared types (re-exports from drizzle/schema)
├── drizzle/             # DB schema + migrations (MySQL 8)
│   ├── schema.ts        # 8 tables: users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries
│   └── 0000-0002.sql    # 3 migrations
├── scripts/             # CLI utilities (11 scripts)
└── docs/                # GET_API_KEYS, RECOMMENDATIONS, ROADMAP
```

## Entry Points

- **Dev server:** `pnpm dev` → `tsx watch server/_core/index.ts`
- **Build:** `pnpm build` → Vite (client) + esbuild (server)
- **Production:** `pnpm start` → `node dist/index.js`
- **Tests:** `pnpm test` → `vitest run`
- **Type check:** `pnpm check` → `tsc --noEmit`

## Core Modules

### stj-extractor.ts
- Fetches from `dadosabertos.web.stj.jus.br/api/3/action`
- 12 known datasets (espelhos de acórdãos, atas, decisões)
- Cloudflare bypass via browser-like headers
- Exports: `syncDatasets()`, `downloadResource()`, `getStaticDatasetList()`

### chunker.ts
- Semantic chunking with sentence-boundary awareness
- Default: 1000 chars, 200 overlap
- Exports: `chunkText()`, `processSTJRecords()`, `TextChunk` type

### embeddings.ts
- Gemini `gemini-embedding-001` (768 dimensions)
- Dual storage: ChromaDB + Qdrant (fallback-aware)
- Configurable batch size, retries, concurrency
- Exports: `storeChunksInChroma()`, `queryChroma()`, `queryMultipleCollections()`, `listCollections()`, `getCollectionStats()`

### entity-extractor.ts
- LLM-based extraction via `invokeLLM()`
- 9 entity types: MINISTRO, PROCESSO, ORGAO_JULGADOR, TEMA, LEGISLACAO, PARTE, PRECEDENTE, DECISAO, CONCEITO_JURIDICO
- 12 relationship types: RELATOR_DE, JULGADO_POR, REFERENCIA, CITA_PRECEDENTE, TRATA_DE, etc.
- Exports: `extractEntitiesFromChunks()`, `extractQueryEntities()`

### graph-engine.ts
- In-memory adjacency list from DB edges
- Simplified Leiden algorithm for community detection
- LLM-generated community summaries
- Exports: `buildCommunities()`, `getGraphVisualizationData()`, `getEntityNeighborhood()`

### graphrag-query.ts
- Query classification: local (entity-centric) / global (community-based) / hybrid
- Combines vector search + graph traversal + community reports
- Reasoning chain for audit (CNJ 615/2025 compliance)
- Exports: `graphRAGQuery()`, `GraphRAGResult` type

### document-processor.ts
- PDF (pdf-parse), DOCX (mammoth), TXT extraction
- Full pipeline: extract → chunk → embed
- Exports: `processDocument()`, `extractText()`

### vector/qdrant.ts
- Lightweight Qdrant HTTP client (no SDK dependency)
- Retry with exponential backoff
- Exports: `isQdrantConfigured()`, `ensureCollection()`, `upsertPoints()`, `searchCollection()`

## Database Schema (MySQL 8 via Drizzle)

| Table | Purpose |
|-------|---------|
| `users` | Auth users (openId, role) |
| `datasets` | STJ dataset registry (slug, title, category) |
| `resources` | Dataset resources with processing status pipeline |
| `documents` | User-uploaded documents (PDF/DOCX/TXT) |
| `graphNodes` | Knowledge graph entities (entityId, type, communityId) |
| `graphEdges` | Knowledge graph relationships (source, target, type, weight) |
| `communities` | Leiden community hierarchy (title, summary, fullReport) |
| `extractionLogs` | Audit trail for all pipeline actions |
| `ragQueries` | Query history with reasoning chains |

## tRPC API Surface

| Router | Procedures |
|--------|-----------|
| `auth` | `me` (query), `logout` (mutation) |
| `dashboard` | `stats`, `recentLogs` |
| `datasets` | `list`, `getBySlug`, `sync` (protected), `resourceStats` |
| `resources` | `list`, `download` (protected), `process` (protected) |
| `documents` | `list`, `listAll`, `upload` (protected), `process` (protected) |
| `graph` | `nodes`, `nodeStats`, `edgeStats`, `communities`, `buildCommunities` (protected), `visualization` |
| `embeddings` | `collections` |
| `rag` | `query` (protected), `history` (protected) |

## Frontend Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | Home | Dashboard with stats |
| `/datasets` | Datasets | STJ dataset browser |
| `/documents` | Documents | Document upload/management |
| `/graph` | Graph | Knowledge graph visualization |
| `/query` | Query | RAG chat interface |
| `/logs` | Logs | Extraction audit trail |

## Configuration

| File | Purpose |
|------|---------|
| `drizzle.config.ts` | Drizzle ORM (MySQL connection) |
| `vite.config.ts` | Vite dev server + build |
| `vitest.config.ts` | Test runner config |
| `tsconfig.json` | TypeScript settings |
| `components.json` | shadcn/ui component config |
| `docker-compose.yml` | MySQL 8 + App + Qdrant |
| `.env.example` | All env vars documented |

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@trpc/server` + `client` | Type-safe API layer |
| `drizzle-orm` + `mysql2` | Database ORM |
| `chromadb` | Vector store (primary) |
| `axios` | STJ API + HTTP client |
| `pdf-parse` | PDF text extraction |
| `mammoth` | DOCX text extraction |
| `recharts` | Dashboard charts |
| `wouter` | Client-side routing |
| `zod` | Schema validation |
| `jose` | JWT auth |
| `pino` | Structured logging |
| `p-limit` | Concurrency control |

## Infrastructure

- **Docker Compose:** MySQL 8.0 + App + Qdrant
- **CI:** GitHub Actions (Node 20, pnpm, test → typecheck → build)
- **Package manager:** pnpm 10.4.1
- **Runtime:** Node.js (tsx for dev)

## Quick Start

```bash
cp .env.example .env  # Configure API keys
docker compose up -d  # Start MySQL + Qdrant
pnpm install
pnpm db:push          # Run migrations
pnpm dev              # http://localhost:3000
```

## Scripts

| Command | Script | Description |
|---------|--------|-------------|
| `pnpm qdrant:import` | `scripts/qdrant_import.ts` | Import data into Qdrant |
| `pnpm qdrant:test-ingest` | `scripts/qdrant_test_ingest.ts` | Test Qdrant ingestion |
| `pnpm gemini:list-models` | `scripts/gemini_list_models.ts` | List available Gemini models |
| `pnpm embeddings:supabase` | `scripts/supabase_embed_and_upsert.ts` | Embed + upsert via Supabase |

## File Counts

- **Source files:** 110 (79 client + 20 server + 11 scripts)
- **UI components:** ~50 (shadcn/ui)
- **Custom components:** 5 (AIChatBox, DashboardLayout, ErrorBoundary, ManusDialog, Map)
- **Pages:** 7
- **Tests:** 10 files, 58 passing (chunker, entity-extractor, graph-engine, graphrag-query, document-processor, stj-extractor, qdrant, storage + 2 existing)
- **DB migrations:** 3
