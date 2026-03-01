#!/usr/bin/env tsx
/**
 * Re-index script using local GPU embeddings service.
 *
 * Usage:
 *   EMBEDDING_PROVIDER=local QDRANT_URL=http://localhost:6333 pnpm tsx scripts/reindex_local_gpu.ts
 *
 * What it does:
 *   1. Fetches jurisprudence data from STJ Dados Abertos API
 *   2. Chunks the text content
 *   3. Generates embeddings via local GPU service (http://localhost:8100)
 *   4. Stores vectors in Qdrant
 *   5. Runs a test RAG query to verify
 */

const LOCAL_EMBEDDING_URL = (process.env.LOCAL_EMBEDDING_URL || "http://localhost:8100").replace(/\/$/, "");
const QDRANT_URL = (process.env.QDRANT_URL || "http://localhost:6333").replace(/\/$/, "");
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "stj_jurisprudencia";
const EMBEDDING_DIMENSION = 768;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 150;
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qdrantHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (QDRANT_API_KEY) h["api-key"] = QDRANT_API_KEY;
  return h;
}

async function ensureCollection() {
  // Check if exists
  const check = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { headers: qdrantHeaders() });
  if (check.ok) {
    // Delete old collection to start fresh
    console.log(`Deleting existing collection "${COLLECTION_NAME}" for clean re-index...`);
    await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { method: "DELETE", headers: qdrantHeaders() });
  }
  // Create new
  const body = { vectors: { size: EMBEDDING_DIMENSION, distance: "Cosine" } };
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    method: "PUT",
    headers: qdrantHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create collection: ${res.status} ${await res.text()}`);
  console.log(`Collection "${COLLECTION_NAME}" created (${EMBEDDING_DIMENSION}d, Cosine)`);
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    // Try to break at sentence boundary
    let breakAt = end;
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastPeriod = slice.lastIndexOf(". ");
      if (lastPeriod > CHUNK_SIZE * 0.5) breakAt = start + lastPeriod + 2;
    }
    const chunk = text.slice(start, breakAt).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start = breakAt - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    if (breakAt >= text.length) break;
  }
  return chunks;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  // Add "passage: " prefix for intfloat/multilingual-e5-base
  const prefixed = texts.map(t => t.startsWith("passage: ") ? t : "passage: " + t);
  const res = await fetch(`${LOCAL_EMBEDDING_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: prefixed, normalize: true }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.embeddings;
}

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${LOCAL_EMBEDDING_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["query: " + text], normalize: true }),
  });
  if (!res.ok) throw new Error(`Query embedding failed: ${res.status}`);
  const data = await res.json();
  return data.embeddings[0];
}

