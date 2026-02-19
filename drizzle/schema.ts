import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint, float, uniqueIndex, index } from "drizzle-orm/mysql-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── STJ Datasets ────────────────────────────────────────────────────────────

export const datasets = mysqlTable("datasets", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  organization: varchar("organization", { length: 255 }),
  category: varchar("category", { length: 100 }),
  totalResources: int("totalResources").default(0),
  jsonResources: int("jsonResources").default(0),
  lastSyncedAt: timestamp("lastSyncedAt"),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Dataset = typeof datasets.$inferSelect;
export type InsertDataset = typeof datasets.$inferInsert;

// ─── Resources ───────────────────────────────────────────────────────────────

export const resources = mysqlTable("resources", {
  id: int("id").autoincrement().primaryKey(),
  datasetId: int("datasetId").notNull(),
  resourceId: varchar("resourceId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 500 }).notNull(),
  format: varchar("format", { length: 50 }).notNull(),
  url: text("url").notNull(),
  fileSize: bigint("fileSize", { mode: "number" }),
  downloadedAt: timestamp("downloadedAt"),
  processedAt: timestamp("processedAt"),
  embeddedAt: timestamp("embeddedAt"),
  recordCount: int("recordCount"),
  chunkCount: int("chunkCount"),
  entityCount: int("entityCount"),
  relationshipCount: int("relationshipCount"),
  status: mysqlEnum("status", [
    "pending", "downloading", "downloaded",
    "processing", "processed",
    "extracting_entities", "entities_extracted",
    "embedding", "embedded", "error"
  ]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ([
  index("idx_resources_status").on(t.status),
  index("idx_resources_datasetId").on(t.datasetId),
]));

export type Resource = typeof resources.$inferSelect;
export type InsertResource = typeof resources.$inferInsert;

// ─── Documents (uploaded) ────────────────────────────────────────────────────

export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  originalName: varchar("originalName", { length: 500 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  fileSize: bigint("fileSize", { mode: "number" }),
  fileUrl: text("fileUrl"),
  textContent: text("textContent"),
  chunkCount: int("chunkCount"),
  entityCount: int("entityCount"),
  status: mysqlEnum("status", [
    "uploaded", "extracting", "extracted",
    "chunking", "chunked",
    "extracting_entities", "entities_extracted",
    "embedding", "embedded", "error"
  ]).default("uploaded").notNull(),
  errorMessage: text("errorMessage"),
  collectionName: varchar("collectionName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ([
  index("idx_documents_userId").on(t.userId),
]));

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ─── GraphRAG: Knowledge Graph Nodes (Entities) ─────────────────────────────

export const graphNodes = mysqlTable("graphNodes", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique entity identifier (e.g., "ministro:herman_benjamin") */
  entityId: varchar("entityId", { length: 500 }).notNull().unique(),
  /** Entity name as extracted */
  name: varchar("name", { length: 500 }).notNull(),
  /** Entity type: ministro, processo, orgao_julgador, tema, legislacao, parte, precedente, decisao */
  entityType: varchar("entityType", { length: 100 }).notNull(),
  /** LLM-generated description summarizing all mentions */
  description: text("description"),
  /** Source: "stj" or "upload" */
  source: varchar("source", { length: 50 }).default("stj"),
  /** Source dataset slug or document ID */
  sourceRef: varchar("sourceRef", { length: 255 }),
  /** Number of times this entity was mentioned across chunks */
  mentionCount: int("mentionCount").default(1),
  /** Community ID from Leiden algorithm */
  communityId: int("communityId"),
  /** Community level in hierarchy (0 = top) */
  communityLevel: int("communityLevel"),
  /** Additional metadata as JSON */
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ([
  index("idx_graphNodes_entityType").on(t.entityType),
  index("idx_graphNodes_communityId").on(t.communityId),
]));

export type GraphNode = typeof graphNodes.$inferSelect;
export type InsertGraphNode = typeof graphNodes.$inferInsert;

// ─── GraphRAG: Knowledge Graph Edges (Relationships) ────────────────────────

export const graphEdges = mysqlTable("graphEdges", {
  id: int("id").autoincrement().primaryKey(),
  /** Source entity ID (references graphNodes.entityId) */
  sourceEntityId: varchar("sourceEntityId", { length: 500 }).notNull(),
  /** Target entity ID (references graphNodes.entityId) */
  targetEntityId: varchar("targetEntityId", { length: 500 }).notNull(),
  /** Relationship type: RELATOR_DE, JULGADO_POR, REFERENCIA, CITA_PRECEDENTE, TRATA_DE, SIMILAR_A, PERTENCE_A */
  relationshipType: varchar("relationshipType", { length: 100 }).notNull(),
  /** LLM-generated description of the relationship */
  description: text("description"),
  /** Relationship weight/strength (0.0 to 1.0) */
  weight: float("weight").default(1.0),
  /** Source chunk or record reference */
  sourceRef: varchar("sourceRef", { length: 255 }),
  /** Number of times this relationship was found */
  mentionCount: int("mentionCount").default(1),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ([
  index("idx_graphEdges_sourceEntityId").on(t.sourceEntityId),
  index("idx_graphEdges_targetEntityId").on(t.targetEntityId),
  index("idx_graphEdges_relationshipType").on(t.relationshipType),
]));

export type GraphEdge = typeof graphEdges.$inferSelect;
export type InsertGraphEdge = typeof graphEdges.$inferInsert;

// ─── GraphRAG: Communities ──────────────────────────────────────────────────

export const communities = mysqlTable("communities", {
  id: int("id").autoincrement().primaryKey(),
  /** Community ID from Leiden algorithm */
  communityId: int("communityId").notNull(),
  /** Hierarchy level (0 = root, higher = more granular) */
  level: int("level").default(0).notNull(),
  /** Parent community ID (null for root) */
  parentCommunityId: int("parentCommunityId"),
  /** Human-readable title generated by LLM */
  title: varchar("title", { length: 500 }),
  /** LLM-generated executive summary of the community */
  summary: text("summary"),
  /** Full community report generated by LLM */
  fullReport: text("fullReport"),
  /** Key entities in this community (JSON array of entityIds) */
  keyEntities: json("keyEntities"),
  /** Number of entities in this community */
  entityCount: int("entityCount").default(0),
  /** Number of relationships within this community */
  edgeCount: int("edgeCount").default(0),
  /** Importance rank within its level */
  rank: float("rank"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Community = typeof communities.$inferSelect;
export type InsertCommunity = typeof communities.$inferInsert;

// ─── Extraction Logs (Audit Trail) ──────────────────────────────────────────

export const extractionLogs = mysqlTable("extractionLogs", {
  id: int("id").autoincrement().primaryKey(),
  datasetSlug: varchar("datasetSlug", { length: 255 }),
  resourceId: varchar("resourceId", { length: 255 }),
  documentId: int("documentId"),
  action: mysqlEnum("action", [
    "sync_datasets", "download_resource", "process_json",
    "extract_entities", "build_communities", "generate_embeddings",
    "upload_document", "process_document", "rag_query"
  ]).notNull(),
  status: mysqlEnum("status", ["started", "completed", "failed"]).default("started").notNull(),
  details: text("details"),
  recordsProcessed: int("recordsProcessed"),
  chunksGenerated: int("chunksGenerated"),
  entitiesExtracted: int("entitiesExtracted"),
  relationshipsExtracted: int("relationshipsExtracted"),
  embeddingsGenerated: int("embeddingsGenerated"),
  durationMs: int("durationMs"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExtractionLog = typeof extractionLogs.$inferSelect;
export type InsertExtractionLog = typeof extractionLogs.$inferInsert;

// ─── RAG Query History ──────────────────────────────────────────────────────

export const ragQueries = mysqlTable("ragQueries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  query: text("query").notNull(),
  /** "local" (entity-centric) or "global" (thematic) */
  queryType: varchar("queryType", { length: 20 }).default("local"),
  response: text("response"),
  /** Entities identified in the query */
  queryEntities: json("queryEntities"),
  /** Sources used: chunks, entities, communities */
  sourcesUsed: json("sourcesUsed"),
  /** Community reports used for global search */
  communitiesUsed: json("communitiesUsed"),
  totalChunksRetrieved: int("totalChunksRetrieved"),
  totalEntitiesRetrieved: int("totalEntitiesRetrieved"),
  /** Reasoning chain for audit (CNJ 615/2025) */
  reasoningChain: text("reasoningChain"),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RagQuery = typeof ragQueries.$inferSelect;
export type InsertRagQuery = typeof ragQueries.$inferInsert;
