/**
 * PR #26 / Phase 7 — Document Search Agent Tool
 *
 * Reuses the existing Qdrant vector retrieval pipeline:
 *   generateEmbedding(query) -> searchSimilarChunks(embedding)
 * Preserves citation metadata (documentId, filename, page, chunkIndex, score).
 */

import { generateEmbedding } from "../../../../ai-service/embeddings/embedding.service.js";
import { searchSimilarChunks } from "../../../../ai-service/retrieval/retrieval.service.js";
import { checkKnowledgeBaseSopGate } from "../sop-gate.service.js";

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
 * @param {string} [args.organizationId] - Tenant organization ID
 * @param {number} [args.topK] - Maximum number of chunks to retrieve (1-10)
 * @param {number} [args.limit] - Alias for topK
 * @param {string} [args.documentId] - Optional filter to limit search to a single document
 * @param {string} [args.documentType] - Optional document type filter (e.g. 'sop')
 * @param {object} [context={}] - Execution context containing authoritative organizationId
 * @returns {Promise<{ query: string, totalResults: number, results: Array<object> }>}
 */
export async function executeDocumentSearch(args, context = {}) {
    if (!args || typeof args !== "object") {
        throw new DocumentSearchError("Arguments must be an object with a 'query' string");
    }

    const organizationId = context?.organizationId || args.organizationId;
    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new DocumentSearchError("Execution context missing authenticated organizationId for document search");
    }

    const { query, documentId, documentType, topK, limit: rawLimit } = args;

    if (typeof query !== "string" || !query.trim()) {
        throw new DocumentSearchError("query must be a non-empty string");
    }

    const requestedLimit = Number.isInteger(topK) ? topK : rawLimit;
    const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 5, 1), 10);

    let queryVector;
    try {
        queryVector = await generateEmbedding(query.trim());
    } catch (embErr) {
        throw new DocumentSearchError(`Failed to generate query embedding: ${embErr.message}`);
    }

    const filters = {
        organizationId: organizationId.trim(),
    };
    if (documentType && typeof documentType === "string" && documentType.trim()) {
        filters.documentType = documentType.trim().toLowerCase();
    }

    if (filters.documentType === "sop") {
        const gate = await checkKnowledgeBaseSopGate(organizationId.trim());
        if (!gate.evidenceAvailable) {
            return {
                query: query.trim(),
                totalResults: 0,
                results: [],
                evidenceAvailable: false,
                reason: "knowledge_base_empty",
            };
        }
        filters.allowedDocumentIds = gate.allowedDocumentIds;
    }

    let chunks;
    try {
        chunks = await searchSimilarChunks(queryVector, limit, documentId, filters);
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
