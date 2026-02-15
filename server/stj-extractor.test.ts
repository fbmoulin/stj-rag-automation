import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("axios", () => ({
  default: { create: vi.fn(() => ({ get: vi.fn() })) },
}));
vi.mock("./db", () => ({
  upsertDataset: vi.fn(),
  upsertResource: vi.fn(),
  getDatasetBySlug: vi.fn().mockResolvedValue({ id: 1, slug: "test" }),
  getResourceByResourceId: vi.fn(),
  updateResourceStatus: vi.fn(),
  createLog: vi.fn().mockResolvedValue(1),
  updateLog: vi.fn(),
}));
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getStaticDatasetList, DATASETS_WITH_JSON } from "./stj-extractor";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DATASETS_WITH_JSON", () => {
  it("contains 12 known datasets", () => {
    expect(DATASETS_WITH_JSON).toHaveLength(12);
  });

  it("includes corte especial dataset", () => {
    expect(DATASETS_WITH_JSON).toContain("espelhos-de-acordaos-corte-especial");
  });
});

describe("getStaticDatasetList", () => {
  it("returns all 12 datasets with title and category", () => {
    const list = getStaticDatasetList();
    expect(list).toHaveLength(12);
    for (const ds of list) {
      expect(ds.slug).toBeDefined();
      expect(ds.title).toBeDefined();
      expect(ds.category).toBeDefined();
      expect(ds.organization).toBe("Superior Tribunal de Justiça");
    }
  });

  it("maps correct categories", () => {
    const list = getStaticDatasetList();
    const corte = list.find(d => d.slug === "espelhos-de-acordaos-corte-especial");
    expect(corte?.category).toBe("Jurisprudência");
    const atas = list.find(d => d.slug === "atas-de-distribuicao");
    expect(atas?.category).toBe("Atas de Distribuição");
  });

  it("has proper titles for all datasets", () => {
    const list = getStaticDatasetList();
    const integras = list.find(d => d.slug.includes("integras"));
    expect(integras?.title).toContain("Íntegras");
  });
});
