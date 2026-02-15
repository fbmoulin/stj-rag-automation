import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getAllGraphNodes: vi.fn(),
  getAllGraphEdges: vi.fn(),
  updateGraphNodeCommunity: vi.fn(),
  upsertCommunity: vi.fn(),
  clearCommunities: vi.fn(),
  createLog: vi.fn().mockResolvedValue(1),
  updateLog: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getAllGraphNodes, getAllGraphEdges } from "./db";
import { detectCommunities, buildAdjacencyList, getGraphVisualizationData } from "./graph-engine";

const mockGetNodes = vi.mocked(getAllGraphNodes);
const mockGetEdges = vi.mocked(getAllGraphEdges);

function makeNode(entityId: string, name: string, type = "TEMA", mentionCount = 1) {
  return {
    id: 1, entityId, name, entityType: type, description: null,
    source: "stj", sourceRef: null, mentionCount, communityId: null,
    communityLevel: null, metadata: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as any;
}

function makeEdge(source: string, target: string, type = "TRATA_DE", weight = 1) {
  return {
    id: 1, sourceEntityId: source, targetEntityId: target,
    relationshipType: type, description: null, weight,
    sourceRef: null, mentionCount: 1, metadata: null, createdAt: new Date(),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── detectCommunities (PURE — no mocks needed) ────────────────────────────

describe("detectCommunities", () => {
  it("returns empty map for empty graph", () => {
    const result = detectCommunities({});
    expect(result.size).toBe(0);
  });

  it("assigns isolated nodes to separate communities", () => {
    const adj = { "a": [], "b": [], "c": [] };
    const result = detectCommunities(adj);
    expect(result.size).toBe(3);
    const communities = new Set(result.values());
    expect(communities.size).toBe(3); // each in its own
  });

  it("groups connected nodes into the same community", () => {
    const adj = {
      "a": [{ target: "b", type: "T", weight: 1, description: "" }],
      "b": [{ target: "a", type: "T", weight: 1, description: "" }],
      "c": [{ target: "d", type: "T", weight: 1, description: "" }],
      "d": [{ target: "c", type: "T", weight: 1, description: "" }],
    };
    const result = detectCommunities(adj);
    expect(result.get("a")).toBe(result.get("b")); // same community
    expect(result.get("c")).toBe(result.get("d")); // same community
    expect(result.get("a")).not.toBe(result.get("c")); // different communities
  });

  it("handles fully connected graph", () => {
    const adj = {
      "a": [
        { target: "b", type: "T", weight: 1, description: "" },
        { target: "c", type: "T", weight: 1, description: "" },
      ],
      "b": [
        { target: "a", type: "T", weight: 1, description: "" },
        { target: "c", type: "T", weight: 1, description: "" },
      ],
      "c": [
        { target: "a", type: "T", weight: 1, description: "" },
        { target: "b", type: "T", weight: 1, description: "" },
      ],
    };
    const result = detectCommunities(adj);
    expect(result.size).toBe(3);
    // all should be in same community
    const comm = result.get("a");
    expect(result.get("b")).toBe(comm);
    expect(result.get("c")).toBe(comm);
  });

  it("produces sequential community IDs starting from 0", () => {
    const adj = { "a": [], "b": [] };
    const result = detectCommunities(adj);
    const ids = [...new Set(result.values())].sort();
    expect(ids).toEqual([0, 1]);
  });
});

// ─── buildAdjacencyList (mock DB) ───────────────────────────────────────────

describe("buildAdjacencyList", () => {
  it("builds bidirectional adjacency from nodes and edges", async () => {
    mockGetNodes.mockResolvedValueOnce([makeNode("a", "A"), makeNode("b", "B")]);
    mockGetEdges.mockResolvedValueOnce([makeEdge("a", "b", "TRATA_DE", 0.8)]);

    const { adjacency } = await buildAdjacencyList();
    expect(adjacency["a"]).toHaveLength(1);
    expect(adjacency["a"][0].target).toBe("b");
    expect(adjacency["b"]).toHaveLength(1);
    expect(adjacency["b"][0].target).toBe("a");
  });

  it("handles empty graph", async () => {
    mockGetNodes.mockResolvedValueOnce([]);
    mockGetEdges.mockResolvedValueOnce([]);
    const { adjacency, nodes, edges } = await buildAdjacencyList();
    expect(Object.keys(adjacency)).toHaveLength(0);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

// ─── getGraphVisualizationData (mock DB) ────────────────────────────────────

describe("getGraphVisualizationData", () => {
  it("limits nodes by mentionCount and respects limit param", async () => {
    const nodes = [
      makeNode("a", "A", "TEMA", 10),
      makeNode("b", "B", "TEMA", 5),
      makeNode("c", "C", "TEMA", 1),
    ];
    mockGetNodes.mockResolvedValueOnce(nodes);
    mockGetEdges.mockResolvedValueOnce([makeEdge("a", "b")]);

    const result = await getGraphVisualizationData(2);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].name).toBe("A"); // highest mentions first
    expect(result.nodes[1].name).toBe("B");
  });

  it("filters edges to only include visible nodes", async () => {
    const nodes = [makeNode("a", "A", "TEMA", 10), makeNode("b", "B", "TEMA", 5)];
    mockGetNodes.mockResolvedValueOnce(nodes);
    mockGetEdges.mockResolvedValueOnce([
      makeEdge("a", "b"),
      makeEdge("a", "invisible_node"), // should be filtered out
    ]);

    const result = await getGraphVisualizationData(2);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("a");
    expect(result.edges[0].target).toBe("b");
  });
});
