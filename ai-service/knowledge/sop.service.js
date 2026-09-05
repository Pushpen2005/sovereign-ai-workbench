import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

import { extractPdfText } from "../extraction/pdf.service.js";
import { chunkText } from "../chunking/chunk.service.js";
import { generateEmbedding } from "../embeddings/embedding.service.js";
import { upsertChunks } from "../vectorstore/qdrant.service.js";
import { searchSimilarChunks } from "../retrieval/retrieval.service.js";

const SOP_DOCUMENT_TYPE = "sop";

const DEFAULT_LIMIT = 5;
const DEFAULT_SCORE_THRESHOLD = 0.5;

/**
 * Ingest a SOP PDF into the Qdrant knowledge base.
 *
 * Pipeline:
 *   PDF file → extractPdfText → chunkText
 *   → generateEmbedding × N → upsertChunks
 *
 * Every stored point will have:
 *   documentType = "sop"
 *   filename     = basename of the file
 *   documentId   = provided UUID or auto-generated
 *
 * @param {string} filePath - Absolute path to the SOP PDF.
 * @param {object} [options]
 * @param {string} [options.documentId] - Override the auto-generated UUID.
 * @returns {Promise<{
 *   documentId: string,
 *   filename: string,
 *   chunksStored: number
 * }>}
 */
export async function ingestSop(filePath, options = {}) {
    // --- Validation ---
    if (
        typeof filePath !== "string" ||
        filePath.trim().length === 0
    ) {
        throw new TypeError(
            "filePath must be a non-empty string"
        );
    }

    try {
        await fs.access(filePath);
    } catch {
        throw new Error(
            `SOP file does not exist: ${filePath}`
        );
    }

    // --- Metadata ---
    const documentId =
        typeof options.documentId === "string" &&
        options.documentId.trim().length > 0
            ? options.documentId.trim()
            : randomUUID();

    const filename = path.basename(filePath);

    // --- Extraction (page-aware, OCR fallback included) ---
    const { pages, extractionMethod } = await extractPdfText(filePath, {
        organizationId: options.organizationId,
        forceOcr: options.forceOcr,
    });

    // --- Chunking ---
    // chunkText skips empty pages internally.
    // Each chunk gets: documentId, page, chunkIndex, text,
    //                  pageStartOffset, pageEndOffset
    const rawChunks = chunkText(pages, documentId);

    if (rawChunks.length === 0) {
        throw new Error(
            `No text content could be extracted from: ${filename}`
        );
    }

    // --- Augment chunks with SOP-specific metadata ---
    const chunksWithMeta = rawChunks.map((chunk) => ({
        ...chunk,
        filename,
        documentType: SOP_DOCUMENT_TYPE,
        organizationId: options.organizationId || null,
        extractionMethod: chunk.extractionMethod || extractionMethod || "pdf-text",
    }));

    // --- Embed and attach vector to each chunk ---
    const chunksWithVectors = [];

    for (const chunk of chunksWithMeta) {
        const vector = await generateEmbedding(chunk.text);

        chunksWithVectors.push({
            ...chunk,
            vector,
        });
    }

    // --- Store in Qdrant ---
    await upsertChunks(chunksWithVectors);

    return {
        documentId,
        filename,
        chunksStored: chunksWithVectors.length,
        extractionMethod: extractionMethod || "pdf-text",
    };
}

/**
 * Search only SOP documents in Qdrant.
 *
 * Uses a Qdrant-level documentType="sop" filter so that
 * inspection documents are never retrieved.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.limit=5]
 * @param {number} [options.scoreThreshold=0.5]
 * @returns {Promise<Array<{
 *   documentId: string|null,
 *   filename: string|null,
 *   documentType: string|null,
 *   page: number|null,
 *   chunkIndex: number|null,
 *   score: number,
 *   text: string
 * }>>}
 */
export async function searchSop(
    query,
    options = {}
) {
    if (
        typeof query !== "string" ||
        query.trim().length === 0
    ) {
        throw new TypeError(
            "SOP search query must be a non-empty string"
        );
    }

    // MANDATORY TENANT BOUNDARY: Fail closed if organizationId is missing or invalid
    if (
        !options?.organizationId ||
        typeof options.organizationId !== "string" ||
        options.organizationId.trim().length === 0
    ) {
        throw new Error(
            "organizationId is required for tenant-scoped SOP retrieval"
        );
    }

    const limit =
        options.limit ?? DEFAULT_LIMIT;

    const scoreThreshold =
        options.scoreThreshold ??
        DEFAULT_SCORE_THRESHOLD;

    // 1. Convert finding/query into embedding
    const queryVector =
        await generateEmbedding(query.trim());

    // 2. Search Qdrant
    //
    // IMPORTANT:
    // documentType filter and organizationId filter are applied at the Qdrant level.
    // Mixed-type or cross-tenant documents are NEVER retrieved and then filtered
    // in JavaScript — the filter happens inside Qdrant.
    const chunks = await searchSimilarChunks(
        queryVector,
        limit,
        undefined,
        {
            documentType: SOP_DOCUMENT_TYPE,
            organizationId: options.organizationId.trim(),
        }
    );

    // 3. Keep only sufficiently relevant SOP chunks
    //    (secondary guard — Qdrant filter is the primary gate)
    return chunks
        .filter((chunk) => {
            return (
                chunk &&
                chunk.documentType === SOP_DOCUMENT_TYPE &&
                typeof chunk.text === "string" &&
                chunk.text.trim().length > 0 &&
                typeof chunk.score === "number" &&
                chunk.score >= scoreThreshold
            );
        })
        .sort(
            (a, b) => b.score - a.score
        )
        .map((chunk) => ({
            documentId: chunk.documentId ?? null,
            filename: chunk.filename ?? null,
            documentType:
                chunk.documentType ?? null,
            page: chunk.page ?? null,
            chunkIndex:
                chunk.chunkIndex ?? null,
            score: chunk.score,
            text: chunk.text,
            organizationId: chunk.organizationId ?? null,
        }));
}