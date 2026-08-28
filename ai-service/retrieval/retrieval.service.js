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
 * If documentId is provided, retrieval is restricted
 * to that document only.
 *
 * @param {number[]} queryVector
 * @param {number} limit
 * @param {string} [documentId]
 * @returns {Promise<Array>}
 */
export async function searchSimilarChunks(
    queryVector,
    limit = 5,
    documentId
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

    // Validate documentId when provided
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

    try {
        const searchRequest = {
            query: queryVector,
            limit,
            with_payload: true,
        };

        // Restrict retrieval to a specific document
        if (documentId !== undefined) {
            searchRequest.filter = {
                must: [
                    {
                        key: "documentId",
                        match: {
                            value: documentId.trim(),
                        },
                    },
                ],
            };
        }

        const response = await qdrant.query(
            COLLECTION_NAME,
            searchRequest
        );

        const results = response.points ?? [];

        return results.map((result) => ({
            score: result.score,
            documentId:
                result.payload?.documentId,
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
        }));
    } catch (error) {
        console.error(
            "Failed to search Qdrant:",
            error
        );

        throw new Error(
            `Qdrant similarity search failed: ${error.message}`,
            { cause: error }
        );
    }
}
