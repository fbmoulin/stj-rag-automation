import { storeChunksInChroma } from "../server/embeddings";

async function main() {
  const chunks = [
    {
      text: `Persistence test document ${Date.now()}`,
      metadata: { source: "persistence-check" },
    },
  ];

  try {
    const res = await storeChunksInChroma("persistence_check", chunks, (p, t) =>
      console.log(`progress ${p}/${t}`)
    );
    console.log("store result:", res);
    process.exit(0);
  } catch (err: any) {
    console.error("store failed:", err);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Unhandled error in chroma_store:", err);
  process.exit(1);
});

