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
 * @param {number[]} queryVector
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function searchSimilarChunks(
    queryVector,
    limit = 5
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

    try {
        const response = await qdrant.query(
    COLLECTION_NAME,
    {
        query: queryVector,
        limit,
        with_payload: true,
    }
);

const results = response.points;
        ;

        return results.map((result) => ({
            score: result.score,
            documentId: result.payload?.documentId,
            text: result.payload?.text,
            chunkIndex: result.payload?.chunkIndex,
            startOffset: result.payload?.startOffset,
            endOffset: result.payload?.endOffset,
        }));
    } catch (error) {
        console.error(
            "Failed to search Qdrant:",
            error
        );

        throw new Error(
            `Qdrant similarity search failed: ${error.message}`
        );
    }
}