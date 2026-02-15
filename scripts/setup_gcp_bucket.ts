#!/usr/bin/env tsx
/**
 * scripts/setup_gcp_bucket.ts
 *
 * Automated helper that creates a GCS bucket and a service account, grants roles, and outputs
 * commands/ENV values to set locally.
 *
 * Requires:
 *  - gcloud CLI installed and authenticated (gcloud auth login / gcloud auth application-default login)
 *  - The running user must have permissions to create buckets and service accounts.
 *
 * This script shells out to `gcloud` and prints the recommended export lines.
 */
import { execSync } from "child_process";
import path from "path";

function run(cmd: string) {
  console.log("$", cmd);
  return execSync(cmd, { stdio: "pipe" }).toString();
}

function existsGcloud() {
  try {
    run("gcloud --version");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsGcloud()) {
    console.error("gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const project = args[0] || process.env.GCP_PROJECT;
  const bucket = args[1] || `${project}-stj-embeddings`;
  const saName = args[2] || "stj-embeddings-sa";
  if (!project) {
    console.error("Usage: pnpm tsx scripts/setup_gcp_bucket.ts <GCP_PROJECT> [bucket-name] [sa-name]");
    process.exit(2);
  }

  console.log("Creating bucket (if not exists) and service account. Project:", project);
  try {
    run(`gcloud config set project ${project}`);
    // create bucket (location from env or us-central1)
    const location = process.env.GCP_LOCATION || "us-central1";
    run(`gcloud storage buckets create gs://${bucket} --project=${project} --location=${location} --uniform-bucket-level-access`);

    // create service account
    run(`gcloud iam service-accounts create ${saName} --display-name="STJ embeddings service account" --project=${project}`);

    // grant roles (storage admin and service account user)
    run(`gcloud projects add-iam-policy-binding ${project} --member="serviceAccount:${saName}@${project}.iam.gserviceaccount.com" --role="roles/storage.admin"`);
    run(`gcloud projects add-iam-policy-binding ${project} --member="serviceAccount:${saName}@${project}.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser"`);

    // create key
    const keyPath = path.resolve(process.cwd(), `${saName}-key.json`);
    run(`gcloud iam service-accounts keys create ${keyPath} --iam-account=${saName}@${project}.iam.gserviceaccount.com --project=${project}`);

    console.log("\nDone. Add these to your environment (example):\n");
    console.log(`export GOOGLE_APPLICATION_CREDENTIALS=${keyPath}`);
    console.log(`export GCP_PROJECT=${project}`);
    console.log(`export GCP_BUCKET=${bucket}`);
    console.log(`export GCP_LOCATION=${process.env.GCP_LOCATION || "us-central1"}`);
  } catch (err: any) {
    console.error("Error during setup:", err && err.message);
    process.exit(1);
  }
}

main();

