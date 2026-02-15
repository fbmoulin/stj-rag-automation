#!/usr/bin/env tsx
/**
 * List available Gemini models using GEMINI_API_KEY
 */
const GEMINI_LIST_MODELS_URL =
  process.env.GEMINI_LIST_MODELS_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models";

async function fetchWithRetry(url: string, init: any = {}, retries = 3) {
  let last: any = null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      return res;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
    }
  }
  throw last;
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY not set in environment.");
    process.exit(2);
  }

  console.log("Calling", GEMINI_LIST_MODELS_URL);
  const res = await fetchWithRetry(GEMINI_LIST_MODELS_URL, {
    method: "GET",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("List models failed:", res.status, txt);
    process.exit(1);
  }

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  if (Array.isArray(data.models)) {
    const candidates = data.models
      .map((m: any) => m.name || m.model || "")
      .filter((n: string) => /embed|embedding|embedContent|text-embedding/i.test(n));
    console.log("\nEmbedding-capable candidates:");
    for (const c of candidates) console.log(" -", c);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

