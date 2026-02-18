import { logger } from "./logger";

const isProduction = process.env.NODE_ENV === "production";

function requireEnv(name: string): string {
  const value = process.env[name] ?? "";
  if (!value && isProduction) {
    logger.error({ variable: name }, "Required environment variable is missing");
    process.exit(1);
  }
  return value;
}

export const ENV = {
  cookieSecret: requireEnv("JWT_SECRET"),
  databaseUrl: requireEnv("DATABASE_URL"),
  isProduction,
  adminPassword: requireEnv("ADMIN_PASSWORD"),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceKey: requireEnv("SUPABASE_SERVICE_KEY"),
  // Legacy Manus platform vars — unused on Railway, kept for module compat
  appId: process.env.VITE_APP_ID ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
