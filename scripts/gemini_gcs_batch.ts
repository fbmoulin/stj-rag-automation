#!/usr/bin/env tsx
/**
 * scripts/gemini_gcs_batch.ts
 *
 * Usage:
 *   # ensure env: GOOGLE_APPLICATION_CREDENTIALS, GCP_PROJECT, GCP_LOCATION, GCP_BUCKET, GEMINI_MODEL(optional)
 *   pnpm tsx scripts/gemini_gcs_batch.ts ./data/input_texts.txt my_collection
 *
 * The script:
 *  - reads lines from input file (one text per line)
 *  - uploads a JSONL file to GCS
 *  - calls asyncBatchEmbedContent on the project-scoped model endpoint
 *  - polls the operation until done
 *  - downloads output files from GCS output prefix
 *  - parses embeddings and upserts into Qdrant collection
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { upsertPoints as qdrantUpsertPoints, ensureCollection as ensureQdrantCollection } from "../server/vector/qdrant";

const SA_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const PROJECT = process.env.GCP_PROJECT;
const LOCATION = process.env.GCP_LOCATION || "us-central1";
const BUCKET = process.env.GCP_BUCKET;
const MODEL = (process.env.GEMINI_MODEL || "models/gemini-embedding-001").replace(/^\/?models\//, "");

if (!SA_PATH || !PROJECT || !BUCKET) {
  console.error("Missing env. Required: GOOGLE_APPLICATION_CREDENTIALS, GCP_PROJECT, GCP_BUCKET");
  process.exit(2);
}

function readLines(file: string) {
  const raw = fs.readFileSync(file, "utf-8");
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function base64url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessTokenFromServiceAccount(saPath: string) {
  const key = JSON.parse(fs.readFileSync(saPath, "utf-8"));
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: any = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signed = base64url(Buffer.from(JSON.stringify(header))) + "." + base64url(Buffer.from(JSON.stringify(payload)));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signed);
  const signature = signer.sign(key.private_key);
  const jwt = signed + "." + base64url(signature);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("token exchange failed: " + txt);
  }
  const data = await res.json();
  return data.access_token as string;
}

async function uploadToGcs(bucket: string, objectName: string, data: Buffer, accessToken: string) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: data,
  });
  if (!res.ok) throw new Error(`GCS upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  return true;
}

async function listGcsObjects(bucket: string, prefix: string, accessToken: string) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`GCS list failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return (data.items || []).map((it: any) => it.name as string);
}

async function downloadGcsObject(bucket: string, name: string, accessToken: string) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`GCS download failed: ${res.status} ${await res.text().catch(() => "")}`);
  return await res.text();
}

async function callAsyncBatch(project: string, location: string, model: string, inputGcsUri: string, outputPrefix: string, accessToken: string) {
  const modelPath = `projects/${project}/locations/${location}/publishers/google/models/${model}:asyncBatchEmbedContent`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}`;
  const body = {
    inputConfig: { gcsSource: { uris: [inputGcsUri] } },
    outputConfig: { gcsDestination: { outputUriPrefix: outputPrefix } },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`asyncBatch call failed: ${res.status} ${txt}`);
  const data = JSON.parse(txt);
  return data.name as string; // operation name
}

async function pollOperation(opName: string, accessToken: string, timeoutMs = 5 * 60 * 1000, pollMs = 2000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      await new Promise(r => setTimeout(r, pollMs));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (body?.done) return body;
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error("operation poll timed out");
}

function makeJsonlLines(texts: string[]) {
  return texts.map(t => JSON.stringify({ content: { parts: [{ text: t }] } })).join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: pnpm tsx scripts/gemini_gcs_batch.ts ./path/to/input.txt qdrant_collection_name");
    process.exit(2);
  }
  const inputFile = path.resolve(process.cwd(), args[0]);
  const collection = args[1];
  const texts = readLines(inputFile);
  if (texts.length === 0) {
    console.error("no texts found");
    process.exit(2);
  }

  const accessToken = await getAccessTokenFromServiceAccount(SA_PATH);
  const id = Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
  const inputObject = `embeddings/inputs/${id}.jsonl`;
  const outputPrefix = `embeddings/outputs/${id}/`;
  const inputGcsUri = `gs://${BUCKET}/${inputObject}`;

  const jsonl = makeJsonlLines(texts);
  console.log("Uploading input JSONL to", inputGcsUri);
  await uploadToGcs(BUCKET, inputObject, Buffer.from(jsonl, "utf-8"), accessToken);

  console.log("Calling asyncBatchEmbedContent...");
  const opName = await callAsyncBatch(PROJECT, LOCATION, MODEL, inputGcsUri, `gs://${BUCKET}/${outputPrefix}`, accessToken);
  console.log("Operation:", opName);

  console.log("Polling operation until done...");
  const op = await pollOperation(opName, accessToken, Number(process.env.EMBEDDING_ASYNC_TIMEOUT_MS || 120000), Number(process.env.EMBEDDING_ASYNC_POLL_INTERVAL_MS || 2000));
  console.log("Operation done:", !!op.done);

  console.log("Listing output objects under prefix", outputPrefix);
  const objs = await listGcsObjects(BUCKET, outputPrefix, accessToken);
  console.log("Found objects:", objs);
  const embeddings: Array<{ id: string; vector: number[]; payload?: any }> = [];
  for (const o of objs) {
    const txt = await downloadGcsObject(BUCKET, o, accessToken);
    // assume JSONL lines with { key?, embedding? { values: [] } } or { embedding: { values: [] } }
    for (const line of txt.split(/\r?\n/).filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        const vec = obj.embedding?.values || obj.embedding?.values || obj[0]?.embedding?.values || obj.embedding_values || null;
        const id = obj.key || obj.id || crypto.randomUUID();
        if (Array.isArray(vec)) {
          embeddings.push({ id, vector: vec, payload: obj });
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  }

  if (embeddings.length === 0) {
    console.error("No embeddings parsed from output files.");
    process.exit(1);
  }

  console.log(`Upserting ${embeddings.length} points into Qdrant collection ${collection}`);
  await ensureQdrantCollection(collection, Number(process.env.EMBEDDING_DIMENSION || "768"));
  const points = embeddings.map(e => ({ id: e.id, vector: e.vector, payload: e.payload || {} }));
  // upsert in batches of 200
  const BATCH = Number(process.env.QDRANT_IMPORT_BATCH || "200");
  for (let i = 0; i < points.length; i += BATCH) {
    const slice = points.slice(i, i + BATCH);
    await qdrantUpsertPoints(collection, slice);
    console.log(`Upserted ${i}..${i + slice.length}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

