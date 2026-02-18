# Predeploy checklist (automatically validated)

- [x] 1. Infra: Database (DATABASE_URL) available
- [x] 2. Infra: Qdrant reachable (QDRANT_URL)
- [ ] 3. Infra: GCS config (GOOGLE_APPLICATION_CREDENTIALS, GCP_BUCKET) — if using async batch
- [x] 4. Secrets: GEMINI_API_KEY present
- [x] 5. Tests: unit tests pass (`pnpm test`)
- [x] 6. Build: project builds (`pnpm build`)
- [x] 7. Docker Compose: `docker-compose up --build` smoke (app + qdrant)
- [x] 8. Metrics: GET /metrics responds 200
- [x] 9. Final: Smoke queries (ingest + query) validated

Run `pnpm tsx scripts/auto_mark_predeploy.ts` to validate and mark items automatically.
