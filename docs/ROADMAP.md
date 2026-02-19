# Roadmap — STJ RAG Automation

## Phase 0 — Foundation (DONE)

- [x] Database schema (9 tables, MySQL 8 via Drizzle)
- [x] STJ CKAN API integration with Cloudflare bypass
- [x] Semantic chunking, entity extraction, GraphRAG query engine
- [x] Frontend dashboard, uploads, RAG chat, graph visualization
- [x] Dockerfile + docker-compose.yml + CI workflow

## Phase 1 — Platform Migration (DONE)

- [x] Replace Manus OAuth with JWT password auth
- [x] Replace Manus Forge storage with Supabase Storage
- [x] Replace Manus LLM proxy with direct Gemini API
- [x] Remove ChromaDB — Qdrant sole vector store
- [x] Remove 12 Manus legacy modules
- [x] BullMQ async pipeline for resource/document processing

## Phase 2 — Security Hardening (DONE)

- [x] P0: Timing-safe password comparison (crypto.timingSafeEqual)
- [x] P0: Supabase error handling on all createSignedUrl calls
- [x] P1: Fix 12 TS errors, add upload limits, fix storage null crash
- [x] P2: Reduce session duration 365d → 30d
- [x] P2: Cookie sameSite "none" → "lax"
- [x] P2: Log errors in catch blocks (login + JWT verification)
- [x] P2: Remove unused Manus env vars

## Phase 3 — Performance (DONE)

- [x] DB indexes on high-frequency query columns
- [x] Combined dashboard stats query (single DB call instead of multiple)
- [x] Rate limiting for RAG queries

## Phase 4 — Testing (DONE — 59 tests, 10 suites)

- [x] 59 unit tests passing across 10 suites
- [x] Pure function tests (chunker, graph-engine)
- [x] Mock LLM tests (entity-extractor, graphrag-query)
- [x] Mock DB/fetch tests (document-processor, storage, qdrant, embeddings)
- [x] Auth tests (logout cookie clearing)

## Phase 5 — Deploy Infrastructure (DONE)

- [x] Dockerfile (multi-stage, pnpm 10, HEALTHCHECK, STOPSIGNAL)
- [x] docker-compose.yml (healthchecks, service_healthy depends_on)
- [x] /health endpoint + graceful shutdown (SIGTERM/SIGINT)
- [x] Startup env validation (fail fast on missing vars)
- [x] GitHub Actions CI (.github/workflows/ci.yml)
- [x] railway.toml with /health healthcheck

## Phase 6 — Production Deploy (NEXT)

- [ ] Provision Railway MySQL (or managed MySQL)
- [ ] Set up Qdrant Cloud (free tier)
- [ ] Create Supabase Storage bucket `documents` (private)
- [ ] Set Railway env vars and deploy
- [ ] Run migration: `railway run pnpm drizzle-kit migrate`
- [ ] Smoke test: `curl https://<app>.up.railway.app/health`

## Phase 7 — Enhancements (FUTURE)

- [ ] Integration tests for full pipeline
- [ ] tRPC router tests
- [ ] Incremental download with version control for STJ datasets
- [ ] Reranking step in RAG query pipeline
- [ ] Source citations in RAG responses (link to specific acórdão/chunk)
- [ ] Drag-and-drop in document upload UI
- [ ] Alerting integration (PagerDuty/Slack)
- [ ] Secrets manager + TLS + IAM hardening
- [ ] Backup automation for MySQL + Qdrant data
- [ ] Canary release, smoke tests, rollback plan
