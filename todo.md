# Project TODO

## Core Infrastructure (DONE)

- [x] Database schema: users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries (9 tables, MySQL 8 via Drizzle)
- [x] Install dependencies: chromadb, pdf-parse, mammoth, axios, drizzle-orm, zod, pino, p-limit, jose

## Backend (DONE)

- [x] STJ CKAN API integration with Cloudflare bypass (12 datasets, stj-extractor.ts)
- [x] Dataset download manager (syncDatasets, downloadResource)
- [x] JSON processor - extract legal fields (processSTJRecords in chunker.ts)
- [x] Semantic chunking engine for long legal texts (1000 chars, 200 overlap, sentence-boundary aware)
- [x] Gemini embeddings generation + dual storage (ChromaDB + Qdrant)
- [x] Document upload handler (PDF, DOCX, TXT) with text extraction (document-processor.ts)
- [x] RAG query engine - GraphRAG with local/global/hybrid search (graphrag-query.ts)
- [x] Extraction logs and audit trail (extractionLogs table + reasoning chain for CNJ 615/2025)
- [x] S3-compatible file storage (storage.ts)
- [x] Qdrant HTTP client wrapper with retry (vector/qdrant.ts)

## Frontend (DONE)

- [x] Dark theme with Lex Intelligentia identity (ThemeContext, dark default)
- [x] Dashboard with stats, dataset listing, and extraction controls (Home.tsx)
- [x] Dataset detail view with resources and metadata (Datasets.tsx)
- [x] Document upload interface (Documents.tsx)
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

## Pending

- [x] Tests: expand test coverage (DONE — 56 new tests, 58 total passing across 10 files)
  - [x] P1: chunker.test.ts (15 tests, pure functions)
  - [x] P1: entity-extractor.test.ts (9 tests, mock LLM)
  - [x] P1: graph-engine.test.ts (9 tests, pure + mock DB)
  - [x] P2: graphrag-query.test.ts (6 tests, mock all)
  - [x] P2: document-processor.test.ts (6 tests, mock DB+embeddings)
  - [x] P3: stj-extractor.test.ts (5 tests, static data)
  - [x] P3: vector/qdrant.test.ts (3 tests, mock fetch)
  - [x] P3: storage.test.ts (3 tests, mock fetch)
  - [ ] Integration tests for full pipeline (future)
  - [ ] tRPC router tests (future)
- [ ] Deploy: execute DEPLOY_PLAN.md (Docker multi-stage, MySQL gerenciado, Qdrant, observability)
- [ ] Incremental download with version control for STJ datasets
- [ ] Reranking step in RAG query pipeline
- [ ] Source citations in RAG responses (link to specific acórdão/chunk)
- [ ] Drag-and-drop in document upload UI
- [ ] Rate limiting and cost controls for Gemini API calls
- [ ] Backup automation for MySQL + Qdrant data