async function upsertPoints(points: Array<{ id: string; vector: number[]; payload: any }>) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    method: "PUT",
    headers: qdrantHeaders(),
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${res.status} ${await res.text()}`);
}

async function searchQdrant(vector: number[], limit = 5) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
    method: "POST",
    headers: qdrantHeaders(),
    body: JSON.stringify({ vector, limit, with_payload: true }),
  });
  if (!res.ok) throw new Error(`Qdrant search failed: ${res.status}`);
  const data = await res.json();
  return data.result || [];
}

// ---------------------------------------------------------------------------
// STJ Data fetching
// ---------------------------------------------------------------------------

/** Fetch jurisprudence datasets from STJ Dados Abertos */
async function fetchSTJData(): Promise<Array<{ title: string; text: string; source: string }>> {
  console.log("Fetching STJ jurisprudence data...");

  // Use STJ Dados Abertos CKAN API
  const apiBase = "https://dadosabertos.web.stj.jus.br/api/3/action";
  const packagesRes = await fetch(`${apiBase}/package_search?q=jurisprudencia&rows=5`);
  if (!packagesRes.ok) {
    console.warn("STJ API unavailable, using sample data");
    return getSampleLegalTexts();
  }

  const packagesData: any = await packagesRes.json();
  const datasets = packagesData?.result?.results || [];
  const documents: Array<{ title: string; text: string; source: string }> = [];

  for (const ds of datasets.slice(0, 3)) {
    // Use dataset notes (description) as text content
    if (ds.notes && ds.notes.length > 100) {
      documents.push({
        title: ds.title || "STJ Dataset",
        text: ds.notes,
        source: `stj_dados_abertos:${ds.name}`,
      });
    }

    // Try to fetch CSV/JSON resources
    for (const resource of (ds.resources || []).slice(0, 2)) {
      if (resource.format?.toLowerCase() === "csv" || resource.format?.toLowerCase() === "json") {
        try {
          const dataRes = await fetch(resource.url, { signal: AbortSignal.timeout(10000) });
          if (dataRes.ok) {
            const text = await dataRes.text();
            if (text.length > 200 && text.length < 500000) {
              documents.push({
                title: resource.name || resource.description || ds.title,
                text: text.slice(0, 50000), // Cap at 50k chars
                source: `stj:${ds.name}/${resource.id}`,
              });
            }
          }
        } catch {
          // Skip unavailable resources
        }
      }
    }
  }

  if (documents.length === 0) {
    console.warn("No documents fetched from STJ API, using sample data");
    return getSampleLegalTexts();
  }

  console.log(`Fetched ${documents.length} documents from STJ`);
  return documents;
}

function getSampleLegalTexts(): Array<{ title: string; text: string; source: string }> {
  return [
    {
      title: "Súmula 7 do STJ",
      text: `A pretensão de simples reexame de prova não enseja recurso especial.
      Esta súmula consolida o entendimento de que o Superior Tribunal de Justiça não pode, em sede de recurso especial,
      reexaminar o conjunto fático-probatório dos autos. O recurso especial tem por finalidade uniformizar a interpretação
      do direito federal infraconstitucional, não sendo cabível quando a análise do recurso demanda o reexame de provas.
      O tribunal de origem é soberano na apreciação das provas, e o STJ somente pode intervir quando houver violação
      expressa de lei federal ou divergência jurisprudencial na interpretação de norma federal. A aplicação desta súmula
      tem sido frequente em casos envolvendo responsabilidade civil, direito do consumidor, direito contratual e
      questões trabalhistas, onde a parte recorrente busca, na verdade, a reanálise dos fatos já examinados pelas
      instâncias ordinárias. O STJ tem reiterado que a valoração da prova e a conclusão fática extraída pelo tribunal
      de origem não podem ser revistas em recurso especial, salvo nas hipóteses de prova tarifada ou quando o julgado
      contrariar regra legal de distribuição do ônus probatório.`,
      source: "stj:sumula_7",
    },
    {
      title: "Recurso Especial - Direito do Consumidor",
      text: `RECURSO ESPECIAL. DIREITO DO CONSUMIDOR. RESPONSABILIDADE CIVIL. DANO MORAL. INSCRIÇÃO INDEVIDA EM CADASTRO
      DE INADIMPLENTES. QUANTUM INDENIZATÓRIO. REVISÃO. POSSIBILIDADE. VALOR EXORBITANTE OU IRRISÓRIO.
      1. A jurisprudência desta Corte é firme no sentido de que a inscrição indevida do nome do consumidor em cadastros
      de proteção ao crédito configura dano moral in re ipsa, dispensando a comprovação do prejuízo efetivo.
      2. O valor da indenização por danos morais pode ser revisto pelo STJ quando se mostrar exorbitante ou irrisório,
      em descompasso com os princípios da razoabilidade e proporcionalidade.
      3. Na fixação do quantum indenizatório, deve-se considerar a extensão do dano, as condições econômicas das partes,
      o caráter pedagógico e preventivo da medida, bem como a vedação ao enriquecimento ilícito.
      4. A responsabilidade do fornecedor de serviços é objetiva, nos termos do art. 14 do CDC, independendo da
      demonstração de culpa, bastando a comprovação do defeito no serviço e do nexo de causalidade com o dano.
      5. O dever de indenizar surge quando o fornecedor não comprova a inexistência do débito que deu ensejo à
      negativação do nome do consumidor. Recurso especial parcialmente provido.`,
      source: "stj:resp_consumidor",
    },
    {
      title: "Habeas Corpus - Prisão Preventiva",
      text: `HABEAS CORPUS. PROCESSUAL PENAL. PRISÃO PREVENTIVA. FUNDAMENTAÇÃO IDÔNEA. GARANTIA DA ORDEM PÚBLICA.
      GRAVIDADE CONCRETA DO DELITO. RISCO DE REITERAÇÃO DELITIVA. CONDIÇÕES PESSOAIS FAVORÁVEIS. IRRELEVÂNCIA.
      1. A prisão preventiva é medida excepcional no ordenamento jurídico brasileiro, somente sendo cabível quando
      presentes os requisitos do art. 312 do Código de Processo Penal: garantia da ordem pública, da ordem econômica,
      por conveniência da instrução criminal ou para assegurar a aplicação da lei penal.
      2. A fundamentação da prisão preventiva deve ser concreta, baseada em elementos dos autos que demonstrem a
      necessidade da custódia cautelar, não sendo suficiente a mera reprodução dos termos legais.
      3. A gravidade concreta do delito, evidenciada pelo modus operandi empregado e pelas circunstâncias específicas
      do caso, constitui fundamento idôneo para a manutenção da prisão preventiva, visando à garantia da ordem pública.
      4. O risco de reiteração delitiva, demonstrado pela existência de antecedentes criminais ou pela habitualidade
      na prática delitiva, justifica a segregação cautelar para proteção da sociedade.
      5. Condições pessoais favoráveis do acusado, como primariedade, bons antecedentes, residência fixa e ocupação
      lícita, por si sós, não impedem a decretação da prisão preventiva quando presentes os requisitos legais.
      Ordem denegada.`,
      source: "stj:hc_prisao_preventiva",
    },
    {
      title: "Direito Tributário - ICMS",
      text: `RECURSO ESPECIAL. DIREITO TRIBUTÁRIO. ICMS. INCLUSÃO NA BASE DE CÁLCULO DO PIS E DA COFINS.
      REPERCUSSÃO DA DECISÃO DO STF NO RE 574.706. MODULAÇÃO DE EFEITOS. APLICABILIDADE.
      1. O Supremo Tribunal Federal, no julgamento do RE 574.706, com repercussão geral reconhecida (Tema 69),
      fixou a tese de que o ICMS não compõe a base de cálculo para incidência do PIS e da COFINS.
      2. A modulação de efeitos determinada pelo STF estabeleceu que a decisão produz efeitos a partir de 15.03.2017,
      data do julgamento do mérito, ressalvadas as ações judiciais e administrativas protocoladas até aquela data.
      3. O ICMS a ser excluído da base de cálculo do PIS e da COFINS é o ICMS destacado nas notas fiscais,
      conforme esclarecido pelo STF nos embargos de declaração.
      4. A restituição do indébito tributário está sujeita ao prazo prescricional de 5 anos, contados da data do
      pagamento indevido, nos termos do art. 168, I, do CTN.
      5. Os valores a serem restituídos devem ser corrigidos pela taxa SELIC, que engloba juros moratórios e
      correção monetária, desde o recolhimento indevido até a efetiva restituição. Recurso especial provido.`,
      source: "stj:resp_icms_pis_cofins",
    },
    {
      title: "Direito Civil - Contratos",
      text: `RECURSO ESPECIAL. DIREITO CIVIL. CONTRATOS. REVISÃO CONTRATUAL. TEORIA DA IMPREVISÃO. COVID-19.
      CASO FORTUITO OU FORÇA MAIOR. BOA-FÉ OBJETIVA. EQUILÍBRIO CONTRATUAL.
      1. A pandemia de COVID-19 constitui fato extraordinário e imprevisível que pode justificar a revisão de
      contratos de execução continuada ou diferida, nos termos dos arts. 317 e 478 a 480 do Código Civil.
      2. A aplicação da teoria da imprevisão requer a demonstração cumulativa de: (a) evento extraordinário e
      imprevisível; (b) onerosidade excessiva para uma das partes; (c) vantagem extrema para a outra parte; e
      (d) nexo causal entre o evento e o desequilíbrio contratual.
      3. O princípio da boa-fé objetiva impõe às partes o dever de cooperação e de renegociação do contrato quando
      sobrevierem circunstâncias que alterem substancialmente o equilíbrio econômico-financeiro originalmente pactuado.
      4. A resolução do contrato por onerosidade excessiva é medida extrema, devendo o julgador, sempre que possível,
      preferir a revisão das cláusulas contratuais para restabelecer o equilíbrio, conforme previsto no art. 479 do CC.
      5. A distribuição dos prejuízos decorrentes da pandemia deve observar os princípios da proporcionalidade e da
      razoabilidade, evitando-se a transferência integral do risco econômico para apenas uma das partes contratantes.
      Recurso especial parcialmente provido.`,
      source: "stj:resp_contratos_covid",
    },
    {
      title: "Direito Administrativo - Improbidade",
      text: `RECURSO ESPECIAL. DIREITO ADMINISTRATIVO. IMPROBIDADE ADMINISTRATIVA. LEI 8.429/1992. ALTERAÇÕES DA
      LEI 14.230/2021. APLICAÇÃO RETROATIVA. DOLO. ELEMENTO SUBJETIVO. PRESCRIÇÃO INTERCORRENTE.
      1. Com as alterações promovidas pela Lei 14.230/2021 à Lei de Improbidade Administrativa, todas as modalidades
      de atos de improbidade passaram a exigir a comprovação do dolo específico do agente público.
      2. O Supremo Tribunal Federal, no julgamento do Tema 1.199 da repercussão geral, definiu que a nova exigência
      de dolo específico tem aplicação retroativa aos processos em curso, por ser norma mais benéfica.
      3. A prescrição intercorrente, introduzida pelo art. 23, §8º, da Lei 8.429/92, com redação dada pela Lei
      14.230/2021, também se aplica retroativamente, conforme decidido pelo STF. O prazo é de 4 anos contados da
      data da última manifestação nos autos pelo autor da ação.
      4. A indisponibilidade de bens do acusado pressupõe a demonstração de risco concreto de dilapidação patrimonial,
      não sendo suficiente a mera existência da ação de improbidade.
      5. O princípio da proporcionalidade deve nortear a aplicação das sanções previstas no art. 12 da LIA, sendo
      vedada a imposição cumulativa de todas as penalidades quando a conduta não justificar a máxima reprimenda.
      Recurso especial provido para reconhecer a necessidade de comprovação do dolo.`,
      source: "stj:resp_improbidade",
    },
  ];
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Re-Index with Local GPU Embeddings ===\n");
  console.log(`GPU Service: ${LOCAL_EMBEDDING_URL}`);
  console.log(`Qdrant:      ${QDRANT_URL}`);
  console.log(`Collection:  ${COLLECTION_NAME}`);
  console.log("");

  // 1. Check GPU service health
  const healthRes = await fetch(`${LOCAL_EMBEDDING_URL}/health`);
  if (!healthRes.ok) throw new Error("GPU service not available at " + LOCAL_EMBEDDING_URL);
  const health = await healthRes.json();
  console.log(`GPU: ${health.gpu} | Model: ${health.embedding_model} | Dim: ${health.embedding_dimension} | VRAM: ${health.vram_used_mb}MB\n`);

  // 2. Fetch data
  const documents = await fetchSTJData();
  console.log(`\nDocuments to index: ${documents.length}\n`);

  // 3. Chunk all documents
  const allChunks: Array<{ text: string; metadata: { title: string; source: string; chunkIndex: number } }> = [];
  for (const doc of documents) {
    const chunks = chunkText(doc.text);
    for (let i = 0; i < chunks.length; i++) {
      allChunks.push({
        text: chunks[i],
        metadata: { title: doc.title, source: doc.source, chunkIndex: i },
      });
    }
    console.log(`  "${doc.title}" → ${chunks.length} chunks`);
  }
  console.log(`\nTotal chunks: ${allChunks.length}\n`);

  // 4. Create/recreate collection
  await ensureCollection();

  // 5. Embed and upsert in batches
  let totalStored = 0;
  const startTime = Date.now();

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    const embedStart = Date.now();
    const embeddings = await embedBatch(texts);
    const embedMs = Date.now() - embedStart;

    const points = batch.map((c, idx) => ({
      id: crypto.randomUUID(),
      vector: embeddings[idx],
      payload: { text: c.text, ...c.metadata },
    }));

    await upsertPoints(points);
    totalStored += points.length;
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${points.length} vectors embedded in ${embedMs}ms, upserted to Qdrant`);
  }

  const totalMs = Date.now() - startTime;
  console.log(`\nIndexing complete: ${totalStored} vectors in ${totalMs}ms (${(totalStored / totalMs * 1000).toFixed(0)} vectors/s)\n`);

  // 6. Verify collection
  const colRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { headers: qdrantHeaders() });
  const colData: any = await colRes.json();
  console.log(`Collection "${COLLECTION_NAME}": ${colData.result?.points_count} points stored\n`);

  // 7. Test RAG queries
  console.log("=== Test RAG Queries ===\n");
  const testQueries = [
    "recurso especial reexame de prova",
    "dano moral inscrição indevida cadastro inadimplentes",
    "prisão preventiva requisitos fundamentação",
    "ICMS base de cálculo PIS COFINS",
    "revisão contratual pandemia COVID-19",
  ];

  for (const query of testQueries) {
    const queryVec = await embedQuery(query);
    const results = await searchQdrant(queryVec, 3);
    console.log(`Query: "${query}"`);
    for (const hit of results) {
      const score = hit.score?.toFixed(4) || "N/A";
      const title = hit.payload?.title || "?";
      const preview = (hit.payload?.text || "").slice(0, 80).replace(/\n/g, " ");
      console.log(`  [${score}] ${title}: "${preview}..."`);
    }
    console.log("");
  }

  console.log("=== Done! ===");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
