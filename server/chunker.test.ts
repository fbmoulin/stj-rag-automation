import { describe, it, expect } from "vitest";
import { chunkText, processSTJRecord, processSTJRecords } from "./chunker";

// ─── chunkText ──────────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(chunkText(null as any)).toEqual([]);
    expect(chunkText(undefined as any)).toEqual([]);
  });

  it("returns single chunk when text is shorter than chunkSize", () => {
    const result = chunkText("Texto curto.", { source: "test" });
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Texto curto.");
    expect(result[0].index).toBe(0);
    expect(result[0].metadata.source).toBe("test");
  });

  it("splits text into multiple chunks when text exceeds chunkSize", () => {
    const longText = "Frase um. ".repeat(200); // ~2000 chars
    const result = chunkText(longText, {}, 500, 100);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.text.length).toBeLessThanOrEqual(600); // chunkSize + sentence overflow
    }
  });

  it("preserves metadata across all chunks", () => {
    const longText = "Sentença legal aqui. ".repeat(200);
    const meta = { source: "stj", datasetSlug: "test-ds" };
    const result = chunkText(longText, meta, 500, 100);
    for (const chunk of result) {
      expect(chunk.metadata.source).toBe("stj");
      expect(chunk.metadata.datasetSlug).toBe("test-ds");
    }
  });

  it("assigns sequential chunk indices", () => {
    const longText = "Uma frase bastante longa para testar. ".repeat(100);
    const result = chunkText(longText, {}, 300, 50);
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it("handles accented legal text correctly", () => {
    const legalText = "O Ministro relator votou pela procedência do recurso. A Turma, por unanimidade, deu provimento ao agravo. Réu condenado às custas processuais.";
    const result = chunkText(legalText, {}, 2000);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("Ministro");
    expect(result[0].text).toContain("procedência");
  });
});

// ─── processSTJRecord ───────────────────────────────────────────────────────

describe("processSTJRecord", () => {
  it("extracts all standard fields from a complete record", () => {
    const record = {
      id: "123",
      processo: "REsp 1.234.567/SP",
      classe: "REsp",
      relator: "Min. Herman Benjamin",
      orgaoJulgador: "Segunda Turma",
      dataJulgamento: "2025-01-15",
      ementa: "DIREITO DO CONSUMIDOR. RESPONSABILIDADE CIVIL.",
      decisao: "Recurso provido.",
    };
    const { text, metadata } = processSTJRecord(record);
    expect(text).toContain("REsp 1.234.567/SP");
    expect(text).toContain("Min. Herman Benjamin");
    expect(text).toContain("EMENTA:");
    expect(text).toContain("DECISÃO:");
    expect(metadata.processo).toBe("REsp 1.234.567/SP");
    expect(metadata.relator).toBe("Min. Herman Benjamin");
    expect(metadata.recordId).toBe("123");
  });

  it("handles partial record with only ementa", () => {
    const record = { ementa: "Ementa de teste." };
    const { text, metadata } = processSTJRecord(record);
    expect(text).toContain("EMENTA: Ementa de teste.");
    expect(metadata.processo).toBeUndefined();
  });

  it("handles empty record", () => {
    const { text } = processSTJRecord({});
    expect(text).toBe("");
  });

  it("handles referenciasLegislativas as array", () => {
    const record = { referenciasLegislativas: ["Art. 927 CC", "Lei 8.078/90"] };
    const { text, metadata } = processSTJRecord(record);
    expect(text).toContain("Art. 927 CC; Lei 8.078/90");
    expect(metadata.referenciasLegislativas).toContain("Art. 927 CC");
  });

  it("handles referenciasLegislativas as string", () => {
    const record = { referenciasLegislativas: "Art. 927 do Código Civil" };
    const { text } = processSTJRecord(record);
    expect(text).toContain("Art. 927 do Código Civil");
  });
});

// ─── processSTJRecords ──────────────────────────────────────────────────────

describe("processSTJRecords", () => {
  it("returns empty array for empty input", () => {
    expect(processSTJRecords([], "ds", "res")).toEqual([]);
  });

  it("processes multiple records into chunks with enriched metadata", () => {
    const records = [
      { ementa: "Ementa 1.", processo: "REsp 1/SP" },
      { ementa: "Ementa 2.", processo: "REsp 2/RJ" },
    ];
    const chunks = processSTJRecords(records, "corte-especial", "resource-1");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.metadata.source).toBe("stj");
      expect(chunk.metadata.datasetSlug).toBe("corte-especial");
      expect(chunk.metadata.resourceName).toBe("resource-1");
    }
  });

  it("skips records that produce empty text", () => {
    const records = [{}, { ementa: "Alguma coisa." }];
    const chunks = processSTJRecords(records, "ds", "res");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
