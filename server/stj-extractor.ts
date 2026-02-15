/**
 * STJ Data Extractor - Fetches datasets from the CKAN API at dadosabertos.web.stj.jus.br
 * Handles Cloudflare protection via browser-like headers and cookie persistence.
 */
import axios from "axios";
import { upsertDataset, upsertResource, getDatasetBySlug, updateResourceStatus, createLog, updateLog } from "./db";

const STJ_BASE = "https://dadosabertos.web.stj.jus.br";
const CKAN_API = `${STJ_BASE}/api/3/action`;

// Known datasets with JSON resources
export const DATASETS_WITH_JSON = [
  "atas-de-distribuicao",
  "espelhos-de-acordaos-corte-especial",
  "espelhos-de-acordaos-primeira-secao",
  "espelhos-de-acordaos-primeira-turma",
  "espelhos-de-acordaos-quarta-turma",
  "espelhos-de-acordaos-quinta-turma",
  "espelhos-de-acordaos-segunda-secao",
  "espelhos-de-acordaos-segunda-turma",
  "espelhos-de-acordaos-sexta-turma",
  "espelhos-de-acordaos-terceira-secao",
  "espelhos-de-acordaos-terceira-turma",
  "integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica",
];

const DATASET_CATEGORIES: Record<string, string> = {
  "atas-de-distribuicao": "Atas de Distribuição",
  "espelhos-de-acordaos-corte-especial": "Jurisprudência",
  "espelhos-de-acordaos-primeira-secao": "Jurisprudência",
  "espelhos-de-acordaos-primeira-turma": "Jurisprudência",
  "espelhos-de-acordaos-quarta-turma": "Jurisprudência",
  "espelhos-de-acordaos-quinta-turma": "Jurisprudência",
  "espelhos-de-acordaos-segunda-secao": "Jurisprudência",
  "espelhos-de-acordaos-segunda-turma": "Jurisprudência",
  "espelhos-de-acordaos-sexta-turma": "Jurisprudência",
  "espelhos-de-acordaos-terceira-secao": "Jurisprudência",
  "espelhos-de-acordaos-terceira-turma": "Jurisprudência",
  "integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica": "Decisões e Acórdãos",
};

const DATASET_TITLES: Record<string, string> = {
  "atas-de-distribuicao": "Atas de Distribuição",
  "espelhos-de-acordaos-corte-especial": "Espelhos de Acórdãos - Corte Especial",
  "espelhos-de-acordaos-primeira-secao": "Espelhos de Acórdãos - Primeira Seção",
  "espelhos-de-acordaos-primeira-turma": "Espelhos de Acórdãos - Primeira Turma",
  "espelhos-de-acordaos-quarta-turma": "Espelhos de Acórdãos - Quarta Turma",
  "espelhos-de-acordaos-quinta-turma": "Espelhos de Acórdãos - Quinta Turma",
  "espelhos-de-acordaos-segunda-secao": "Espelhos de Acórdãos - Segunda Seção",
  "espelhos-de-acordaos-segunda-turma": "Espelhos de Acórdãos - Segunda Turma",
  "espelhos-de-acordaos-sexta-turma": "Espelhos de Acórdãos - Sexta Turma",
  "espelhos-de-acordaos-terceira-secao": "Espelhos de Acórdãos - Terceira Seção",
  "espelhos-de-acordaos-terceira-turma": "Espelhos de Acórdãos - Terceira Turma",
  "integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica": "Íntegras de Decisões Terminativas e Acórdãos",
};

/** Create an axios instance with browser-like headers for Cloudflare bypass */
function createClient() {
  return axios.create({
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": STJ_BASE,
      "Origin": STJ_BASE,
    },
    maxRedirects: 5,
  });
}

