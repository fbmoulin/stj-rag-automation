/**
 * GraphRAG Query Engine
 * Implements local search (entity-centric) and global search (community-based)
 * following the Microsoft GraphRAG architecture.
 */
import { invokeLLM } from "./_core/llm";
import { queryMultipleCollections, listCollections } from "./embeddings";
import { extractQueryEntities } from "./entity-extractor";
import {
  searchGraphNodes, getEdgesForEntity, getAllCommunities,
  createRagQuery, updateRagQuery, createLog, updateLog,
} from "./db";

export interface GraphRAGResult {
  answer: string;
  queryType: "local" | "global" | "hybrid";
  entities: { name: string; type: string; description: string }[];
  communityReports: { title: string; summary: string }[];
  vectorResults: { text: string; score: number; source: string }[];
  reasoningChain: string;
  queryId: number;
}

/** Classify query as local (specific entities) or global (broad themes) */
async function classifyQuery(query: string): Promise<"local" | "global" | "hybrid"> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Classifique a consulta jurídica como:
- "local": pergunta sobre entidades específicas (ministro, processo, lei específica)
- "global": pergunta sobre temas amplos, tendências, padrões jurisprudenciais
- "hybrid": combina elementos específicos e amplos

Responda apenas com o JSON.`,
        },
        { role: "user", content: query },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "query_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              queryType: { type: "string", enum: ["local", "global", "hybrid"] },
              reasoning: { type: "string" },
            },
            required: ["queryType", "reasoning"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return "hybrid";
    const parsed = JSON.parse(content);
    return parsed.queryType || "hybrid";
  } catch {
    return "hybrid";
  }
}

/** LOCAL SEARCH: Find specific entities and their neighborhood */
async function localSearch(query: string): Promise<{
  entities: { name: string; type: string; description: string }[];
  context: string;
  reasoningChain: string;
}> {
  const reasoning: string[] = [];

  // Step 1: Extract entities from query
  const queryEntityNames = await extractQueryEntities(query);
  reasoning.push(`Entidades extraídas da consulta: ${queryEntityNames.join(", ") || "nenhuma"}`);

  // Step 2: Search for matching entities in the graph
  const foundEntities: { name: string; type: string; description: string; entityId: string }[] = [];
  for (const name of queryEntityNames) {
    const matches = await searchGraphNodes(name, 5);
    for (const match of matches) {
      foundEntities.push({
        name: match.name,
        type: match.entityType,
        description: match.description || "",
        entityId: match.entityId,
      });
    }
  }

  // Also search with the full query
  const directMatches = await searchGraphNodes(query.substring(0, 100), 10);
  for (const match of directMatches) {
    if (!foundEntities.some(e => e.entityId === match.entityId)) {
      foundEntities.push({
        name: match.name,
        type: match.entityType,
        description: match.description || "",
        entityId: match.entityId,
      });
    }
  }

  reasoning.push(`Entidades encontradas no grafo: ${foundEntities.length}`);

  // Step 3: Get neighborhood context for top entities
  const contextParts: string[] = [];
  const topEntities = foundEntities.slice(0, 5);

  for (const entity of topEntities) {
    const edges = await getEdgesForEntity(entity.entityId);
    const edgeDescriptions = edges.slice(0, 10).map(e => {
      const direction = e.sourceEntityId === entity.entityId ? "->" : "<-";
      const other = e.sourceEntityId === entity.entityId ? e.targetEntityId : e.sourceEntityId;
      return `  ${entity.name} ${direction} [${e.relationshipType}] ${direction} ${other}: ${e.description || ""}`;
    });

    contextParts.push(
      `ENTIDADE: ${entity.name} (${entity.type})\n` +
      `Descrição: ${entity.description}\n` +
      `Relações:\n${edgeDescriptions.join("\n")}`
    );
  }

  reasoning.push(`Contexto de grafo construído com ${topEntities.length} entidades e suas relações`);

  return {
    entities: foundEntities.slice(0, 20).map(e => ({ name: e.name, type: e.type, description: e.description })),
    context: contextParts.join("\n\n---\n\n"),
    reasoningChain: reasoning.join("\n"),
  };
}

/** GLOBAL SEARCH: Use community summaries for broad queries */
async function globalSearch(_query: string): Promise<{
  communityReports: { title: string; summary: string }[];
  context: string;
  reasoningChain: string;
}> {
  const reasoning: string[] = [];

  // Get all community reports, sorted by rank
  const allCommunities = await getAllCommunities(0);
  reasoning.push(`Total de comunidades disponíveis: ${allCommunities.length}`);

  if (allCommunities.length === 0) {
    return {
      communityReports: [],
      context: "Nenhuma comunidade encontrada no grafo de conhecimento.",
      reasoningChain: reasoning.join("\n"),
    };
  }

  // Select most relevant communities (by rank, take top ones)
  const topCommunities = allCommunities
    .filter(c => c.summary && c.summary.length > 10)
    .slice(0, 15);

  reasoning.push(`Comunidades selecionadas para análise: ${topCommunities.length}`);

  const communityReports = topCommunities.map(c => ({
    title: c.title || `Comunidade ${c.communityId}`,
    summary: c.summary || "",
  }));

  const context = topCommunities.map(c =>
    `## ${c.title || `Comunidade ${c.communityId}`}\n` +
    `Entidades: ${c.entityCount}, Relações: ${c.edgeCount}\n` +
    `${c.summary || ""}\n` +
    `${c.fullReport ? `\nRelatório:\n${c.fullReport}` : ""}`
  ).join("\n\n---\n\n");

  return { communityReports, context, reasoningChain: reasoning.join("\n") };
}

