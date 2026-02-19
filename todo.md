# Project TODO

## Core Infrastructure (DONE)

- [x] Database schema: users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries (9 tables, MySQL 8 via Drizzle)
- [x] Install dependencies: pdf-parse, mammoth, axios, drizzle-orm, zod, pino, p-limit, jose, bullmq

## Backend (DONE)

- [x] STJ CKAN API integration with Cloudflare bypass (12 datasets, stj-extractor.ts)
- [x] Dataset download manager (syncDatasets, downloadResource)
- [x] JSON processor - extract legal fields (processSTJRecords in chunker.ts)
- [x] Semantic chunking engine for long legal texts (1000 chars, 200 overlap, sentence-boundary aware)
- [x] Gemini embeddings generation + Qdrant storage
- [x] Document upload handler (PDF, DOCX, TXT) with text extraction (document-processor.ts)
- [x] RAG query engine - GraphRAG with local/global/hybrid search (graphrag-query.ts)
- [x] Extraction logs and audit trail (extractionLogs table + reasoning chain for CNJ 615/2025)
- [x] Supabase Storage (storage.ts — replaced Manus Forge proxy)
- [x] Qdrant HTTP client wrapper with retry (vector/qdrant.ts)
- [x] BullMQ async pipeline for resource/document processing (queue/)
- [x] DB indexes on high-frequency query columns
- [x] Combined dashboard stats query (single DB call)
- [x] Rate limiting for RAG queries (rate-limit.ts)

## Frontend (DONE)

- [x] Dark theme with Lex Intelligentia identity (ThemeContext, dark default)
- [x] Dashboard with stats, dataset listing, and extraction controls (Home.tsx)
- [x] Dataset detail view with resources and metadata (Datasets.tsx)
- [x] Document upload interface with size limits (Documents.tsx)
- [x] RAG query interface with chat-like UX (Query.tsx + AIChatBox.tsx)
- [x] Extraction logs and history view (Logs.tsx)
- [x] Processing statistics and progress indicators (Home.tsx dashboard)
- [x] Knowledge graph visualization (Graph.tsx)

## GraphRAG (DONE)

- [x] Migrar de RAG simples para GraphRAG com grafo de conhecimento
- [x] Extração de entidades jurídicas (9 tipos: MINISTRO, PROCESSO, ORGAO_JULGADOR, TEMA, LEGISLACAO, PARTE, PRECEDENTE, DECISAO, CONCEITO_JURIDICO)
- [x] Construção de grafo de relações entre entidades (12 tipos: RELATOR_DE, JULGADO_POR, REFERENCIA, CITA_PRECEDENTE, etc.)
- [x] Detecção de comunidades (Leiden) e sumarização hierárquica via LLM
- [x] Motor de consulta local (entidades específicas) e global (temas amplos) + híbrido
- [x] Visualização interativa do grafo de conhecimento no frontend

## Security Hardening (DONE)

- [x] P0: Timing-safe password comparison (crypto.timingSafeEqual)
- [x] P0: Supabase Storage error handling on createSignedUrl (storagePut + storageGet)
- [x] P1: Upload size limits
- [x] P1: Storage null crash fix
- [x] P2: Log errors in DashboardLayout catch block
- [x] P2: Reduce session duration 365d → 30d
- [x] P2: Log JWT verification failures (debug level)
- [x] P2: Remove unused Manus env vars from env.ts
- [x] P2: Cookie sameSite "none" → "lax"

## Tests (DONE — 59 passing, 10 suites)

- [x] chunker.test.ts (15 tests, pure functions)
- [x] entity-extractor.test.ts (9 tests, mock LLM)
- [x] graph-engine.test.ts (9 tests, pure + mock DB)
- [x] graphrag-query.test.ts (6 tests, mock all)
- [x] document-processor.test.ts (6 tests, mock DB+embeddings)
- [x] stj-extractor.test.ts (5 tests, static data)
- [x] vector/qdrant.test.ts (3 tests, mock fetch)
- [x] storage.test.ts (3 tests, mock Supabase)
- [x] embeddings.test.ts (2 tests, mock fetch + retry)
- [x] auth.logout.test.ts (1 test, cookie clearing)

## Deploy Infrastructure (DONE)

- [x] Dockerfile (multi-stage, pnpm 10, HEALTHCHECK, STOPSIGNAL)
- [x] docker-compose.yml (healthchecks, service_healthy, env vars)
- [x] .dockerignore
- [x] /health endpoint + graceful shutdown (SIGTERM/SIGINT)
- [x] Startup env validation (fail fast on missing vars)
- [x] GitHub Actions CI (.github/workflows/ci.yml)
- [x] railway.toml

## Pending

- [ ] Deploy: provision Railway MySQL + Qdrant Cloud + Supabase bucket
- [ ] Integration tests for full pipeline
- [ ] tRPC router tests
- [ ] Incremental download with version control for STJ datasets
- [ ] Reranking step in RAG query pipeline
- [ ] Source citations in RAG responses (link to specific acórdão/chunk)
- [ ] Drag-and-drop in document upload UI
- [ ] Backup automation for MySQL + Qdrant data
