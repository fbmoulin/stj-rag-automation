# Test Suite Design — Bottom-Up by Pure Layer

**Date:** 2026-02-15
**Status:** Approved
**Goal:** Deploy confidence with compact scope (~10 files, ~70 tests)
**Strategy:** Test pure functions first (zero I/O), then LLM/DB mocked layers

## Approach

Bottom-up testing prioritizing modules by blast radius on deploy failure:
1. Pure functions (no mocks needed) — highest ROI
2. LLM-dependent modules (mock `invokeLLM`)
3. DB/external-dependent modules (mock `db`, `fetch`, S3)

## Test Files

### P1: chunker.test.ts (~15 tests) — PURE

| Function | Tests |
|----------|-------|
| `chunkText()` | empty text, text < chunkSize, text > chunkSize, overlap correct, sentence boundaries preserved, metadata propagated, accented legal chars |
| `processSTJRecord()` | full record, partial fields, empty record, nested fields, refs as array vs string |
| `processSTJRecords()` | empty array, multiple records, enriched metadata (source, datasetSlug) |

### P2: entity-extractor.test.ts (~10 tests) — MOCK LLM

| Function | Tests |
|----------|-------|
| `normalizeEntityId()` | accents removed, spaces to underscore, case insensitive, type prefix |
| `extractEntitiesFromChunk()` | valid LLM response, empty response, malformed JSON, weight clamped 0-1 |
| `extractEntitiesFromChunks()` | entity deduplication by entityId, progress callback, empty array |
| `extractQueryEntities()` | returns names, LLM failure returns empty array |

### P3: graph-engine.test.ts (~12 tests) — PURE + MOCK DB

| Function | Tests |
|----------|-------|
| `detectCommunities()` (PURE) | empty graph, isolated node, 2 obvious clusters, fully connected, resolution param |
| `buildAdjacencyList()` | nodes + edges produce correct bidirectional adjacency |
| `getEntityNeighborhood()` | 1-hop, 2-hop, nonexistent node |
| `getGraphVisualizationData()` | limit respected, sorted by mentionCount |

### P4: graphrag-query.test.ts (~8 tests) — MOCK ALL

| Function | Tests |
|----------|-------|
| `classifyQuery()` (via mock) | returns local/global/hybrid, LLM failure defaults to hybrid |
| `graphRAGQuery()` | local flow, global flow, hybrid, no context returns default msg, creates ragQuery + log |

### P5: document-processor.test.ts (~6 tests) — MOCK

| Function | Tests |
|----------|-------|
| `extractText()` | TXT buffer, PDF mock, DOCX mock, unknown mime throws |
| `processDocument()` | full pipeline (extract -> chunk -> embed), updates DB status |

### P6: stj-extractor.test.ts (~5 tests) — MOCK AXIOS

| Function | Tests |
|----------|-------|
| `syncDatasets()` | CKAN API response upserts datasets, API error handling |
| `downloadResource()` | success, resource not found |
| `getStaticDatasetList()` | returns 12 known datasets |

### P7: vector/qdrant.test.ts (~5 tests) — MOCK FETCH

| Function | Tests |
|----------|-------|
| `isQdrantConfigured()` | with/without QDRANT_URL |
| `ensureCollection()` | creates collection, already exists |
| `fetchWithRetry()` | retry on failure, success on 2nd attempt, max retries exceeded |

### P8: storage.test.ts (~3 tests) — MOCK S3

| Function | Tests |
|----------|-------|
| `storagePut()` | upload success returns URL |
| Edge cases | empty buffer, invalid mime |

## Mocking Patterns

```typescript
// LLM mock (entity-extractor, graph-engine, graphrag-query)
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// DB mock (graph-engine, graphrag-query, stj-extractor, document-processor)
vi.mock("./db", () => ({
  getAllGraphNodes: vi.fn(),
  getAllGraphEdges: vi.fn(),
  // only mock functions used by the module under test
}));

// Logger mock (suppress output in tests)
vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
```

## Execution

```bash
pnpm test              # all tests (~70, < 5s)
pnpm test chunker      # single module
```

## Totals

- **New files:** 8
- **New tests:** ~64
- **Existing tests:** 5 (auth.logout + embeddings)
- **Total:** ~69 tests
- **Estimated runtime:** < 5s (all mocked, no I/O)
