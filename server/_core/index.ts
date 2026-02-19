import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { logger } from "./logger";
import { getMetricsSnapshot } from "./metrics";
import { createSessionToken } from "./auth";
import { getSessionCookieOptions } from "./cookies";
import { THIRTY_DAYS_MS, COOKIE_NAME } from "@shared/const";
import { startWorkers, stopWorkers } from "../queue/worker";
import { closeQueues } from "../queue/queues";
import { closeRedis } from "../queue/connection";

const isProduction = process.env.NODE_ENV === "production";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Password-based login endpoint
  app.post("/api/auth/login", express.json(), async (req, res) => {
    const { password } = req.body ?? {};
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!password || !adminPassword || password !== adminPassword) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    const token = await createSessionToken();
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: THIRTY_DAYS_MS });
    res.json({ ok: true });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // Health check endpoint (used by Docker HEALTHCHECK and Railway)
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Metrics endpoint (Prometheus text format)
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.status(200).send(formatPrometheusMetrics());
  });

  // development mode uses Vite, production mode uses static files
  // MUST be after /health and /metrics — serveStatic registers a catch-all wildcard
  if (process.env.NODE_ENV === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000");

  if (!isProduction) {
    const available = await findAvailablePort(port);
    if (available !== port) {
      logger.warn(`Port ${port} is busy, using port ${available} instead`);
    }
    server.listen(available, () => {
      logger.info(`Server running on http://localhost:${available}/`);
    });
  } else {
    server.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "Server running on 0.0.0.0");
    });
  }

  // Start BullMQ workers (no-op if REDIS_URL not set)
  startWorkers();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, closing...");
    await stopWorkers();
    await closeQueues();
    await closeRedis();
    server.close(() => {
      logger.info("Server closed gracefully");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forcing shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// Expose a simple /metrics Prometheus-format endpoint
function formatPrometheusMetrics() {
  const snap = getMetricsSnapshot();
  const lines: string[] = [];

  // Counters
  for (const [k, v] of Object.entries(snap.counters || {})) {
    const name = k.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${v}`);
  }

  // Timings: expose count, total_ms, avg_ms
  for (const [k, v] of Object.entries(snap.timings || {})) {
    const base = k.replace(/[^a-zA-Z0-9_]/g, "_");
    lines.push(`# TYPE ${base}_count gauge`);
    lines.push(`${base}_count ${v.count}`);
    lines.push(`# TYPE ${base}_total_ms gauge`);
    lines.push(`${base}_total_ms ${v.totalMs}`);
    const avg = v.count > 0 ? v.totalMs / v.count : 0;
    lines.push(`# TYPE ${base}_avg_ms gauge`);
    lines.push(`${base}_avg_ms ${avg}`);
  }

  return lines.join("\n") + "\n";
}

startServer().catch((err) => logger.error({ err: String(err) }, "startServer failed"));
