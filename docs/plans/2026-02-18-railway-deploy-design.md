# Railway Deploy Design — STJ RAG Automation

**Date:** 2026-02-18
**Status:** Approved
**Approach:** Migração completa (Abordagem A) — substituir 3 blockers Manus em uma branch

---

## Contexto

O projeto foi gerado na plataforma Manus e usa 3 dependências de plataforma que não existem fora dela:
1. **Auth SDK Manus** — OAuth via `OAUTH_SERVER_URL` + `sdk.authenticateRequest()`
2. **Storage proxy Forge** — `BUILT_IN_FORGE_API_URL` + `BUILT_IN_FORGE_API_KEY` para uploads S3
3. **LLM proxy Forge** — `forge.manus.im/v1/chat/completions` para entity extraction e summaries

O objetivo é substituir os 3 por alternativas diretas e deployar no Railway.

---

## Arquitetura Alvo

```
GitHub (main) → CI (pnpm test + build) → deploy.yml → Railway
                                                         │
                    ┌────────────────────────────────────┤
                    │                                    │
              App Node.js                         MySQL (Railway plugin)
              :3000                                9 tabelas (Drizzle)
              /health
              /metrics
              /api/auth/login
              /api/trpc/*
                    │
          ┌─────────┼──────────────┐
          │         │              │
    Qdrant Cloud  Supabase       Gemini API
    (vetores)    (storage docs)  (embeddings + LLM)
```

---

## Decisões

| Componente | Antes (Manus) | Depois (Railway) |
|---|---|---|
| Auth | SDK OAuth + OAUTH_SERVER_URL | Bearer `ADMIN_PASSWORD` + JWT cookie |
| Storage | BUILT_IN_FORGE_API_URL proxy | Supabase Storage (`documents` bucket) |
| LLM proxy | `forge.manus.im` | Gemini OpenAI-compat endpoint direto |
| DB | MySQL local Docker | Railway MySQL plugin |
| Vetores | Qdrant local Docker | Qdrant Cloud free tier |
| CI | `ci.yml` (tests+build) | `ci.yml` + `deploy.yml` (Railway) |

---

## Seção 1: Auth (ADMIN_PASSWORD + JWT)

### Backend
- **Remover:** `server/_core/sdk.ts` (Manus SDK), `server/_core/oauth.ts` (OAuth callback)
- **Criar:** `server/_core/auth.ts` — JWT sign/verify com `JWT_SECRET`, helper `createSessionToken(userId)` + `verifySessionToken(req)`
- **Criar:** `POST /api/auth/login` em `server/_core/index.ts` — recebe `{ password }`, valida contra `ADMIN_PASSWORD`, retorna cookie JWT
- **Modificar:** `server/_core/context.ts` — substituir `sdk.authenticateRequest()` por `verifySessionToken(req)` local
- **Modificar:** `server/_core/trpc.ts` — `protectedProcedure` usa `ctx.user !== null`

### User fixo
```typescript
const ADMIN_USER = { id: "admin", name: "Administrator", email: null }
```
Sem tabela de usuários real para auth — `ctx.user.id = "admin"` nos endpoints protegidos.

### Frontend
- **Substituir:** `ManusDialog.tsx` → `PasswordDialog.tsx` — formulário com input de senha + botão "Entrar"
- **Modificar:** `DashboardLayout.tsx` — chamar `PasswordDialog` quando `auth.me` retorna `null`
- **Remover:** referências a OAuth redirect, Manus login

### Env vars
```
ADMIN_PASSWORD=<senha-forte-32-chars>
JWT_SECRET=<random-hex-32-chars>
```

---

## Seção 2: Storage (Supabase)

### Backend
- **Substituir:** `server/storage.ts` completamente — usar `@supabase/supabase-js` client
- Bucket: `documents` (privado, signed URLs com expiração 1h)
- `storagePut(key, buffer, mimeType)` → `supabase.storage.from('documents').upload(key, buffer, { contentType: mimeType })`
- Download URL → `supabase.storage.from('documents').createSignedUrl(key, 3600)`

### Supabase setup (manual)
1. Criar projeto em supabase.com
2. Criar bucket `documents` (Storage → New bucket → private)
3. Copiar Project URL e service_role key

### Env vars
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
```

---

## Seção 3: LLM (Gemini direto)

### Backend — `server/_core/llm.ts`
Mudança mínima — `invokeLLM()` mantém interface idêntica:

```typescript
// ANTES
const resolveApiUrl = () => ENV.forgeApiUrl || "https://forge.manus.im/v1/chat/completions"
authorization: `Bearer ${ENV.forgeApiKey}`