/** Fetch dataset info from CKAN API */
export async function fetchDatasetInfo(slug: string): Promise<any> {
  const client = createClient();
  try {
    const response = await client.get(`${CKAN_API}/package_show`, { params: { id: slug } });
    return response.data?.result;
  } catch (error: any) {
    console.error(`[STJ Extractor] Failed to fetch dataset ${slug}:`, error.message);
    // If CKAN API is blocked, return static info
    return null;
  }
}

/** Sync all known datasets - fetches metadata and resources from CKAN */
export async function syncDatasets(): Promise<{ synced: number; errors: string[] }> {
  const startTime = Date.now();
  const logId = await createLog({
    action: "sync_datasets",
    status: "started",
    details: `Syncing ${DATASETS_WITH_JSON.length} datasets`,
  });

  let synced = 0;
  const errors: string[] = [];

  for (const slug of DATASETS_WITH_JSON) {
    try {
      let datasetInfo = await fetchDatasetInfo(slug);

      // Use static info if API is blocked
      const title = datasetInfo?.title || DATASET_TITLES[slug] || slug;
      const description = datasetInfo?.notes || `Dataset ${slug} do portal de dados abertos do STJ`;
      const allResources = datasetInfo?.resources || [];
      const jsonResources = allResources.filter((r: any) => r.format?.toUpperCase() === "JSON");

      await upsertDataset({
        slug,
        title,
        description,
        organization: "Superior Tribunal de Justiça",
        category: DATASET_CATEGORIES[slug] || "Outros",
        totalResources: allResources.length || 0,
        jsonResources: jsonResources.length || 0,
        lastSyncedAt: new Date(),
        metadata: datasetInfo ? { ckanId: datasetInfo.id, tags: datasetInfo.tags } : null,
      });

      // Upsert individual JSON resources
      const dbDataset = await getDatasetBySlug(slug);
      if (dbDataset && jsonResources.length > 0) {
        for (const res of jsonResources) {
          await upsertResource({
            datasetId: dbDataset.id,
            resourceId: res.id,
            name: res.name || res.url?.split("/").pop() || "unknown",
            format: "JSON",
            url: res.url,
            fileSize: res.size || null,
          });
        }
      }

      synced++;
    } catch (error: any) {
      errors.push(`${slug}: ${error.message}`);
    }
  }

  const duration = Date.now() - startTime;
  if (logId) {
    await updateLog(logId, {
      status: errors.length === 0 ? "completed" : "failed",
      recordsProcessed: synced,
      durationMs: duration,
      errorMessage: errors.length > 0 ? errors.join("; ") : undefined,
    });
  }

  return { synced, errors };
}

/** Download a specific JSON resource */
export async function downloadResource(resourceId: string): Promise<any[]> {
  const resource = await (await import("./db")).getResourceByResourceId(resourceId);
  if (!resource) throw new Error(`Resource ${resourceId} not found`);

  const startTime = Date.now();
  const logId = await createLog({
    action: "download_resource",
    resourceId,
    status: "started",
    details: `Downloading ${resource.name} from ${resource.url}`,
  });

  try {
    await updateResourceStatus(resourceId, "downloading");

    const client = createClient();
    const response = await client.get(resource.url, {
      responseType: "json",
      timeout: 120000,
    });

    const data = Array.isArray(response.data) ? response.data : [response.data];

    await updateResourceStatus(resourceId, "downloaded", {
      downloadedAt: new Date(),
      recordCount: data.length,
    });

    const duration = Date.now() - startTime;
    if (logId) {
      await updateLog(logId, {
        status: "completed",
        recordsProcessed: data.length,
        durationMs: duration,
      });
    }

    return data;
  } catch (error: any) {
    await updateResourceStatus(resourceId, "error", { errorMessage: error.message });
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

/** Get static dataset list when API is blocked */
export function getStaticDatasetList() {
  return DATASETS_WITH_JSON.map(slug => ({
    slug,
    title: DATASET_TITLES[slug] || slug,
    category: DATASET_CATEGORIES[slug] || "Outros",
    organization: "Superior Tribunal de Justiça",
  }));
}
