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

function optionalEnv(name: string): string {
  const value = process.env[name] ?? "";
  if (!value && isProduction) {
    logger.warn({ variable: name }, "Optional env variable missing in production");
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
  geminiApiKey: optionalEnv("GEMINI_API_KEY"),
  qdrantUrl: optionalEnv("QDRANT_URL"),
  qdrantApiKey: optionalEnv("QDRANT_API_KEY"),
  redisUrl: process.env.REDIS_URL || "",
};

if (isProduction && ENV.cookieSecret.length < 32) {
  logger.error("JWT_SECRET must be at least 32 characters in production");
  process.exit(1);
}
