/**
 * Semantic Chunking Engine for Legal Documents
 * Splits long legal texts into meaningful chunks preserving context.
 */

export interface TextChunk {
  text: string;
  index: number;
  metadata: Record<string, any>;
}

const DEFAULT_CHUNK_SIZE = 1000; // characters
const DEFAULT_OVERLAP = 200;

/** Split text into chunks with overlap, respecting sentence boundaries */
export function chunkText(
  text: string,
  metadata: Record<string, any> = {},
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP
): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  const cleanText = text.replace(/\s+/g, " ").trim();

  if (cleanText.length <= chunkSize) {
    return [{ text: cleanText, index: 0, metadata }];
  }

  // Split into sentences first
  const sentences = splitIntoSentences(cleanText);
  const chunks: TextChunk[] = [];
  let currentChunk = "";
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunkIndex++,
        metadata: { ...metadata, chunkIndex: chunkIndex - 1 },
      });

      // Keep overlap from end of current chunk
      const words = currentChunk.split(" ");
      const overlapWords = [];
      let overlapLen = 0;
      for (let i = words.length - 1; i >= 0 && overlapLen < overlap; i--) {
        overlapWords.unshift(words[i]);
        overlapLen += words[i].length + 1;
      }
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunkIndex,
      metadata: { ...metadata, chunkIndex },
    });
  }

  return chunks;
}

/** Split text into sentences, handling legal document patterns */
function splitIntoSentences(text: string): string[] {
  // Legal text patterns: article numbers, abbreviations, etc.
  const sentenceEnders = /(?<=[.!?;])\s+(?=[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ0-9"])/g;
  const parts = text.split(sentenceEnders).filter(s => s.trim().length > 0);
  return parts;
}

/** Extract relevant fields from STJ JSON records and create text for embedding */
export function processSTJRecord(record: any): { text: string; metadata: Record<string, any> } {
  const fields: string[] = [];
  const metadata: Record<string, any> = {};

  // Common fields across STJ datasets
  if (record.id) metadata.recordId = record.id;
  if (record.processo) { metadata.processo = record.processo; fields.push(`Processo: ${record.processo}`); }
  if (record.classe) { metadata.classe = record.classe; fields.push(`Classe: ${record.classe}`); }
  if (record.relator) { metadata.relator = record.relator; fields.push(`Relator: ${record.relator}`); }
  if (record.orgaoJulgador) { metadata.orgaoJulgador = record.orgaoJulgador; fields.push(`Órgão Julgador: ${record.orgaoJulgador}`); }
  if (record.dataJulgamento) { metadata.dataJulgamento = record.dataJulgamento; fields.push(`Data do Julgamento: ${record.dataJulgamento}`); }
  if (record.dataPublicacao) { metadata.dataPublicacao = record.dataPublicacao; fields.push(`Data da Publicação: ${record.dataPublicacao}`); }

  // Ementa - most important field for legal search
  if (record.ementa) { fields.push(`EMENTA: ${record.ementa}`); }

  // Decision content
  if (record.decisao) { fields.push(`DECISÃO: ${record.decisao}`); }
  if (record.acordao) { fields.push(`ACÓRDÃO: ${record.acordao}`); }

  // Legal references
  if (record.referenciasLegislativas) {
    const refs = Array.isArray(record.referenciasLegislativas)
      ? record.referenciasLegislativas.join("; ")
      : record.referenciasLegislativas;
    fields.push(`Referências Legislativas: ${refs}`);
    metadata.referenciasLegislativas = refs;
  }

  // Notes and observations
  if (record.notas) { fields.push(`Notas: ${record.notas}`); }
  if (record.informacoesComplementares) { fields.push(`Informações Complementares: ${record.informacoesComplementares}`); }

  // Espelho de acórdão specific fields
  if (record.palavrasChave) {
    const kw = Array.isArray(record.palavrasChave) ? record.palavrasChave.join(", ") : record.palavrasChave;
    fields.push(`Palavras-chave: ${kw}`);
    metadata.palavrasChave = kw;
  }
  if (record.tema) { metadata.tema = record.tema; fields.push(`Tema: ${record.tema}`); }
  if (record.ramo) { metadata.ramo = record.ramo; fields.push(`Ramo do Direito: ${record.ramo}`); }

  // Handle nested structures - iterate remaining keys
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > 50 && !fields.some(f => f.includes(value.substring(0, 30)))) {
      fields.push(`${key}: ${value}`);
    }
  }

  return {
    text: fields.join("\n\n"),
    metadata,
  };
}

/** Process an array of STJ records into chunks ready for embedding */
export function processSTJRecords(
  records: any[],
  datasetSlug: string,
  resourceName: string
): TextChunk[] {
  const allChunks: TextChunk[] = [];

  for (const record of records) {
    const { text, metadata } = processSTJRecord(record);
    if (text.trim().length === 0) continue;

    const enrichedMetadata = {
      ...metadata,
      source: "stj",
      datasetSlug,
      resourceName,
    };

    const chunks = chunkText(text, enrichedMetadata);
    allChunks.push(...chunks);
  }

  return allChunks;
}
