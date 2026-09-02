/**
 * PR #26 — Document Search Agent Tool
 *
 * Reuses the existing Qdrant vector retrieval pipeline:
 *   generateEmbedding(query) -> searchSimilarChunks(embedding)
 * Preserves citation metadata (documentId, filename, page, chunkIndex, score).
 */

import { generateEmbedding } from "../../../../ai-service/embeddings/embedding.service.js";
import { searchSimilarChunks } from "../../../../ai-service/retrieval/retrieval.service.js";

export class DocumentSearchError extends Error {
    constructor(message) {
        super(message);
        this.name = "DocumentSearchError";
    }
}

/**
 * Executes a semantic vector search across ingested documents in Qdrant.
 *
 * @param {object} args
 * @param {string} args.query - Natural language query string
 * @param {number} [args.limit=5] - Maximum number of chunks to retrieve (1-10)
 * @param {string} [args.documentId] - Optional filter to limit search to a single document
 * @returns {Promise<{ query: string, totalResults: number, results: Array<object> }>}
 */
export async function executeDocumentSearch(args) {
    if (!args || typeof args !== "object") {
        throw new DocumentSearchError("Arguments must be an object with a 'query' string");
    }

    const { query, documentId, limit: rawLimit } = args;

    if (typeof query !== "string" || !query.trim()) {
        throw new DocumentSearchError("query must be a non-empty string");
    }

    const limit = Math.min(Math.max(Number.isInteger(rawLimit) ? rawLimit : 5, 1), 10);

    let queryVector;
    try {
        queryVector = await generateEmbedding(query.trim());
    } catch (embErr) {
        throw new DocumentSearchError(`Failed to generate query embedding: ${embErr.message}`);
    }

    let chunks;
    try {
        chunks = await searchSimilarChunks(queryVector, limit, documentId);
    } catch (searchErr) {
        throw new DocumentSearchError(`Qdrant vector search failed: ${searchErr.message}`);
    }

    const results = (chunks || []).map((c) => ({
        text: c.text ? c.text.trim() : "",
        score: typeof c.score === "number" ? parseFloat(c.score.toFixed(4)) : null,
        filename: c.filename || "unknown.pdf",
        documentId: c.documentId || null,
        page: c.page ?? 1,
        chunkIndex: c.chunkIndex ?? 0,
        documentType: c.documentType || null,
    }));

    return {
        query: query.trim(),
        totalResults: results.length,
        results,
    };
}
