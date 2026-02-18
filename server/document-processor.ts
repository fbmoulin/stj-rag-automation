/**
 * Document Processor - Handles uploaded PDF, DOCX, TXT files
 * Extracts text, chunks, and generates embeddings.
 */
import { chunkText, TextChunk } from "./chunker";
import { storeChunks } from "./embeddings";
import { updateDocument, createLog, updateLog } from "./db";

/** Extract text from a buffer based on MIME type */
export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  if (mimeType === "text/plain" || filename.endsWith(".txt")) {
    return buffer.toString("utf-8");
  }

  if (mimeType === "application/pdf" || filename.endsWith(".pdf")) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer }) as any;
      await parser.load();
      const pages: string[] = [];
      for (let i = 1; i <= parser.doc.numPages; i++) {
        const pageText = await parser.getText(i);
        if (pageText) pages.push(String(pageText.text || pageText));
      }
      return pages.join("\n") || "";
    } catch (error: any) {
      throw new Error(`PDF extraction failed: ${error.message}`);
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.endsWith(".docx")
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } catch (error: any) {
      throw new Error(`DOCX extraction failed: ${error.message}`);
    }
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/** Process a document: extract text, chunk, and generate embeddings */
export async function processDocument(
  documentId: number,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  collectionName: string
): Promise<{ chunks: number; embeddings: number }> {
  const startTime = Date.now();
  const logId = await createLog({
    action: "process_document",
    documentId,
    status: "started",
    details: `Processing ${filename} (${mimeType})`,
  });

  try {
    // Step 1: Extract text
    await updateDocument(documentId, { status: "extracting" });
    const text = await extractText(buffer, mimeType, filename);

    if (!text || text.trim().length === 0) {
      throw new Error("No text content extracted from document");
    }

    await updateDocument(documentId, {
      status: "extracted",
      textContent: text.substring(0, 65000), // MySQL text limit
    });

    // Step 2: Chunk text
    await updateDocument(documentId, { status: "chunking" });
    const chunks = chunkText(text, {
      source: "upload",
      documentId,
      filename,
      mimeType,
    });

    await updateDocument(documentId, {
      status: "chunked",
      chunkCount: chunks.length,
    });

    // Step 3: Generate embeddings and store
    await updateDocument(documentId, { status: "embedding" });
    const result = await storeChunks(collectionName, chunks);

    await updateDocument(documentId, {
      status: "embedded",
      collectionName,
      chunkCount: chunks.length,
    });

    const duration = Date.now() - startTime;
    if (logId) {
      await updateLog(logId, {
        status: "completed",
        chunksGenerated: chunks.length,
        embeddingsGenerated: result.stored,
        durationMs: duration,
      });
    }

    return { chunks: chunks.length, embeddings: result.stored };
  } catch (error: any) {
    await updateDocument(documentId, {
      status: "error",
      errorMessage: error.message,
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
