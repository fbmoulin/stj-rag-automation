/**
 * Entity Extractor - Uses LLM (Gemini via invokeLLM) to extract entities and relationships
 * from legal text chunks for building the knowledge graph.
 */
import { invokeLLM } from "./_core/llm";
import type { TextChunk } from "./chunker";
import { logger } from "./_core/logger";

export interface ExtractedEntity {
  entityId: string;
  name: string;
  entityType: string;
  description: string;
}

export interface ExtractedRelationship {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  description: string;
  weight: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

const ENTITY_TYPES = [
  "MINISTRO", "PROCESSO", "ORGAO_JULGADOR", "TEMA",
  "LEGISLACAO", "PARTE", "PRECEDENTE", "DECISAO", "CONCEITO_JURIDICO",
];

const RELATIONSHIP_TYPES = [
  "RELATOR_DE", "JULGADO_POR", "REFERENCIA", "CITA_PRECEDENTE",
  "TRATA_DE", "SIMILAR_A", "PERTENCE_A", "PARTE_EM", "FUNDAMENTA",
  "APLICA", "CONTRARIA", "CONFIRMA",
];

function normalizeEntityId(name: string, type: string): string {
  const normalized = name.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${type.toLowerCase()}:${normalized}`;
}

const EXTRACTION_PROMPT = `Você é um especialista em extração de entidades e relações de textos jurídicos brasileiros do Superior Tribunal de Justiça (STJ).

Analise o texto fornecido e extraia TODAS as entidades e relações relevantes.

TIPOS DE ENTIDADES:
- MINISTRO: Ministros relatores ou mencionados (ex: "Min. Herman Benjamin")
- PROCESSO: Números de processos, recursos (ex: "REsp 1.234.567/SP")
- ORGAO_JULGADOR: Turmas, Seções, Corte Especial (ex: "Primeira Turma")
- TEMA: Temas jurídicos, assuntos (ex: "Responsabilidade Civil")
- LEGISLACAO: Leis, artigos, códigos (ex: "Art. 927 do CC", "Lei 8.078/90")
- PARTE: Partes envolvidas quando identificáveis
- PRECEDENTE: Referências a outros julgados citados
- DECISAO: Tipo de decisão (ex: "Recurso provido", "Agravo desprovido")
- CONCEITO_JURIDICO: Conceitos e teses jurídicas relevantes

TIPOS DE RELAÇÕES:
- RELATOR_DE: Ministro é relator do processo
- JULGADO_POR: Processo julgado por órgão
- REFERENCIA: Processo referencia legislação
- CITA_PRECEDENTE: Processo cita outro precedente
- TRATA_DE: Processo trata de tema
- PERTENCE_A: Ministro pertence a órgão
- FUNDAMENTA: Legislação fundamenta decisão
- APLICA: Decisão aplica conceito jurídico
- CONFIRMA: Decisão confirma precedente
- CONTRARIA: Decisão contraria precedente

Responda APENAS com JSON válido no formato especificado.`;

/** Extract entities and relationships from a single text chunk */
export async function extractEntitiesFromChunk(chunk: TextChunk): Promise<ExtractionResult> {
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: `Extraia entidades e relações do seguinte texto jurídico:\n\n${chunk.text}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "entity_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Nome da entidade como aparece no texto" },
                    entityType: { type: "string", enum: ENTITY_TYPES, description: "Tipo da entidade" },
                    description: { type: "string", description: "Breve descrição do papel/contexto da entidade" },
                  },
                  required: ["name", "entityType", "description"],
                  additionalProperties: false,
                },
              },
              relationships: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sourceName: { type: "string", description: "Nome da entidade de origem" },
                    sourceType: { type: "string", enum: ENTITY_TYPES },
                    targetName: { type: "string", description: "Nome da entidade de destino" },
                    targetType: { type: "string", enum: ENTITY_TYPES },
                    relationshipType: { type: "string", enum: RELATIONSHIP_TYPES },
                    description: { type: "string", description: "Descrição da relação" },
                    weight: { type: "number", description: "Força da relação de 0.0 a 1.0" },
                  },
                  required: ["sourceName", "sourceType", "targetName", "targetType", "relationshipType", "description", "weight"],
                  additionalProperties: false,
                },
              },
            },
            required: ["entities", "relationships"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return { entities: [], relationships: [] };

    const parsed = JSON.parse(content);

    // Normalize entity IDs
    const entities: ExtractedEntity[] = (parsed.entities || []).map((e: any) => ({
      entityId: normalizeEntityId(e.name, e.entityType),
      name: e.name,
      entityType: e.entityType,
      description: e.description,
    }));

    const relationships: ExtractedRelationship[] = (parsed.relationships || []).map((r: any) => ({
      sourceEntityId: normalizeEntityId(r.sourceName, r.sourceType),
      targetEntityId: normalizeEntityId(r.targetName, r.targetType),
      relationshipType: r.relationshipType,
      description: r.description,
      weight: Math.min(1, Math.max(0, r.weight || 0.5)),
    }));

    return { entities, relationships };
  } catch (error: any) {
    const msg = String(error);
    // Re-throw transient errors so the job can retry
    const isTransient = msg.includes("429") || msg.includes("503") || msg.includes("502") ||
                        msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") ||
                        msg.includes("fetch failed") || msg.includes("network");
    if (isTransient) {
      logger.warn({ err: msg, chunkIndex: chunk.index }, "[EntityExtractor] Transient error — will retry");
      throw error;
    }
    // Permanent errors (JSON parse, validation, etc.) — return empty and continue
    logger.error({ err: msg, chunkIndex: chunk.index }, "[EntityExtractor] Extraction failed (permanent):");
    return { entities: [], relationships: [] };
  }
}

/** Extract entities from multiple chunks with batching and rate limiting */
export async function extractEntitiesFromChunks(
  chunks: TextChunk[],
  onProgress?: (processed: number, total: number) => void
): Promise<ExtractionResult> {
  const _allEntities: ExtractedEntity[] = [];
  const allRelationships: ExtractedRelationship[] = [];
  const entityMap = new Map<string, ExtractedEntity>();

  for (let i = 0; i < chunks.length; i++) {
    const result = await extractEntitiesFromChunk(chunks[i]);

    // Deduplicate entities by entityId
    for (const entity of result.entities) {
      if (!entityMap.has(entity.entityId)) {
        entityMap.set(entity.entityId, entity);
      }
    }

    allRelationships.push(...result.relationships);

    if (onProgress) onProgress(i + 1, chunks.length);

    // Rate limiting between LLM calls
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return {
    entities: Array.from(entityMap.values()),
    relationships: allRelationships,
  };
}

/** Quick entity extraction from a query string (for local search) */
export async function extractQueryEntities(query: string): Promise<string[]> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "Extraia os nomes de entidades jurídicas mencionadas na consulta do utilizador. Retorne apenas os nomes das entidades encontradas.",
        },
        { role: "user", content: query },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "query_entities",
          strict: true,
          schema: {
            type: "object",
            properties: {
              entities: {
                type: "array",
                items: { type: "string" },
                description: "Nomes de entidades encontradas na consulta",
              },
            },
            required: ["entities"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return [];
    const parsed = JSON.parse(content);
    return parsed.entities || [];
  } catch {
    return [];
  }
}
