# Recomendações (exemplo de configuração & operação)

Resumo objetivo das recomendações para este projeto:

- Infra:
  - Use um MySQL gerenciado (production) com backups automáticos.
  - Use Qdrant self-hosted ou Qdrant Cloud com snapshot/restore.
  - Para batch grande de embeddings, prefira asyncBatch via GCS (pipeline seguro, escalável).

- Segurança:
  - Armazene secrets em Secret Manager / Vault — não em arquivos `.env` em produção.
  - Rotacione chaves periodicamente; limite permissões do Service Account (principle of least privilege).
  - Exponha serviços via TLS e proxie por um API gateway.

- Observability:
  - Expor `/metrics` (Prometheus) e enviar logs estruturados (`pino`) para um agregador.
  - Alerts: erro de ingest, falha em embeddings, alta latência, aumento de custo de LLM.

- Embeddings / LLM:
  - Monitore custo por token/embeddings; ajuste batch/concurrency.
  - Retries exponenciais com jitter e contagem de falhas por item (alertar se > threshold).
  - Validar recall/quality após migração de vetor store.

Referências rápidas:

- Qdrant: <https://qdrant.tech/documentation/>
- Google Generative AI: <https://cloud.google.com/generative-ai>
- GCS buckets: <https://cloud.google.com/storage/docs/creating-buckets>
