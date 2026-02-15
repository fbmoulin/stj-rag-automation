# Obtendo chaves e permissões necessárias

Este guia reúne links e passos rápidos para obter as chaves/credenciais usadas por este projeto:

1) Gemini / Generative Language (Google)
 - Página principal: https://cloud.google.com/generative-ai
 - Como obter credenciais / ativar a API: siga as instruções do produto na documentação (provisionamento de conta e permissões).
 - Notas: os modelos e endpoints variam por conta/região; para batch assíncrono é necessário usar o endpoint de projeto (projects/{project}/locations/{location}/publishers/google/models/{model}:asyncBatchEmbedContent).

2) Google Cloud (GCS) — para async batch via GCS
 - Criar bucket: https://cloud.google.com/storage/docs/creating-buckets
 - Service Account e chave JSON: https://cloud.google.com/iam/docs/creating-managing-service-account-keys
 - Papéis recomendados para o SA: `roles/storage.admin` (ou `roles/storage.objectAdmin`) e `roles/iam.serviceAccountUser` quando necessário.
 - Autenticação local: defina `GOOGLE_APPLICATION_CREDENTIALS` apontando para o JSON do SA.
 - Comandos úteis (gcloud):
   - criar bucket:
     `gcloud storage buckets create gs://<BUCKET> --project=<PROJECT> --location=<LOCATION>`
   - criar SA:
     `gcloud iam service-accounts create stj-embeddings-sa --display-name="STJ embeddings service account" --project=<PROJECT>`
   - atribuir papel:
     `gcloud projects add-iam-policy-binding <PROJECT> --member="serviceAccount:stj-embeddings-sa@<PROJECT>.iam.gserviceaccount.com" --role="roles/storage.admin"`
   - criar chave (gera JSON):
     `gcloud iam service-accounts keys create ./stj-embeddings-sa-key.json --iam-account=stj-embeddings-sa@<PROJECT>.iam.gserviceaccount.com`
   - ver credenciais ativas:
     `gcloud auth list` / `gcloud auth application-default login`

3) Qdrant (self-hosted)
 - Documentação: https://qdrant.tech/documentation/
 - Se usar Qdrant Cloud ou proteger com API key, defina `QDRANT_API_KEY` no ambiente.

4) MySQL / Database
 - Crie um banco (MySQL) e defina `DATABASE_URL` no `.env`.

5) Observability / Logs
 - Configurar `LOG_LEVEL` e expor `/metrics` para scraping Prometheus.

Exemplos de variáveis de ambiente (ver `.env.example`):

```
GEMINI_API_KEY=...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
GCP_PROJECT=my-project
GCP_BUCKET=my-bucket
QDRANT_URL=http://qdrant:6333
QDRANT_API_KEY=...
```

Se quiser que eu automatize a criação do bucket e das roles/SA, execute o script `scripts/setup_gcp_bucket.ts` (requer `gcloud` instalado e autenticado) ou use `pnpm tsx scripts/gemini_gcs_batch.ts` para rodar o pipeline completo (precisa do SA JSON).

