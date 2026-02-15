# Roadmap (exemplo)

Fase 0 — Preparação (done in repo)

- Atualizar docs e scripts (README, DEPLOY_PLAN, scripts/\*) — done

Fase 1 — Infra básica (1-2 days)

- Provisionar MySQL staging
- Criar bucket GCS e SA (scripts/setup_gcp_bucket.ts)
- Provisionar Qdrant (docker-compose / cloud)

Fase 2 — Pipelines e testes (2-4 days)

- Validar pipeline de ingest (per-item) e testes unitários
- Testar async batch via GCS (scripts/gemini_gcs_batch.ts)
- Validar import para Qdrant e recall

Fase 3 — CI/CD e build (1-2 days)

- Configurar pipeline (GH Actions) build/test
- Automatizar build/push de imagens e deploy staging

Fase 4 — Observability & Hardening (1-2 days)

- Integrar logs + metrics + alerting
- Secrets manager + TLS + IAM hardening

Fase 5 — Production rollout

- Canary release, monitor smoke tests, rollback plan

Notas: tempos estimados dependem de acesso às credenciais e infra.
