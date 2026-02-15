# Predeploy checklist (automatically validated)

- [ ] 1. Infra: Database (DATABASE_URL) available
- [ ] 2. Infra: Qdrant reachable (QDRANT_URL)
- [ ] 3. Infra: GCS config (GOOGLE_APPLICATION_CREDENTIALS, GCP_BUCKET) — if using async batch
- [ ] 4. Secrets: GEMINI_API_KEY present
- [ ] 5. Tests: unit tests pass (`pnpm test`)
- [ ] 6. Build: project builds (`pnpm build`)
- [ ] 7. Docker Compose: `docker-compose up --build` smoke (app + qdrant)
- [ ] 8. Metrics: GET /metrics responds 200
- [ ] 9. Final: Smoke queries (ingest + query) validated

Run `pnpm tsx scripts/auto_mark_predeploy.ts` to validate and mark items automatically.
