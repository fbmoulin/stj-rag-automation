# STJ RAG Automation — Deploy Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the STJ RAG Automation production-ready: fix build errors, harden Docker/compose, add health endpoint, graceful shutdown, env validation, CI workflow, and Railway config.

**Architecture:** Express 4 + tRPC server with Vite frontend, MySQL 8 (Drizzle ORM), Qdrant vector store, Gemini embeddings. Monolithic app with `server/_core/index.ts` as entrypoint, `server/routers.ts` as tRPC router. Build: `vite build` (frontend) + `esbuild` (server) → `dist/index.js`.

**Tech Stack:** Node 20, pnpm 10.4.1, TypeScript 5.9, Express 4, tRPC 11, Vitest 2, Pino 8, Docker, GitHub Actions

**Important:** `server/_core/` files are Manus platform framework. Edits to `_core/` files are allowed since this is self-hosted, but keep changes minimal (only `index.ts`, `logger.ts`, `env.ts`).

---

### Task 1: Fix TypeScript errors in embeddings.ts

**Files:**
- Modify: `server/embeddings.ts:489-491`

**Step 1: Fix implicit `any` type on `h` parameter**

The `tsc --noEmit` fails with 3 errors at lines 489-491. These are `.map()` callbacks on Qdrant search results without type annotations.

Replace the block at lines 488-492:
```typescript
    const hits = await qdrantSearchCollection(collectionName, queryEmbedding, nResults, true);
    return {
      documents: hits.map((h: any) => (h.payload?.text as string) || ""),
      metadatas: hits.map((h: any) => h.payload || {}),
      distances: hits.map((h: any) => (h.score !== null ? h.score : Number.MAX_VALUE)),
    };
```

**Step 2: Run type-check to verify it passes**

Run: `pnpm run check`
Expected: EXIT 0, no errors

**Step 3: Commit**

```bash
git add server/embeddings.ts
git commit -m "fix: add type annotations to Qdrant map callbacks"
```

---

### Task 2: Fix embeddings test to skip without GEMINI_API_KEY

**Files:**
- Modify: `server/embeddings.test.ts:26-36`

**Step 1: Fix the test that fails without API key**

The `generateBatchEmbeddings` test calls the real function which checks for `GEMINI_API_KEY` before the mock takes effect. The test needs to set the env var OR mock the module-level constant.

Replace the `generateBatchEmbeddings` describe block:
```typescript
describe("generateBatchEmbeddings", () => {
  it("returns embeddings for texts", async () => {
    if (!process.env.GEMINI_API_KEY) {
      // Set a fake key so the function doesn't throw before reaching fetch
      process.env.GEMINI_API_KEY = "test-key";
    }
    const embeddingsResp = { embeddings: [{ values: [0.1, 0.2, 0.3] }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => embeddingsResp });
    // @ts-ignore
    global.fetch = fetchMock;

    const result = await generateBatchEmbeddings(["hello"]);
    expect(result).toEqual([[0.1, 0.2, 0.3]]);
  });
});
```

**Note:** The module reads `GEMINI_API_KEY` at import time from `process.env`. Setting it before the test call works because the function reads `process.env.GEMINI_API_KEY` dynamically (not a cached const). Verify by checking how `GEMINI_API_KEY` is declared in `embeddings.ts` — if it's a top-level `const`, the test should use `vi.stubEnv()` instead.

**Step 2: Run tests to verify all pass**

Run: `pnpm test`
Expected: 10 suites, 59 tests, 0 failures

**Step 3: Commit**

```bash
git add server/embeddings.test.ts
git commit -m "fix: skip generateBatchEmbeddings test when no API key"
```

---

### Task 3: Add .dockerignore

**Files:**
- Create: `.dockerignore`

**Step 1: Create .dockerignore**

```
node_modules
.worktrees
.git
.gitignore
.gitattributes
docs
*.md
!README.md
.env
.env.*
.vscode
*.test.ts
*.spec.ts
vitest.config.ts
patches
PROJECT_INDEX.json
PROJECT_INDEX.md
DEPLOY_PLAN.md
```

**Step 2: Verify Docker context would be smaller**

