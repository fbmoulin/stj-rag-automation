#!/usr/bin/env tsx
/**
 * scripts/auto_mark_predeploy.ts
 * - Runs a set of validations and updates `todo_predeploy.md` checkboxes accordingly.
 * - Validations:
 *   1) DATABASE_URL set
 *   2) QDRANT_URL reachable (GET /collections)
 *   3) GCS creds + bucket set (optional)
 *   4) GEMINI_API_KEY set
 *   5) pnpm test passes
 *   6) pnpm build passes
 *   7) docker-compose up smoke (optional)
 *   8) GET /metrics returns 200 (if server running)
 */
import fs from "fs";
import { execSync } from "child_process";

const TODO_PATH = "todo_predeploy.md";

function run(cmd: string, opts: any = {}) {
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
    return true;
  } catch {
    return false;
  }
}

async function httpGet(url: string) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkQdrant(url: string) {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/collections`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const env = process.env;
  const checks: Array<{ idx: number; name: string; ok: boolean }> = [];

  // 1 Database
  checks.push({ idx: 1, name: "Infra: Database (DATABASE_URL) available", ok: Boolean(env.DATABASE_URL) });

  // 2 Qdrant
  const qurl = env.QDRANT_URL || "http://localhost:6333";
  const qok = await checkQdrant(qurl);
  checks.push({ idx: 2, name: "Infra: Qdrant reachable (QDRANT_URL)", ok: qok });

  // 3 GCS (optional)
  const gcsOk = Boolean(env.GOOGLE_APPLICATION_CREDENTIALS && env.GCP_BUCKET && env.GCP_PROJECT);
  checks.push({ idx: 3, name: "Infra: GCS config (GOOGLE_APPLICATION_CREDENTIALS, GCP_BUCKET)", ok: gcsOk });

  // 4 GEMINI key
  checks.push({ idx: 4, name: "Secrets: GEMINI_API_KEY present", ok: Boolean(env.GEMINI_API_KEY) });

  // 5 Tests
  const testsOk = run("pnpm test");
  checks.push({ idx: 5, name: "Tests: unit tests pass (`pnpm test`)", ok: testsOk });

  // 6 Build
  const buildOk = run("pnpm build");
  checks.push({ idx: 6, name: "Build: project builds (`pnpm build`)", ok: buildOk });

  // 7 docker-compose smoke (optional) - don't auto-run unless user exports RUN_COMPOSE=1
  let composeOk = false;
  if (process.env.RUN_COMPOSE === "1") {
    composeOk = run("docker-compose up -d --build && sleep 4 && docker-compose ps");
  }
  checks.push({ idx: 7, name: "Docker Compose: `docker-compose up --build` smoke (optional)", ok: composeOk });

  // 8 metrics
  const metricsOk = await httpGet("http://localhost:3000/metrics");
  checks.push({ idx: 8, name: "Metrics: GET /metrics responds 200", ok: metricsOk });

  // 9 final smoke (not automated here)
  checks.push({ idx: 9, name: "Final: Smoke queries (ingest + query) validated", ok: false });

  // Read todo file and update checkboxes
  let md = fs.readFileSync(TODO_PATH, "utf-8");
  for (const c of checks) {
    const pattern = new RegExp(`^- \\[.\\] ${c.idx}\\. (.+)$`, "m");
    const replacement = c.ok ? `- [x] ${c.idx}. ${c.name}` : `- [ ] ${c.idx}. ${c.name}`;
    if (pattern.test(md)) {
      md = md.replace(pattern, replacement);
    } else {
      // add if missing
      md += `\n${replacement}\n`;
    }
  }
  fs.writeFileSync(TODO_PATH, md, "utf-8");
  console.log("Predeploy checks updated in", TODO_PATH);
  // summary
  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.idx}. ${c.name}`);
  }
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});

