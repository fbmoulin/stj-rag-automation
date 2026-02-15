/**
 * Graph Engine - In-memory knowledge graph with community detection
 * Implements a simplified Leiden algorithm for community detection
 * and LLM-based community summarization for GraphRAG.
 */
import { invokeLLM } from "./_core/llm";
import {
  getAllGraphNodes, getAllGraphEdges, updateGraphNodeCommunity,
  upsertCommunity, clearCommunities, createLog, updateLog,
} from "./db";
import type { GraphNode, GraphEdge } from "../drizzle/schema";

interface AdjacencyList {
  [entityId: string]: { target: string; type: string; weight: number; description: string }[];
}

interface CommunityData {
  id: number;
  level: number;
  members: string[];        // entityIds
  memberNames: string[];    // entity names
  edges: { source: string; target: string; type: string; description: string }[];
}

/** Build an adjacency list from database edges */
export async function buildAdjacencyList(): Promise<{
  adjacency: AdjacencyList;
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const nodes = await getAllGraphNodes();
  const edges = await getAllGraphEdges();
  const adjacency: AdjacencyList = {};

  // Initialize all nodes
  for (const node of nodes) {
    adjacency[node.entityId] = [];
  }

  // Add edges (bidirectional for community detection)
  for (const edge of edges) {
    if (adjacency[edge.sourceEntityId]) {
      adjacency[edge.sourceEntityId].push({
        target: edge.targetEntityId,
        type: edge.relationshipType,
        weight: edge.weight ?? 1,
        description: edge.description || "",
      });
    }
    if (adjacency[edge.targetEntityId]) {
      adjacency[edge.targetEntityId].push({
        target: edge.sourceEntityId,
        type: edge.relationshipType,
        weight: edge.weight ?? 1,
        description: edge.description || "",
      });
    }
  }

  return { adjacency, nodes, edges };
}

/**
 * Simplified Leiden community detection algorithm.
 * Uses modularity optimization with greedy local moves.
 */
export function detectCommunities(
  adjacency: AdjacencyList,
  resolution = 1.0
): Map<string, number> {
  const nodeIds = Object.keys(adjacency);
  if (nodeIds.length === 0) return new Map();

  // Initialize: each node in its own community
  const communityOf = new Map<string, number>();
  nodeIds.forEach((id, idx) => communityOf.set(id, idx));

  // Calculate total edge weight
  let totalWeight = 0;
  for (const id of nodeIds) {
    for (const edge of adjacency[id]) {
      totalWeight += edge.weight;
    }
  }
  totalWeight /= 2; // Each edge counted twice
  if (totalWeight === 0) totalWeight = 1;

  // Greedy modularity optimization (multiple passes)
  let improved = true;
  let passes = 0;
  const maxPasses = 20;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;

    // Shuffle node order for better convergence
    const shuffled = [...nodeIds].sort(() => Math.random() - 0.5);

    for (const nodeId of shuffled) {
      const currentCommunity = communityOf.get(nodeId)!;

      // Find neighboring communities
      const neighborCommunities = new Map<number, number>();
      for (const edge of adjacency[nodeId]) {
        const neighborComm = communityOf.get(edge.target);
        if (neighborComm !== undefined) {
          neighborCommunities.set(
            neighborComm,
            (neighborCommunities.get(neighborComm) || 0) + edge.weight
          );
        }
      }

      // Calculate node's degree
      let nodeDegree = 0;
      for (const edge of adjacency[nodeId]) nodeDegree += edge.weight;

      // Find best community
      let bestCommunity = currentCommunity;
      let bestDeltaQ = 0;

      for (const [comm, edgeWeightToComm] of neighborCommunities) {
        if (comm === currentCommunity) continue;

        // Calculate community internal weight
        let commDegree = 0;
        for (const [nid, ncomm] of communityOf) {
          if (ncomm === comm) {
            for (const edge of adjacency[nid]) commDegree += edge.weight;
          }
        }

        // Modularity gain
        const deltaQ = (edgeWeightToComm / totalWeight) -
          resolution * (nodeDegree * commDegree) / (2 * totalWeight * totalWeight);

        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestCommunity = comm;
        }
      }

      if (bestCommunity !== currentCommunity) {
        communityOf.set(nodeId, bestCommunity);
        improved = true;
      }
    }
  }

  // Renumber communities to be sequential
  const uniqueComms = [...new Set(communityOf.values())];
  const commMap = new Map<number, number>();
  uniqueComms.forEach((c, i) => commMap.set(c, i));

  const result = new Map<string, number>();
  for (const [nodeId, comm] of communityOf) {
    result.set(nodeId, commMap.get(comm)!);
  }

  return result;
}

