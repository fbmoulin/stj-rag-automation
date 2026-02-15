# STJ RAG Automation

Projeto para ingestão, extração e consulta semântica de dados jurídicos do STJ (GraphRAG + RAG).

Principais componentes

- Backend (Express + tRPC): ingestão, processamento, embeddings, armazenamento vetorial (Qdrant).
- Frontend (Vite + React): dashboard, uploads, consultas RAG.
- Storage: storage proxy (BUILT_IN_FORGE) ou S3.
- Observability: logs (pino) + /metrics (Prometheus format).

Quick start (desenvolvimento)

1. Instalar dependências:

   pnpm install

2. Rodar em dev:

   pnpm dev

3. Testes (58 passing, 10 suites):

   pnpm test

4. Typecheck:

   pnpm run check

Build e produção

1. Build:

   pnpm build

2. Start (produção):

   NODE_ENV=production node dist/index.js

Scripts úteis

- `pnpm qdrant:test-ingest` — teste de ingest em Qdrant (usa GEMINI_API_KEY)
- `pnpm qdrant:import` — importa JSON de embeddings para Qdrant (scripts/qdrant_import.ts)
- `pnpm tsx scripts/gemini_gcs_batch.ts <input.txt> <collection>` — executa fluxo async batch via GCS (requer SA/GCP envs)
- `pnpm tsx scripts/setup_gcp_bucket.ts <GCP_PROJECT>` — cria bucket e service account via gcloud (requer gcloud autenticado)
- `pnpm tsx scripts/gemini_async_probe.ts` — testa formatos/payloads do endpoint asyncBatchEmbedContent

Principais endpoints

- GET /metrics — Prometheus-format metrics
- /api/trpc — tRPC API
- /api/oauth/callback — OAuth callback

Vetor store

- O projeto usa Qdrant como vetor store persistente.
- Para rodar localmente via docker-compose: `docker-compose up --build` (inclui service `qdrant`).
- Defina `QDRANT_URL=http://qdrant:6333` e `QDRANT_API_KEY` se necessário.

Async batch embeddings

- Para batch assíncrono (recomendado para grandes volumes) usamos a API asyncBatchEmbedContent com GCS.
- Veja `scripts/gemini_gcs_batch.ts` e `scripts/setup_gcp_bucket.ts` — ambos requerem credenciais GCP.

Testes

O projeto possui 58 testes unitários passando em 10 suites:

| Suite | Testes | Tipo |
|-------|:------:|------|
| chunker.test.ts | 15 | Pure functions |
| entity-extractor.test.ts | 9 | Mock LLM |
| graph-engine.test.ts | 9 | Pure + Mock DB |
| graphrag-query.test.ts | 6 | Mock all |
| document-processor.test.ts | 6 | Mock DB + embeddings |
| stj-extractor.test.ts | 5 | Static data |
| vector/qdrant.test.ts | 3 | Mock fetch |
| storage.test.ts | 3 | Mock fetch + ENV |
| auth.logout.test.ts | 1 | Existing |
| embeddings.test.ts | 1 | Needs GEMINI_API_KEY |

Deploy

Ver `DEPLOY_PLAN.md` para o plano de deploy detalhado (migrations, infra, rollback).

Contribuição

- Siga o padrão de commits e crie PRs pequenos e testados.
- Atualize `todo.md` ao completar tasks.
