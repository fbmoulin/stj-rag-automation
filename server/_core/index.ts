import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { logger } from "./logger";
import { getMetricsSnapshot } from "./metrics";

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
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Metrics endpoint (Prometheus text format)
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.status(200).send(formatPrometheusMetrics());
  });

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.warn(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}/`);
  });
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
