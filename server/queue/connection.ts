/**
 * Redis connection for BullMQ queues.
 * Uses REDIS_URL env var. If not set, queues are unavailable and
 * processing falls back to synchronous (for local dev without Redis).
 */
import IORedis from "ioredis";
import { logger } from "../_core/logger";

let _connection: IORedis | null = null;

export function getRedisConnection(): IORedis | null {
  if (_connection) return _connection;
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn("[Queue] REDIS_URL not set — async processing unavailable");
    return null;
  }
  try {
    _connection = new IORedis(url, {
      maxRetriesPerRequest: null, // required by BullMQ
      family: 0, // Railway private networking uses IPv6
    });
    _connection.on("error", (err) => {
      logger.error({ err: String(err) }, "[Queue] Redis connection error");
    });
    logger.info("[Queue] Redis connected");
    return _connection;
  } catch (err: any) {
    logger.error({ err: String(err) }, "[Queue] Failed to connect to Redis");
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (_connection) {
    await _connection.quit().catch(() => {});
    _connection = null;
  }
}
