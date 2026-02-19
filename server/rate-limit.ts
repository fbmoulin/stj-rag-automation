/**
 * Simple in-memory sliding window rate limiter.
 * No external dependencies — suitable for single-instance deploys.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  cleanup(windowMs);
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: oldest + windowMs - now,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterMs: 0,
  };
}