Run: `du -sh --exclude=node_modules --exclude=.git --exclude=.worktrees /mnt/c/projetos-2026/stj-rag/stj-rag-automation/`
Expected: much smaller than full repo

**Step 3: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore to reduce build context"
```

---

### Task 4: Add /health endpoint and graceful shutdown

**Files:**
- Modify: `server/_core/index.ts`

**Step 1: Add /health endpoint before the /metrics endpoint**

After the `app.use("/api/trpc", ...)` block and before the `/metrics` endpoint, add:

```typescript
  // Health check endpoint (used by Docker HEALTHCHECK and Railway)
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
```

**Step 2: Add graceful shutdown after `server.listen()`**

After the `server.listen(port, () => { ... })` block, add:

```typescript
  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, closing server...");
    server.close(() => {
      logger.info("Server closed gracefully");
      process.exit(0);
    });
    // Force exit after 10s if connections won't drain
    setTimeout(() => {
      logger.warn("Forcing shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
```

**Step 3: Verify the app starts**

Run: `cd /mnt/c/projetos-2026/stj-rag/stj-rag-automation && timeout 5 node dist/index.js 2>&1 || true`
Expected: Server starts (may fail on DB connection — that's OK, we're checking the code compiles)

Actually, first rebuild: `pnpm build`

**Step 4: Commit**

```bash
git add server/_core/index.ts
git commit -m "feat: add /health endpoint and graceful SIGTERM shutdown"
```

---

### Task 5: Fix Dockerfile

**Files:**
- Modify: `Dockerfile`

**Step 1: Rewrite Dockerfile**

```dockerfile
## Multi-stage Dockerfile
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Install pnpm (match project version)
RUN npm install -g pnpm@10

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY .npmrc* ./
COPY patches ./patches

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

## Production image
FROM node:20-alpine AS runtime
WORKDIR /usr/src/app

RUN npm install -g pnpm@10

COPY package.json pnpm-lock.yaml ./
COPY .npmrc* ./
COPY patches ./patches

RUN pnpm install --prod --frozen-lockfile

# Copy built assets from builder
COPY --from=builder /usr/src/app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
```

Key changes:
- pnpm@8 → pnpm@10 (matches project)
- Removed redundant `COPY --from=builder ... node_modules` (runtime installs its own prod deps)
- Added `--frozen-lockfile` for reproducible builds
- Added HEALTHCHECK using wget (alpine has wget, not curl)
- Added STOPSIGNAL SIGTERM
- Copy `patches/` directory (needed for pnpm patched dependencies)

**Step 2: Verify Dockerfile syntax**

Run: `docker build --dry-run -f /mnt/c/projetos-2026/stj-rag/stj-rag-automation/Dockerfile /mnt/c/projetos-2026/stj-rag/stj-rag-automation/ 2>&1 | head -5` (or just verify syntax manually)

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "fix: update Dockerfile — pnpm 10, HEALTHCHECK, STOPSIGNAL, frozen-lockfile"
```

---

### Task 6: Fix docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Rewrite docker-compose.yml**

```yaml
services:
  db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-rootpassword}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-stj_rag_db}
      MYSQL_USER: ${MYSQL_USER:-stj}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD:-stjpassword}
    volumes:
      - db_data:/var/lib/mysql
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD:-rootpassword}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:6333/healthz || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

  app:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      qdrant:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: mysql://${MYSQL_USER:-stj}:${MYSQL_PASSWORD:-stjpassword}@db:3306/${MYSQL_DATABASE:-stj_rag_db}
      JWT_SECRET: ${JWT_SECRET:-change_me_in_production}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      QDRANT_URL: http://qdrant:6333
      QDRANT_API_KEY: ${QDRANT_API_KEY:-}
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  db_data:
  qdrant_data:
```

Key changes:
- Removed deprecated `version: "3.8"`
- Added healthchecks on all 3 services
- `depends_on` uses `condition: service_healthy` (waits for DB/Qdrant to be ready)
- Removed stale `chroma_data` volume
- Removed dev-mode volume mount (`./:/usr/src/app`)
- Environment vars use `${VAR:-default}` pattern for configurability
- Added `restart: unless-stopped` on all services

**Step 2: Validate compose file**

Run: `cd /mnt/c/projetos-2026/stj-rag/stj-rag-automation && docker compose config --quiet 2>&1`
Expected: No errors (or warning about variable substitution)

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: harden docker-compose — healthchecks, env vars, remove deprecated version"
```

---

### Task 7: Add startup env validation

**Files:**
- Modify: `server/_core/env.ts`

**Step 1: Add validation to env.ts**

Replace the entire file:

```typescript
import { logger } from "./logger";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.error({ variable: name }, "Required environment variable is missing");
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  if (!value) {
    logger.warn({ variable: name }, "Optional environment variable not set");
  }
  return value || fallback;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: requireEnv("JWT_SECRET"),
  databaseUrl: requireEnv("DATABASE_URL"),
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
```

**Note:** Only `JWT_SECRET` and `DATABASE_URL` are required. Other vars are optional because the app can run without OAuth/Forge for local dev. The `logger` import works because `logger.ts` has no dependency on `env.ts` (no circular dep).

**Step 2: Verify import chain is safe**

Check that `logger.ts` does NOT import from `env.ts`. Reading `server/_core/logger.ts` — it only imports `pino`. Safe.

**Step 3: Run tests**

Run: `pnpm test`
Expected: All 59 tests pass. Tests set `DATABASE_URL` and `JWT_SECRET` via process.env already, OR they don't import `env.ts`. If tests fail because env validation fires during import, we'll need to `vi.stubEnv()` in the test files that import the app.

**Step 4: Commit**

```bash
git add server/_core/env.ts
git commit -m "feat: add startup env validation — fail fast on missing DATABASE_URL/JWT_SECRET"
```

---

### Task 8: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm run check

      - name: Run tests
        run: pnpm test
        env:
          DATABASE_URL: mysql://test:test@localhost:3306/test
          JWT_SECRET: ci-test-secret

      - name: Build
        run: pnpm build
```

**Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" 2>&1` (or just verify manually)

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for build, test, type-check"
```

---

### Task 9: Prepare Railway deploy configuration

**Files:**
- Create: `railway.toml` (in project root — this project is NOT a monorepo, so root config is fine)

**Step 1: Create railway.toml**

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 5
```

**Step 2: Document Railway setup**

Add to DEPLOY_PLAN.md checklist at the bottom:

```markdown
## Railway Setup Steps

1. `railway login --browserless` (from WSL2)
2. `railway init` or link to existing project
3. Set environment variables in Railway dashboard:
   - DATABASE_URL (MySQL connection string)
   - JWT_SECRET (random 32+ char string)
   - GEMINI_API_KEY
   - QDRANT_URL (Qdrant service URL)
   - NODE_ENV=production
   - PORT=3000
4. Deploy: `railway up` or push to connected GitHub repo
5. Verify: `curl https://<your-app>.up.railway.app/health`
```

**Step 3: Commit**

```bash
git add railway.toml DEPLOY_PLAN.md
git commit -m "chore: add railway.toml and document Railway setup steps"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Fix TS errors in embeddings.ts | `server/embeddings.ts` |
| 2 | Fix failing test (GEMINI_API_KEY) | `server/embeddings.test.ts` |
| 3 | Add .dockerignore | `.dockerignore` |
| 4 | Add /health + graceful shutdown | `server/_core/index.ts` |
| 5 | Fix Dockerfile | `Dockerfile` |
| 6 | Fix docker-compose.yml | `docker-compose.yml` |
| 7 | Add env validation | `server/_core/env.ts` |
| 8 | Add CI workflow | `.github/workflows/ci.yml` |
| 9 | Railway config | `railway.toml`, `DEPLOY_PLAN.md` |

**Batch plan:**
- Batch 1: Tasks 1-3 (quick fixes, foundation)
- Batch 2: Tasks 4-6 (Docker + health + shutdown)
- Batch 3: Tasks 7-9 (env validation, CI, Railway)

**Verification after each batch:**
- `pnpm run check` (type-check)
- `pnpm test` (all tests pass)
- `pnpm build` (production build succeeds)
