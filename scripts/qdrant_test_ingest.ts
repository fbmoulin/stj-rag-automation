#!/usr/bin/env tsx
import { storeChunksInChroma } from "../server/embeddings";

async function main() {
  const collection = process.env.TEST_QDRANT_COLLECTION || "test_collection";
  const text = process.env.TEST_QDRANT_TEXT || "Teste rápido de ingestão Qdrant";

  // Ensure QDRANT_URL defaults to localhost if not provided (useful for local dev)
  process.env.QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

  const chunks = [
    {
      text,
      metadata: { source: "script", createdAt: new Date().toISOString() },
    },
  ];

  console.log("Iniciando ingestão de teste para collection:", collection);
  try {
    const res = await storeChunksInChroma(collection, chunks, (p, t) => {
      console.log(`progress: ${p}/${t}`);
    });
    console.log("Ingest result:", res);
    if (res.errors > 0) {
      console.error("Ingestão de teste falhou: erros detectados no pipeline de embeddings.");
      process.exit(1);
    }
  } catch (err: any) {
    console.error("Erro na ingestão de teste:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error in qdrant_test_ingest:", err);
  process.exit(1);
});
