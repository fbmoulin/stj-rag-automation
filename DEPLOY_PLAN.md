# Plano de Deploy — Versão 1 (detalhado)

Objetivo: colocar a primeira versão em produção com segurança, observabilidade e capacidade de rollback mínima.

Resumo do raciocínio (deep & wide)

- Considerei requisitos técnicos (DB relacional, vetorial, storage, OAuth, LLM costs) e opções de implantação (container vs VM).
- Tradeoffs: manter Chroma em memória é simples, mas não persistente → forçar persistência local ou adaptar pgvector/serviço vetorial mais tarde.
- Prioridade inicial: estabilidade da API, backups do DB, controle de custos de LLM, monitoramento mínimo (logs + /metrics).

Etapas (detalhado)

1. Preparação infra (pré-deploy)
   - Provisionar MySQL gerenciado ou instância (criar DATABASE_URL).
   - Reservar servidor/cluster (VM com Docker) ou ambiente container (Kubernetes/Cloud Run).
   - Criar secrets no provider (JWT_SECRET, GEMINI_API_KEY, BUILT_IN_FORGE_API_KEY).

2. Migrations e DB
   - Apontar DATABASE_URL para ambiente de staging.
   - Rodar: `pnpm db:push` (drizzle-kit generate && drizzle-kit migrate).
   - Verificar tabelas: users, datasets, resources, documents, graphNodes, graphEdges, communities, extractionLogs, ragQueries.

3. Build & Test
   - `pnpm install`
   - `pnpm test`
   - `pnpm run check` (tsc)
   - `pnpm build`

4. Vetor store / Embeddings (Qdrant)
   - Decisão atual: usar Qdrant como vetor store persistente (self-hosted). Qdrant é leve, fácil de rodar em Docker e adequado para produção inicial.
   - Passos para staging/production:
     1. Adicionar serviço `qdrant` ao `docker-compose.yml` (ou provisionar instância Qdrant gerenciada).
     2. Definir `QDRANT_URL` (ex.: `http://qdrant:6333`) e opcional `QDRANT_API_KEY` no ambiente.
     3. Atualizar pipeline de ingestão para gravar vetores em Qdrant (endpoints HTTP gRPC). Testar com dataset pequeno.
     4. Validar GEMINI_API_KEY e limites; configurar ENV: EMBEDDING_BATCH_SIZE, EMBEDDING_CONCURRENCY, EMBEDDING_MAX_RETRIES.
     5. Rotina de migração (se existirem embeddings em outro store):
        - Exportar embeddings atuais (se possível) para JSON/Parquet.
        - Usar script de import para inserir vetores em Qdrant (batching, retries).
        - Validar amostras de search/recall antes de cortar tráfego para o novo store.

5. Containerização e deploy
   - Criar Docker image multi-stage (builder + runtime).
   - Usar docker-compose para ambiente inicial (app + mysql + qdrant).
   - Iniciar e validar: `docker-compose up --build`

6. Health checks e Observability
   - Validar `GET /metrics` (Prometheus format).
   - Configurar logs estruturados (pino stdout => agregador).
   - Configurar backup MySQL.

7. Rollout e rollback
   - Deploy first to staging; smoke tests (auth flow, upload, embeddings pipeline, queries).
   - Release gradual: canary / traffic split (se suportado).
   - Rollback: redeploy imagem anterior + restore DB se necessário.

8. Post-deploy
   - Habilitar scraping Prometheus, configurar alertas de erro e latência.
   - Medir custo LLM e ajustar batch/concurrency.

Checklist rápido (preflight)

- [ ] DATABASE_URL válido e acessível
- [ ] JWT_SECRET configurado
- [ ] GEMINI_API_KEY disponível
- [ ] BUILT*IN_FORGE_API*\* configurados (se usar storage/notifications)
- [ ] Build passa e testes verdes
- [ ] Backup/restore testado para DB

Notas operacionais

- Evitar expor keys publicamente. Usar service secrets.
- Monitorar custo de embeddings/LLM desde o primeiro dia.
