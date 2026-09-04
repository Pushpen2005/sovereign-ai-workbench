import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTION_NAME = "documents";
const VECTOR_SIZE = 384;

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
});

/**
 * Search Qdrant for chunks similar to a query vector.
 *
 * Optional filters:
 * - documentId
 * - documentType
 * - allowedDocumentIds
 *
 * @param {number[]} queryVector
 * @param {number} limit
 * @param {string} [documentId]
 * @param {object} [filters]
 * @param {string} [filters.documentType]
 * @param {string[]} [filters.allowedDocumentIds]
 * @returns {Promise<Array>}
 */
export async function searchSimilarChunks(
    queryVector,
    limit = 5,
    documentId,
    filters = {}
) {
    // Validate query vector
    if (!Array.isArray(queryVector)) {
        throw new TypeError(
            "Query vector must be an array"
        );
    }

    // Validate dimensions
    if (queryVector.length !== VECTOR_SIZE) {
        throw new Error(
            `Query vector must contain exactly ${VECTOR_SIZE} dimensions`
        );
    }

    // Validate limit
    if (
        !Number.isInteger(limit) ||
        limit <= 0
    ) {
        throw new Error(
            "Limit must be a positive integer"
        );
    }

    // Validate documentId
    if (
        documentId !== undefined &&
        (
            typeof documentId !== "string" ||
            documentId.trim().length === 0
        )
    ) {
        throw new Error(
            "documentId must be a non-empty string"
        );
    }

    // Validate filters
    if (
        !filters ||
        typeof filters !== "object" ||
        Array.isArray(filters)
    ) {
        throw new TypeError(
            "filters must be an object"
        );
    }

    if (
        filters.documentType !== undefined &&
        (
            typeof filters.documentType !== "string" ||
            filters.documentType.trim().length === 0
        )
    ) {
        throw new Error(
            "filters.documentType must be a non-empty string"
        );
    }

    if (
        filters.allowedDocumentIds !== undefined &&
        (
            !Array.isArray(filters.allowedDocumentIds) ||
            filters.allowedDocumentIds.some(
                (value) => typeof value !== "string" || value.trim().length === 0
            )
        )
    ) {
        throw new Error(
            "filters.allowedDocumentIds must be an array of non-empty strings"
        );
    }

    // MANDATORY TENANT BOUNDARY: Fail closed if organizationId is missing or invalid
    if (
        !filters.organizationId ||
        typeof filters.organizationId !== "string" ||
        filters.organizationId.trim().length === 0
    ) {
        throw new Error(
            "organizationId is required for tenant-scoped vector retrieval"
        );
    }

    try {
        const must = [
            {
                key: "organizationId",
                match: {
                    value: filters.organizationId.trim(),
                },
            },
        ];
        const allowedDocumentIds = Array.isArray(filters.allowedDocumentIds)
            ? new Set(filters.allowedDocumentIds.map((value) => value.trim()))
            : null;

        if (allowedDocumentIds && allowedDocumentIds.size === 0) {
            return [];
        }

        // Filter by documentId when provided
        if (documentId !== undefined && documentId !== null) {
            must.push({
                key: "documentId",
                match: {
                    value: documentId.trim(),
                },
            });
        } else if (allowedDocumentIds && allowedDocumentIds.size > 0) {
            must.push({
                key: "documentId",
                match: {
                    any: Array.from(allowedDocumentIds),
                },
            });
        }

        // Filter by documentType when provided
        if (filters.documentType !== undefined) {
            must.push({
                key: "documentType",
                match: {
                    value: filters.documentType.trim(),
                },
            });
        }

        const searchRequest = {
            query: queryVector,
            limit,
            with_payload: true,
            filter: {
                must,
            },
        };

        const response = await qdrant.query(
            COLLECTION_NAME,
            searchRequest
        );

        const results = response.points ?? [];

        console.log(
            "=== RAW QDRANT RESULTS ==="
        );

        console.dir(results, {
            depth: null,
        });

        const mappedResults = results.map((result) => ({
            score: result.score,

            documentId:
                result.payload?.documentId,

            filename:
                result.payload?.filename,

            documentType:
                result.payload?.documentType,

            page:
                result.payload?.page,

            text:
                result.payload?.text,

            chunkIndex:
                result.payload?.chunkIndex,

            pageStartOffset:
                result.payload?.pageStartOffset,

            pageEndOffset:
                result.payload?.pageEndOffset,

            startOffset:
                result.payload?.pageStartOffset ?? result.payload?.startOffset,

            endOffset:
                result.payload?.pageEndOffset ?? result.payload?.endOffset,

            organizationId:
                result.payload?.organizationId || null,
        }));

        return allowedDocumentIds
            ? mappedResults.filter((result) => allowedDocumentIds.has(result.documentId))
            : mappedResults;
    } catch (error) {
        console.error(
            "Failed to search Qdrant:",
            error
        );

        throw new Error(
            `Qdrant similarity search failed: ${error.message}`,
            {
                cause: error,
            }
        );
    }
}