/** VECTOR SEARCH: Traditional embedding-based retrieval */
async function vectorSearch(query: string, nResults = 10): Promise<{
  results: { text: string; score: number; source: string }[];
  reasoningChain: string;
}> {
  const reasoning: string[] = [];

  try {
    const collections = await listCollections();
    reasoning.push(`Coleções disponíveis: ${collections.join(", ") || "nenhuma"}`);

    if (collections.length === 0) {
      return { results: [], reasoningChain: reasoning.join("\n") };
    }

    const searchResult = await queryMultipleCollections(collections, query, nResults);

    const results = searchResult.documents.map((doc, i) => ({
      text: doc,
      score: 1 - (searchResult.distances[i] || 0), // Convert distance to similarity
      source: searchResult.collections[i] || "unknown",
    }));

    reasoning.push(`Resultados vetoriais encontrados: ${results.length}`);

    return { results, reasoningChain: reasoning.join("\n") };
  } catch (error: any) {
    reasoning.push(`Erro na busca vetorial: ${error.message}`);
    return { results: [], reasoningChain: reasoning.join("\n") };
  }
}

/** Main GraphRAG query function */
export async function graphRAGQuery(
  query: string,
  userId?: number
): Promise<GraphRAGResult> {
  const startTime = Date.now();

  // Create query record
  const queryId = await createRagQuery({
    userId: userId || null,
    query,
  });

  const logId = await createLog({
    action: "rag_query",
    status: "started",
    details: `GraphRAG query: ${query.substring(0, 200)}`,
  });

  try {
    // Step 1: Classify query
    const queryType = await classifyQuery(query);

    // Step 2: Run appropriate search strategies
    let localContext = "";
    let globalContext = "";
    let vectorContext = "";
    let entities: { name: string; type: string; description: string }[] = [];
    let communityReports: { title: string; summary: string }[] = [];
    let vectorResults: { text: string; score: number; source: string }[] = [];
    const reasoningParts: string[] = [`Tipo de consulta: ${queryType}`];

    if (queryType === "local" || queryType === "hybrid") {
      const local = await localSearch(query);
      localContext = local.context;
      entities = local.entities;
      reasoningParts.push(`[LOCAL] ${local.reasoningChain}`);
    }

    if (queryType === "global" || queryType === "hybrid") {
      const global = await globalSearch(query);
      globalContext = global.context;
      communityReports = global.communityReports;
      reasoningParts.push(`[GLOBAL] ${global.reasoningChain}`);
    }

    // Always do vector search as supplement
    const vector = await vectorSearch(query);
    vectorContext = vector.results.map(r => r.text).join("\n\n");
    vectorResults = vector.results;
    reasoningParts.push(`[VECTOR] ${vector.reasoningChain}`);

    // Step 3: Generate final answer using all context
    const fullContext = [
      localContext ? `=== CONTEXTO DO GRAFO (Entidades e Relações) ===\n${localContext}` : "",
      globalContext ? `=== CONTEXTO GLOBAL (Comunidades) ===\n${globalContext}` : "",
      vectorContext ? `=== CONTEXTO VETORIAL (Documentos Similares) ===\n${vectorContext}` : "",
    ].filter(Boolean).join("\n\n");

    let answer = "Não foi possível encontrar informações relevantes para a sua consulta.";

    if (fullContext.trim().length > 0) {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Você é um assistente jurídico especializado em jurisprudência do Superior Tribunal de Justiça (STJ) do Brasil.

Responda à consulta do utilizador com base EXCLUSIVAMENTE no contexto fornecido.
- Cite entidades, processos e legislação quando relevantes
- Indique relações entre entidades quando ajudar a compreensão
- Se o contexto não contiver informação suficiente, diga explicitamente
- Use linguagem técnica jurídica adequada
- Estruture a resposta com parágrafos claros
- Quando possível, indique a fonte (processo, ministro, órgão julgador)`,
          },
          {
            role: "user",
            content: `CONTEXTO:\n${fullContext}\n\nCONSULTA:\n${query}`,
          },
        ],
      });

      answer = (response.choices?.[0]?.message?.content as string) || answer;
    }

    const reasoningChain = reasoningParts.join("\n\n");

    // Update query record
    await updateRagQuery(queryId, {
      response: answer,
      queryType,
      queryEntities: entities.map(e => e.name),
      communitiesUsed: communityReports.map(c => c.title),
      totalEntitiesRetrieved: entities.length,
      totalChunksRetrieved: vectorResults.length,
      reasoningChain,
      durationMs: Date.now() - startTime,
    });

    if (logId) {
      await updateLog(logId, {
        status: "completed",
        durationMs: Date.now() - startTime,
      });
    }

    return {
      answer,
      queryType,
      entities,
      communityReports,
      vectorResults,
      reasoningChain,
      queryId,
    };
  } catch (error: any) {
    await updateRagQuery(queryId, {
      response: `Erro: ${error.message}`,
      durationMs: Date.now() - startTime,
    });

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
