/**
 * HTTP client for the datajud-suspensao-mcp MCP server.
 * Makes JSON-RPC 2.0 POST calls to the Streamable HTTP endpoint.
 * Follows the fetchWithRetry pattern from vector/qdrant.ts.
 */
import { logger } from "./_core/logger";

const MCP_URL = (process.env.SUSPENSION_MCP_URL || "http://localhost:8080/mcp").replace(/\/$/, "");

async function fetchWithRetry(input: RequestInfo, init?: RequestInit, maxRetries = 3): Promise<Response> {
  let lastErr: any = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(input, init);
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      lastErr = new Error(`HTTP ${res.status}: ${text}`);
      logger.warn({ attempt: i, status: res.status }, "suspension-mcp fetch non-ok");
    } catch (err: any) {
      lastErr = err;
      logger.warn({ attempt: i, err: String(err) }, "suspension-mcp fetch error");
    }
    await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)));
  }
  throw lastErr || new Error("suspension-mcp fetch failed");
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: { content: Array<{ type: string; text: string }> };
  error?: { code: number; message: string };
  id: number;
}

async function callMCPTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const body = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args },
    id: Date.now(),
  };

  const res = await fetchWithRetry(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: JsonRpcResponse = await res.json();
  if (data.error) throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
  return data.result?.content?.[0]?.text ?? "";
}

export async function listTemas(escopo = "TODOS", formato = "json") {
  return callMCPTool("datajud_listar_temas", { escopo, formato });
}

export async function getThemeDetail(numero: number) {
  return callMCPTool("datajud_detalhar_tema", { numero, formato: "markdown" });
}

export async function getStats() {
  return callMCPTool("datajud_estatisticas");
}

export async function getLastScanResult() {
  return callMCPTool("datajud_ultimo_resultado", { formato: "markdown" });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "stj-rag", version: "1.0" },
        },
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
