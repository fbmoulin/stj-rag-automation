import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fetch before any imports
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock logger
vi.mock("./_core/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { listTemas, getStats, checkHealth } from "./suspension-client";

function mcpResponse(text: string) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        jsonrpc: "2.0",
        result: { content: [{ type: "text", text }] },
        id: 1,
      }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

describe("suspension-client", () => {
  it("listTemas sends correct JSON-RPC call", async () => {
    const payload = JSON.stringify({ temas: [], total: 0, escopo_filtro: "TODOS" });
    mockFetch.mockResolvedValueOnce(mcpResponse(payload));

    const result = await listTemas("TODOS", "json");
    expect(result).toBe(payload);

    const call = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(call.method).toBe("tools/call");
    expect(call.params.name).toBe("datajud_listar_temas");
    expect(call.params.arguments).toEqual({ escopo: "TODOS", formato: "json" });
  });

  it("checkHealth returns true when server responds", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await checkHealth()).toBe(true);
  });

  it("checkHealth returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await checkHealth()).toBe(false);
  });

  it("retries on failure then succeeds", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(mcpResponse("ok"));

    const result = await getStats();
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
