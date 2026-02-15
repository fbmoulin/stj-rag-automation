# Roadmap (exemplo)

Fase 0 — Preparação (DONE)

- [x] Atualizar docs e scripts (README, DEPLOY_PLAN, scripts/*)
- [x] Dockerfile + docker-compose.yml + CI workflow

Fase 1 — Infra básica (1-2 days)

- [ ] Provisionar MySQL staging
- [ ] Criar bucket GCS e SA (scripts/setup_gcp_bucket.ts)
- [ ] Provisionar Qdrant (docker-compose / cloud)

Fase 2 — Pipelines e testes (DONE)

- [x] Validar pipeline de ingest (per-item) e testes unitários
- [x] 58 testes passando (10 suites) — chunker, entity-extractor, graph-engine, graphrag-query, document-processor, stj-extractor, qdrant, storage
- [x] Testar async batch via GCS (scripts/gemini_gcs_batch.ts)
- [x] Validar import para Qdrant e recall
- [ ] Integration tests for full pipeline (future)
- [ ] tRPC router tests (future)

Fase 3 — CI/CD e build (1-2 days)

- [x] Configurar pipeline (GH Actions) build/test — `.github/workflows/ci.yml`
- [ ] Automatizar build/push de imagens e deploy staging

Fase 4 — Observability & Hardening (1-2 days)

- [x] Logs estruturados (pino) + `/metrics` (Prometheus format)
- [ ] Integrar alerting
- [ ] Secrets manager + TLS + IAM hardening

Fase 5 — Production rollout

- [ ] Canary release, monitor smoke tests, rollback plan

Notas: tempos estimados dependem de acesso às credenciais e infra.
