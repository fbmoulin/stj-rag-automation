import { createClient } from "@supabase/supabase-js";

const BUCKET = "documents";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  }
  return createClient(url, key);
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const supabase = getSupabase();
  const key = normalizeKey(relKey);

  const body =
    typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);

  const { error } = await supabase.storage.from(BUCKET).upload(key, body, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: signedData, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(key, 3600);

  if (signError || !signedData) {
    throw new Error(`Failed to create signed URL: ${signError?.message ?? "unknown error"}`);
  }

  return { key, url: signedData.signedUrl };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const supabase = getSupabase();
  const key = normalizeKey(relKey);

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, 3600);

  if (error || !data) {
    throw new Error(`Failed to create signed URL: ${error?.message ?? "unknown error"}`);
  }

  return { key, url: data.signedUrl };
}
