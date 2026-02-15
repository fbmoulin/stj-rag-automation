#!/usr/bin/env tsx
/**
 * Probe Gemini asyncBatchEmbedContent endpoint with multiple URL/payload shapes.
 * Prints status and body for each attempt.
 */
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY not set");
  process.exit(2);
}
const rawModel = process.env.GEMINI_MODEL || "models/gemini-embedding-001";
const model = rawModel.replace(/^\/?models\//, "");
const text = process.env.PROBE_TEXT || "Teste curto para probe de batch";
const endpoints = [
  // v1beta with model in URL (current)
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:asyncBatchEmbedContent`,
  // v1 with model in URL
  `https://generativelanguage.googleapis.com/v1/models/${model}:asyncBatchEmbedContent`,
  // v1beta general async endpoint (model in body)
  "https://generativelanguage.googleapis.com/v1beta/models:asyncBatchEmbedContent",
  // v1 general async endpoint (model in body)
  "https://generativelanguage.googleapis.com/v1/models:asyncBatchEmbedContent",
];

async function tryJson(url: string) {
  const body = {
    model,
    requests: [
      {
        content: { parts: [{ text }] },
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  const txt = await res.text().catch(() => "");
  console.log("JSON ->", url, res.status, txt.slice(0, 2000));
}

async function tryNdjson(url: string) {
  const line = JSON.stringify({
    key: "r0",
    request: { content: { parts: [{ text }] } },
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson", "x-goog-api-key": key },
    body: line + "\n",
  });
  const txt = await res.text().catch(() => "");
  console.log("NDJSON ->", url, res.status, txt.slice(0, 2000));
}

(async () => {
  for (const url of endpoints) {
    try {
      console.log("\n--- Trying JSON payload to", url);
      await tryJson(url);
    } catch (err: any) {
      console.error("JSON attempt error:", err && err.message);
    }
    try {
      console.log("\n--- Trying NDJSON payload to", url);
      await tryNdjson(url);
    } catch (err: any) {
      console.error("NDJSON attempt error:", err && err.message);
    }
  }
})();

