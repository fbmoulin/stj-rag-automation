import { eq, desc, sql, and, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  datasets, resources, documents, extractionLogs, ragQueries,
  graphNodes, graphEdges, communities,
} from "../drizzle/schema";
import type {
  InsertDataset, InsertResource, InsertDocument, InsertExtractionLog, InsertRagQuery,
  InsertGraphNode, InsertGraphEdge, InsertCommunity,
} from "../drizzle/schema";
import { logger } from "./_core/logger";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { logger.warn({ err: String(error) }, "[Database] Failed to connect:"); _db = null; }
  }
  return _db;
}

// ─── Datasets ────────────────────────────────────────────────────────────────

export async function upsertDataset(data: InsertDataset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(datasets).values(data).onDuplicateKeyUpdate({
    set: { title: data.title, description: data.description, organization: data.organization, category: data.category, totalResources: data.totalResources, jsonResources: data.jsonResources, lastSyncedAt: data.lastSyncedAt, metadata: data.metadata },
  });
}

export async function getAllDatasets() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(datasets).orderBy(datasets.title);
}

export async function getDatasetBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(datasets).where(eq(datasets.slug, slug)).limit(1);
  return result[0];
}

// ─── Resources ───────────────────────────────────────────────────────────────

export async function upsertResource(data: InsertResource) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(resources).values(data).onDuplicateKeyUpdate({
    set: { name: data.name, format: data.format, url: data.url, fileSize: data.fileSize },
  });
}

export async function getResourcesByDatasetId(datasetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resources).where(eq(resources.datasetId, datasetId)).orderBy(resources.name);
}

export async function updateResourceStatus(resourceId: string, status: string, extra?: Partial<{ downloadedAt: Date; processedAt: Date; embeddedAt: Date; recordCount: number; chunkCount: number; entityCount: number; relationshipCount: number; errorMessage: string }>) {
  const db = await getDb();
  if (!db) return;
  await db.update(resources).set({ status: status as any, ...extra }).where(eq(resources.resourceId, resourceId));
}

export async function getResourceByResourceId(resourceId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(resources).where(eq(resources.resourceId, resourceId)).limit(1);
  return result[0];
}

export async function getResourceStats() {
  const db = await getDb();
  if (!db) return { total: 0, pending: 0, downloaded: 0, processed: 0, embedded: 0, error: 0 };
  const result = await db.select({ status: resources.status, count: sql<number>`count(*)` }).from(resources).groupBy(resources.status);
  const stats: Record<string, number> = { total: 0 };
  for (const r of result) { stats[r.status] = Number(r.count); stats.total += Number(r.count); }
  return stats;
}

export async function getAllResources() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resources).orderBy(resources.name);
}

// ─── Documents ───────────────────────────────────────────────────────────────

export async function createDocument(data: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(documents).values(data);
  return result[0].insertId;
}

export async function getDocumentsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
}

export async function updateDocument(id: number, data: Partial<InsertDocument>) {
  const db = await getDb();
  if (!db) return;
  await db.update(documents).set(data as any).where(eq(documents.id, id));
}

export async function getDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result[0];
}

export async function getAllDocuments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(documents).orderBy(desc(documents.createdAt));
}

// ─── Graph Nodes (Entities) ─────────────────────────────────────────────────

export async function upsertGraphNode(data: InsertGraphNode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(graphNodes).values(data).onDuplicateKeyUpdate({
    set: {
      name: data.name,
      description: data.description,
      mentionCount: sql`mentionCount + 1`,
      metadata: data.metadata,
    },
  });
}

export async function batchUpsertGraphNodes(nodes: InsertGraphNode[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const node of nodes) {
    await upsertGraphNode(node);
  }
}

export async function getGraphNodeByEntityId(entityId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(graphNodes).where(eq(graphNodes.entityId, entityId)).limit(1);
  return result[0];
}

export async function getGraphNodesByType(entityType: string, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(graphNodes).where(eq(graphNodes.entityType, entityType)).orderBy(desc(graphNodes.mentionCount)).limit(limit);
}

export async function searchGraphNodes(query: string, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(graphNodes).where(like(graphNodes.name, `%${query}%`)).orderBy(desc(graphNodes.mentionCount)).limit(limit);
}

export async function getAllGraphNodes() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(graphNodes).orderBy(desc(graphNodes.mentionCount));
}

export async function getGraphNodeStats() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    entityType: graphNodes.entityType,
    count: sql<number>`count(*)`,
    totalMentions: sql<number>`sum(mentionCount)`,
  }).from(graphNodes).groupBy(graphNodes.entityType);
  return result;
}

