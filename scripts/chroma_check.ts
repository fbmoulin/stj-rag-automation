import { getCollectionStats } from "../server/embeddings";

async function main() {
  try {
    const stats = await getCollectionStats("persistence_check");
    console.log("collection stats:", stats);
    process.exit(0);
  } catch (err: any) {
    console.error("check failed:", err);
    process.exit(2);
  }
}

main();

