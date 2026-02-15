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

3. Testes:

   pnpm test

4. Typecheck:

   pnpm run check

Build e produção

1. Build:

   pnpm build

2. Start (produção):

   NODE_ENV=production node dist/index.js

Principais endpoints

- GET /metrics — Prometheus-format metrics
- /api/trpc — tRPC API
- /api/oauth/callback — OAuth callback

Nota sobre vetor store

- O projeto agora usa Qdrant como vetor store persistente. Para rodar localmente, ative o serviço `qdrant` no `docker-compose.yml` e defina `QDRANT_URL=http://qdrant:6333` no ambiente. Consulte `DEPLOY_PLAN.md` para instruções de migração e operação.

Deploy

Ver `DEPLOY_PLAN.md` para o plano de deploy detalhado (migrations, infra, rollback).

Contribuição

- Siga o padrão de commits e crie PRs pequenos e testados.
-- Atualize `todo.md` ao completar tasks.