/** Generate a community summary using LLM */
async function summarizeCommunity(community: CommunityData, nodeMap: Map<string, GraphNode>): Promise<{
  title: string;
  summary: string;
  fullReport: string;
}> {
  const memberDetails = community.members.map(id => {
    const node = nodeMap.get(id);
    return node ? `- ${node.name} (${node.entityType}): ${node.description || "sem descrição"}` : "";
  }).filter(Boolean).join("\n");

  const edgeDetails = community.edges.slice(0, 30).map(e => {
    const sourceNode = nodeMap.get(e.source);
    const targetNode = nodeMap.get(e.target);
    return `- ${sourceNode?.name || e.source} -[${e.type}]-> ${targetNode?.name || e.target}: ${e.description}`;
  }).filter(Boolean).join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Você é um especialista em direito brasileiro. Analise a comunidade de entidades jurídicas e gere um relatório estruturado.`,
        },
        {
          role: "user",
          content: `Analise esta comunidade de entidades do grafo de conhecimento jurídico do STJ:

ENTIDADES (${community.members.length}):
${memberDetails}

RELAÇÕES:
${edgeDetails}

Gere:
1. Um título conciso para esta comunidade
2. Um resumo executivo (2-3 frases)
3. Um relatório completo explicando as conexões e a importância jurídica`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "community_report",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Título conciso da comunidade" },
              summary: { type: "string", description: "Resumo executivo em 2-3 frases" },
              fullReport: { type: "string", description: "Relatório completo da comunidade" },
            },
            required: ["title", "summary", "fullReport"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return { title: `Comunidade ${community.id}`, summary: "Sem resumo disponível", fullReport: "" };
    }
    return JSON.parse(content);
  } catch (error: any) {
    console.error(`[GraphEngine] Failed to summarize community ${community.id}:`, error.message);
    return {
      title: `Comunidade ${community.id}`,
      summary: `Comunidade com ${community.members.length} entidades e ${community.edges.length} relações`,
      fullReport: "",
    };
  }
}

/** Run the full community detection and summarization pipeline */
export async function buildCommunities(): Promise<{
  totalCommunities: number;
  summarized: number;
}> {
  const startTime = Date.now();
  const logId = await createLog({
    action: "build_communities",
    status: "started",
    details: "Building communities from knowledge graph",
  });

  try {
    // Clear existing communities
    await clearCommunities();

    // Build adjacency list
    const { adjacency, nodes, edges } = await buildAdjacencyList();

    if (nodes.length === 0) {
      if (logId) await updateLog(logId, { status: "completed", durationMs: Date.now() - startTime, details: "No nodes in graph" });
      return { totalCommunities: 0, summarized: 0 };
    }

    // Detect communities
    const communityAssignment = detectCommunities(adjacency);

    // Update nodes with community assignments
    for (const [entityId, commId] of Array.from(communityAssignment.entries())) {
      await updateGraphNodeCommunity(entityId, commId, 0);
    }

    // Build community data structures
    const nodeMap = new Map(nodes.map(n => [n.entityId, n]));
    const commMembers = new Map<number, string[]>();
    for (const [entityId, commId] of Array.from(communityAssignment.entries())) {
      if (!commMembers.has(commId)) commMembers.set(commId, []);
      commMembers.get(commId)!.push(entityId);
    }

    // Build community objects with edges
    const communityDataList: CommunityData[] = [];
    for (const [commId, members] of Array.from(commMembers.entries())) {
      const memberSet = new Set(members);
      const communityEdges = edges
        .filter(e => memberSet.has(e.sourceEntityId) && memberSet.has(e.targetEntityId))
        .map(e => ({
          source: e.sourceEntityId,
          target: e.targetEntityId,
          type: e.relationshipType,
          description: e.description || "",
        }));

      communityDataList.push({
        id: commId,
        level: 0,
        members,
        memberNames: members.map((id: string) => nodeMap.get(id)?.name || id),
        edges: communityEdges,
      });
    }

    // Sort by size (largest first) and summarize top communities
    communityDataList.sort((a, b) => b.members.length - a.members.length);

    let summarized = 0;
    const maxToSummarize = Math.min(communityDataList.length, 30); // Limit LLM calls

    for (let i = 0; i < communityDataList.length; i++) {
      const comm = communityDataList[i];
      let title = `Comunidade ${comm.id}`;
      let summary = `${comm.members.length} entidades, ${comm.edges.length} relações`;
      let fullReport = "";

      // Only summarize communities with 2+ members and limit total LLM calls
      if (comm.members.length >= 2 && summarized < maxToSummarize) {
        const report = await summarizeCommunity(comm, nodeMap);
        title = report.title;
        summary = report.summary;
        fullReport = report.fullReport;
        summarized++;
        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }

      await upsertCommunity({
        communityId: comm.id,
        level: 0,
        title,
        summary,
        fullReport,
        keyEntities: comm.members.slice(0, 10),
        entityCount: comm.members.length,
        edgeCount: comm.edges.length,
        rank: comm.members.length + comm.edges.length * 0.5,
      });
    }

    const duration = Date.now() - startTime;
    if (logId) {
      await updateLog(logId, {
        status: "completed",
        durationMs: duration,
        details: `Built ${communityDataList.length} communities, summarized ${summarized}`,
      });
    }

    return { totalCommunities: communityDataList.length, summarized };
  } catch (error: any) {
    if (logId) {
      await updateLog(logId, {
        status: "failed",
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
      });
    }
    throw error;
  }
}

/** Get the k-hop neighborhood of an entity in the graph */
export async function getEntityNeighborhood(
  entityId: string,
  hops = 2
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const { adjacency, nodes, edges } = await buildAdjacencyList();
  const nodeMap = new Map(nodes.map(n => [n.entityId, n]));

  const visited = new Set<string>();
  const frontier = [entityId];
  visited.add(entityId);

  for (let h = 0; h < hops; h++) {
    const nextFrontier: string[] = [];
    for (const current of frontier) {
      for (const edge of (adjacency[current] || [])) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          nextFrontier.push(edge.target);
        }
      }
    }
    frontier.length = 0;
    frontier.push(...nextFrontier);
    if (nextFrontier.length === 0) break;
  }

  const neighborNodes = Array.from(visited).map((id: string) => nodeMap.get(id)).filter(Boolean) as GraphNode[];
  const neighborEdges = edges.filter(
    e => visited.has(e.sourceEntityId) && visited.has(e.targetEntityId)
  );

  return { nodes: neighborNodes, edges: neighborEdges };
}

/** Get graph data for visualization (limited to top entities) */
export async function getGraphVisualizationData(limit = 200): Promise<{
  nodes: { id: string; name: string; type: string; mentions: number; community: number | null }[];
  edges: { source: string; target: string; type: string; weight: number }[];
}> {
  const allNodes = await getAllGraphNodes();
  const allEdges = await getAllGraphEdges();

  // Take top nodes by mention count
  const topNodes = allNodes
    .sort((a, b) => (b.mentionCount ?? 0) - (a.mentionCount ?? 0))
    .slice(0, limit);

  const topNodeIds = new Set(topNodes.map(n => n.entityId));

  const filteredEdges = allEdges.filter(
    e => topNodeIds.has(e.sourceEntityId) && topNodeIds.has(e.targetEntityId)
  );

  return {
    nodes: topNodes.map(n => ({
      id: n.entityId,
      name: n.name,
      type: n.entityType,
      mentions: n.mentionCount ?? 1,
      community: n.communityId,
    })),
    edges: filteredEdges.map(e => ({
      source: e.sourceEntityId,
      target: e.targetEntityId,
      type: e.relationshipType,
      weight: e.weight ?? 1,
    })),
  };
}
