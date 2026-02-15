#!/usr/bin/env tsx
/**
 * scripts/qdrant_import.ts
 * Usage:
 *   pnpm qdrant:import -- ./data/embeddings.json
 *
 * The input file should be JSON array of objects:
 * [{ "id": "doc_1", "vector": [0.1,0.2,...], "payload": { ... } }, ...]
 */
import fs from "fs";
import path from "path";
import { upsertPoints as qdrantUpsertPoints, ensureCollection } from "../server/vector/qdrant";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm qdrant:import -- ./path/to/export.json");
    process.exit(2);
  }
  const file = args[0];
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error("File not found:", abs);
    process.exit(2);
  }

  const raw = fs.readFileSync(abs, "utf-8");
  let arr: any[] = [];
  try {
    arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("Expected JSON array");
  } catch (err: any) {
    console.error("Failed to parse JSON:", err.message);
    process.exit(2);
  }

  const collection = process.env.QDRANT_IMPORT_COLLECTION || "import_collection";
  const dimension = Number(process.env.EMBEDDING_DIMENSION || "768");
  console.log(`Ensuring collection ${collection} (dim=${dimension})`);
  await ensureCollection(collection, dimension);

  // Upsert in batches
  const BATCH = Number(process.env.QDRANT_IMPORT_BATCH || "200");
  for (let i = 0; i < arr.length; i += BATCH) {
    const slice = arr.slice(i, i + BATCH).map((it: any) => ({
      id: it.id,
      vector: it.vector,
      payload: it.payload || {},
    }));
    console.log(`Upserting batch ${i}..${i + slice.length}`);
    try {
      await qdrantUpsertPoints(collection, slice);
    } catch (err: any) {
      console.error("Batch upsert failed:", err);
    }
  }

  console.log("Import concluído.");
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});