// DEPOIS
const resolveApiUrl = () =>
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
authorization: `Bearer ${process.env.GEMINI_API_KEY}`
```

- Remover `payload.thinking` (parâmetro Manus-specific rejeitado pela API Gemini)
- Modelo já é `gemini-2.5-flash` — sem mudança
- Callers (`entity-extractor.ts`, `graph-engine.ts`, `graphrag-query.ts`) — **zero mudança**

### Env vars
```
GEMINI_API_KEY=<key> (já existe no projeto)
```

---

## Seção 4: Infraestrutura Railway

### Serviços
- **App:** Dockerfile multi-stage (já pronto) + `railway.toml` (já configurado)
- **MySQL:** Railway plugin (auto-injeta `DATABASE_URL`)

### Setup Railway (manual, uma vez)
```bash
# WSL2
railway login --browserless
railway init  # ou link ao projeto existente
# Adicionar MySQL plugin no dashboard
# Setar env vars no dashboard
# Conectar repositório GitHub para auto-deploy
```

### Env vars completas no Railway
```
NODE_ENV=production
PORT=3000
ADMIN_PASSWORD=***
JWT_SECRET=***
GEMINI_API_KEY=***
QDRANT_URL=https://<cluster>.qdrant.io:6333
QDRANT_API_KEY=***
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=***
# DATABASE_URL → auto-injetado pelo MySQL plugin
```

### Qdrant Cloud setup (manual, uma vez)
1. cloud.qdrant.io → criar cluster free tier
2. Copiar URL (ex: `https://abc123.qdrant.io:6333`) e API key

---

## Seção 5: CI/CD

### `.github/workflows/deploy.yml`
```yaml
name: Deploy

on:
  push:
    branches: [main]
    paths-ignore: ['**.md', 'docs/**']

jobs:
  deploy:
    needs: [] # CI já roda separado
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: railwayapp/railway-github-action@v1
        with:
          service: stj-rag-automation
          token: ${{ secrets.RAILWAY_TOKEN }}
```

### GitHub Secrets a adicionar
```
RAILWAY_TOKEN=<railway-project-token>
```

---

## Arquivos a Modificar/Criar

### Backend (7 arquivos)
| Arquivo | Operação | Motivo |
|---|---|---|
| `server/_core/auth.ts` | **CRIAR** | JWT sign/verify local |
| `server/_core/login.ts` | **CRIAR** | POST /api/auth/login handler |
| `server/_core/context.ts` | **MODIFICAR** | usar auth.ts ao invés de sdk |
| `server/_core/env.ts` | **MODIFICAR** | SUPABASE_URL/KEY, ADMIN_PASSWORD; remover FORGE |
| `server/_core/index.ts` | **MODIFICAR** | registrar login endpoint, remover oauth |
| `server/_core/llm.ts` | **MODIFICAR** | URL Gemini + GEMINI_API_KEY + remover thinking |
| `server/storage.ts` | **SUBSTITUIR** | Supabase Storage |
| `server/_core/sdk.ts` | **REMOVER** | não usado após migração |
| `server/_core/oauth.ts` | **REMOVER** | substituído por login.ts |

### Frontend (2 arquivos)
| Arquivo | Operação | Motivo |
|---|---|---|
| `client/src/components/ManusDialog.tsx` | **SUBSTITUIR** | PasswordDialog simples |
| `client/src/components/DashboardLayout.tsx` | **MODIFICAR** | usar PasswordDialog |

### CI/CD (1 arquivo novo)
| Arquivo | Operação |
|---|---|
| `.github/workflows/deploy.yml` | **CRIAR** |

---

## Ordem de Implementação

1. **Backend auth** (context.ts + auth.ts + login endpoint) — unblocks tudo
2. **LLM** (llm.ts) — 5 linhas, zero risco
3. **Storage** (storage.ts → Supabase) — isola impacto em `documents.*`
4. **Frontend** (PasswordDialog + DashboardLayout) — último, depende de auth backend
5. **CI/CD** (deploy.yml) — após tudo verde
6. **Setup infra + deploy** — Qdrant Cloud + Supabase + Railway + env vars

---

## Testes de Validação

```bash
# Após cada etapa:
pnpm test          # 59 tests devem continuar passando
pnpm run check     # tsc sem erros
pnpm build         # build limpo

# Smoke test final (local Docker):
docker compose up --build
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/auth/login -d '{"password":"test"}' -H 'Content-Type: application/json'

# Railway:
curl https://<app>.up.railway.app/health
```

---

## Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| `vite-plugin-manus-runtime` quebra build | Testar `pnpm build` após cada mudança; plugin é dev-only |
| Gemini OpenAI-compat rejeita `thinking` param | Já planejado remover |
| Supabase Storage signed URLs expiram | TTL 1h OK para MVP; aumentar se necessário |
| Railway MySQL cold start lento | `start_period: 30s` já no healthcheck |
| Qdrant Cloud free tier (1 cluster) | Suficiente para MVP; upgrade quando necessário |
