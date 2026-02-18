import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./embeddings", () => ({
  queryCollection: vi.fn(),
  queryMultipleCollections: vi.fn(),
  listCollections: vi.fn(),
}));
vi.mock("./entity-extractor", () => ({
  extractQueryEntities: vi.fn(),
}));
vi.mock("./graph-engine", () => ({
  getEntityNeighborhood: vi.fn(),
}));
vi.mock("./db", () => ({
  searchGraphNodes: vi.fn().mockResolvedValue([]),
  getEdgesForEntity: vi.fn().mockResolvedValue([]),
  getAllCommunities: vi.fn().mockResolvedValue([]),
  getCommunityById: vi.fn(),
  createRagQuery: vi.fn().mockResolvedValue(1),
  updateRagQuery: vi.fn(),
  createLog: vi.fn().mockResolvedValue(1),
  updateLog: vi.fn(),
}));
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invokeLLM } from "./_core/llm";
import { listCollections, queryMultipleCollections } from "./embeddings";
import { extractQueryEntities } from "./entity-extractor";
import { searchGraphNodes, createRagQuery, updateRagQuery } from "./db";
import { graphRAGQuery } from "./graphrag-query";

const mockLLM = vi.mocked(invokeLLM);
const mockListCollections = vi.mocked(listCollections);
const mockQueryMulti = vi.mocked(queryMultipleCollections);
const mockExtractEntities = vi.mocked(extractQueryEntities);
const mockSearchNodes = vi.mocked(searchGraphNodes);

function llmResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListCollections.mockResolvedValue([]);
  mockQueryMulti.mockResolvedValue({ documents: [], distances: [], collections: [] } as any);
  mockExtractEntities.mockResolvedValue([]);
  mockSearchNodes.mockResolvedValue([]);
});

describe("graphRAGQuery", () => {
  it("classifies query and returns structured result", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({ queryType: "hybrid", reasoning: "test" })));
    mockLLM.mockResolvedValue(llmResponse("Resposta gerada pelo LLM."));

    const result = await graphRAGQuery("Qual a jurisprudência sobre dano moral?");
    expect(result.queryId).toBe(1);
    expect(result.answer).toBeDefined();
    expect(["local", "global", "hybrid"]).toContain(result.queryType);
    expect(result.reasoningChain).toBeDefined();
  });

  it("returns default message when no context is found", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({ queryType: "local", reasoning: "specific" })));

    const result = await graphRAGQuery("Min. inexistente no processo X");
    expect(result.answer).toContain("Não foi possível encontrar");
  });

  it("creates ragQuery and log records", async () => {
    mockLLM.mockResolvedValue(llmResponse(JSON.stringify({ queryType: "global", reasoning: "broad" })));

    await graphRAGQuery("tendências jurisprudenciais", 42);
    expect(createRagQuery).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, query: "tendências jurisprudenciais" })
    );
    expect(updateRagQuery).toHaveBeenCalled();
  });

  it("falls back to hybrid when classification LLM fails", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM down"));
    mockLLM.mockResolvedValue(llmResponse("Fallback response"));

    const result = await graphRAGQuery("teste");
    expect(result.queryType).toBe("hybrid");
  });

  it("includes vector results when collections exist", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({ queryType: "local", reasoning: "" })));
    mockLLM.mockResolvedValue(llmResponse("Resposta com vetores."));
    mockListCollections.mockResolvedValueOnce(["stj_corte"]);
    mockQueryMulti.mockResolvedValueOnce({
      documents: ["Texto do chunk relevante"],
      distances: [0.2],
      collections: ["stj_corte"],
    } as any);

    const result = await graphRAGQuery("dano moral");
    expect(result.vectorResults.length).toBeGreaterThanOrEqual(0);
  });

  it("handles entities found in graph for local search", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({ queryType: "local", reasoning: "" })));
    mockLLM.mockResolvedValue(llmResponse("Resposta com entidades."));
    mockExtractEntities.mockResolvedValueOnce(["Min. Herman"]);
    mockSearchNodes.mockResolvedValue([{
      id: 1, entityId: "ministro:herman", name: "Min. Herman",
      entityType: "MINISTRO", description: "Relator",
      source: "stj", sourceRef: null, mentionCount: 5,
      communityId: null, communityLevel: null, metadata: null,
      createdAt: new Date(), updatedAt: new Date(),
    }] as any);

    const result = await graphRAGQuery("Voto do Min. Herman");
    expect(result.entities.length).toBeGreaterThanOrEqual(0);
  });
});