export async function updateGraphNodeCommunity(entityId: string, communityId: number, level: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(graphNodes).set({ communityId, communityLevel: level }).where(eq(graphNodes.entityId, entityId));
}

// ─── Graph Edges (Relationships) ────────────────────────────────────────────

export async function insertGraphEdge(data: InsertGraphEdge) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(graphEdges).values(data);
}

export async function batchInsertGraphEdges(edges: InsertGraphEdge[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (edges.length === 0) return;
  // Insert in batches of 100
  for (let i = 0; i < edges.length; i += 100) {
    const batch = edges.slice(i, i + 100);
    await db.insert(graphEdges).values(batch);
  }
}

export async function getEdgesForEntity(entityId: string) {
  const db = await getDb();
  if (!db) return [];
  const outgoing = await db.select().from(graphEdges).where(eq(graphEdges.sourceEntityId, entityId));
  const incoming = await db.select().from(graphEdges).where(eq(graphEdges.targetEntityId, entityId));
  return [...outgoing, ...incoming];
}

export async function getAllGraphEdges() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(graphEdges);
}

export async function getGraphEdgeStats() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    relationshipType: graphEdges.relationshipType,
    count: sql<number>`count(*)`,
  }).from(graphEdges).groupBy(graphEdges.relationshipType);
  return result;
}

// ─── Communities ─────────────────────────────────────────────────────────────

export async function upsertCommunity(data: InsertCommunity) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(communities).values(data);
  return result[0].insertId;
}

export async function getCommunityById(communityId: number, level = 0) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(communities)
    .where(and(eq(communities.communityId, communityId), eq(communities.level, level)))
    .limit(1);
  return result[0];
}

export async function getAllCommunities(level?: number) {
  const db = await getDb();
  if (!db) return [];
  if (level !== undefined) {
    return db.select().from(communities).where(eq(communities.level, level)).orderBy(desc(communities.rank));
  }
  return db.select().from(communities).orderBy(desc(communities.rank));
}

export async function clearCommunities() {
  const db = await getDb();
  if (!db) return;
  await db.delete(communities);
  await db.update(graphNodes).set({ communityId: null, communityLevel: null });
}

// ─── Extraction Logs ─────────────────────────────────────────────────────────

export async function createLog(data: InsertExtractionLog) {
  const db = await getDb();
  if (!db) return;
  const result = await db.insert(extractionLogs).values(data);
  return result[0].insertId;
}

export async function updateLog(id: number, data: Partial<InsertExtractionLog>) {
  const db = await getDb();
  if (!db) return;
  await db.update(extractionLogs).set(data as any).where(eq(extractionLogs.id, id));
}

export async function getRecentLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(extractionLogs).orderBy(desc(extractionLogs.createdAt)).limit(limit);
}

// ─── RAG Queries ─────────────────────────────────────────────────────────────

export async function createRagQuery(data: InsertRagQuery) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(ragQueries).values(data);
  return result[0].insertId;
}

export async function updateRagQuery(id: number, data: Partial<InsertRagQuery>) {
  const db = await getDb();
  if (!db) return;
  await db.update(ragQueries).set(data as any).where(eq(ragQueries.id, id));
}

export async function getRecentRagQueries(userId?: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  if (userId) {
    return db.select().from(ragQueries).where(eq(ragQueries.userId, userId)).orderBy(desc(ragQueries.createdAt)).limit(limit);
  }
  return db.select().from(ragQueries).orderBy(desc(ragQueries.createdAt)).limit(limit);
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return { datasets: 0, resources: 0, documents: 0, entities: 0, relationships: 0, communities: 0, queries: 0 };

  const rows = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM datasets) AS datasets,
      (SELECT count(*) FROM resources) AS resources,
      (SELECT count(*) FROM documents) AS documents,
      (SELECT count(*) FROM graphNodes) AS entities,
      (SELECT count(*) FROM graphEdges) AS relationships,
      (SELECT count(*) FROM communities) AS communities,
      (SELECT count(*) FROM ragQueries) AS queries
  `);

  const r = (rows as unknown as Record<string, unknown>[])[0];
  return {
    datasets: Number(r.datasets ?? 0),
    resources: Number(r.resources ?? 0),
    documents: Number(r.documents ?? 0),
    entities: Number(r.entities ?? 0),
    relationships: Number(r.relationships ?? 0),
    communities: Number(r.communities ?? 0),
    queries: Number(r.queries ?? 0),
  };
}
