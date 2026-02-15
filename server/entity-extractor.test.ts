import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invokeLLM } from "./_core/llm";
import {
  extractEntitiesFromChunk,
  extractEntitiesFromChunks,
  extractQueryEntities,
} from "./entity-extractor";
import type { TextChunk } from "./chunker";

const mockLLM = vi.mocked(invokeLLM);

function makeChunk(text: string, index = 0): TextChunk {
  return { text, index, metadata: {} };
}

function llmResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── normalizeEntityId (tested indirectly via extractEntitiesFromChunk) ────

describe("extractEntitiesFromChunk", () => {
  it("extracts entities and relationships from valid LLM response", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({
      entities: [
        { name: "Min. Herman Benjamin", entityType: "MINISTRO", description: "Relator" },
        { name: "REsp 1.234.567/SP", entityType: "PROCESSO", description: "Recurso especial" },
      ],
      relationships: [
        {
          sourceName: "Min. Herman Benjamin", sourceType: "MINISTRO",
          targetName: "REsp 1.234.567/SP", targetType: "PROCESSO",
          relationshipType: "RELATOR_DE", description: "É relator do processo", weight: 0.9,
        },
      ],
    })));

    const result = await extractEntitiesFromChunk(makeChunk("Texto jurídico..."));
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].entityId).toBe("ministro:min_herman_benjamin");
    expect(result.entities[1].entityId).toBe("processo:resp_1_234_567_sp");
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].relationshipType).toBe("RELATOR_DE");
  });

  it("returns empty arrays when LLM returns empty content", async () => {
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: null } }] });
    const result = await extractEntitiesFromChunk(makeChunk("test"));
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it("returns empty arrays when LLM returns malformed JSON", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse("not json at all"));
    const result = await extractEntitiesFromChunk(makeChunk("test"));
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it("clamps relationship weight to 0-1 range", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({
      entities: [
        { name: "A", entityType: "TEMA", description: "t" },
        { name: "B", entityType: "TEMA", description: "t" },
      ],
      relationships: [
        { sourceName: "A", sourceType: "TEMA", targetName: "B", targetType: "TEMA",
          relationshipType: "TRATA_DE", description: "d", weight: 5.0 },
        { sourceName: "B", sourceType: "TEMA", targetName: "A", targetType: "TEMA",
          relationshipType: "TRATA_DE", description: "d", weight: -2.0 },
      ],
    })));

    const result = await extractEntitiesFromChunk(makeChunk("test"));
    expect(result.relationships[0].weight).toBe(1);
    expect(result.relationships[1].weight).toBe(0);
  });
});

describe("extractEntitiesFromChunks", () => {
  it("deduplicates entities by entityId across chunks", async () => {
    const entity = { name: "Min. Herman", entityType: "MINISTRO", description: "Rel" };
    mockLLM
      .mockResolvedValueOnce(llmResponse(JSON.stringify({ entities: [entity], relationships: [] })))
      .mockResolvedValueOnce(llmResponse(JSON.stringify({ entities: [entity], relationships: [] })));

    const result = await extractEntitiesFromChunks([makeChunk("a", 0), makeChunk("b", 1)]);
    expect(result.entities).toHaveLength(1); // deduplicated
  });

  it("calls progress callback", async () => {
    mockLLM.mockResolvedValue(llmResponse(JSON.stringify({ entities: [], relationships: [] })));
    const progress = vi.fn();
    await extractEntitiesFromChunks([makeChunk("a"), makeChunk("b")], progress);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith(1, 2);
    expect(progress).toHaveBeenCalledWith(2, 2);
  });

  it("returns empty result for empty chunks array", async () => {
    const result = await extractEntitiesFromChunks([]);
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });
});

describe("extractQueryEntities", () => {
  it("returns entity names from LLM response", async () => {
    mockLLM.mockResolvedValueOnce(llmResponse(JSON.stringify({
      entities: ["Min. Herman Benjamin", "REsp 1.234.567"],
    })));
    const result = await extractQueryEntities("Qual o voto do Min. Herman Benjamin no REsp 1.234.567?");
    expect(result).toEqual(["Min. Herman Benjamin", "REsp 1.234.567"]);
  });

  it("returns empty array when LLM fails", async () => {
    mockLLM.mockRejectedValueOnce(new Error("LLM timeout"));
    const result = await extractQueryEntities("qualquer coisa");
    expect(result).toEqual([]);
  });
});
