import fs from "fs";
import path from "path";

async function main() {
  const chromaPath = process.env.CHROMA_PATH || path.resolve(process.cwd(), "data", "chroma");
  try {
    fs.mkdirSync(chromaPath, { recursive: true });
    const file = path.join(chromaPath, "persistence_test.json");
    const payload = {
      timestamp: Date.now(),
      text: `Persistence fallback test ${Date.now()}`,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: "utf-8" });
    console.log("wrote fallback file:", file);
    process.exit(0);
  } catch (err: any) {
    console.error("fallback failed:", err);
    process.exit(2);
  }
}

main();

