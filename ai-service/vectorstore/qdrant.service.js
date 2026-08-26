import "dotenv/config";
import crypto from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTION_NAME = "documents";
const VECTOR_SIZE = 384;

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
});

/**
 * Generate a deterministic Qdrant point ID
 * from the document ID and chunk index.
 *
 * @param {string} documentId
 * @param {number} chunkIndex
 * @returns {string}
 */
function generatePointId(documentId, chunkIndex) {
    const hash = crypto
        .createHash("sha256")
        .update(`${documentId}:${chunkIndex}`)
        .digest();

    // Set UUID version 4
    hash[6] = (hash[6] & 0x0f) | 0x40;

    // Set RFC 4122 variant
    hash[8] = (hash[8] & 0x3f) | 0x80;

    return [
        hash.subarray(0, 4).toString("hex"),
        hash.subarray(4, 6).toString("hex"),
        hash.subarray(6, 8).toString("hex"),
        hash.subarray(8, 10).toString("hex"),
        hash.subarray(10, 16).toString("hex"),
    ].join("-");
}

/**
 * Create the documents collection if it doesn't exist.
 */
export async function createCollection() {
    try {
        const collections = await qdrant.getCollections();

        const exists = collections.collections.some(
            (collection) => collection.name === COLLECTION_NAME
        );

        if (exists) {
            console.log(
                `Collection "${COLLECTION_NAME}" already exists`
            );
            return;
        }

        await qdrant.createCollection(COLLECTION_NAME, {
            vectors: {
                size: VECTOR_SIZE,
                distance: "Cosine",
            },
        });

        console.log(
            `Collection "${COLLECTION_NAME}" created successfully`
        );
    } catch (error) {
        console.error(
            "Failed to create Qdrant collection:",
            error
        );

        throw new Error(
            `Qdrant collection creation failed: ${error.message}`
        );
    }
}

/**
 * Store multiple chunk embeddings and metadata.
 *
 * @param {Array} chunks
 */
export async function upsertChunks(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new Error("Chunks must be a non-empty array");
    }

    try {
        const points = chunks.map((chunk) => {
            if (
                typeof chunk.documentId !== "string" ||
                chunk.documentId.trim().length === 0
            ) {
                throw new Error(
                    "Chunk documentId must be a non-empty string"
                );
            }

            if (
                typeof chunk.chunkIndex !== "number" ||
                chunk.chunkIndex < 0
            ) {
                throw new Error(
                    "Chunk chunkIndex must be a non-negative number"
                );
            }

            if (
                typeof chunk.text !== "string" ||
                chunk.text.trim().length === 0
            ) {
                throw new Error(
                    "Chunk text must be a non-empty string"
                );
            }

            if (
                typeof chunk.startOffset !== "number" ||
                chunk.startOffset < 0
            ) {
                throw new Error(
                    "Chunk startOffset must be a non-negative number"
                );
            }

            if (
                typeof chunk.endOffset !== "number" ||
                chunk.endOffset < chunk.startOffset
            ) {
                throw new Error(
                    "Chunk endOffset is invalid"
                );
            }

            if (!Array.isArray(chunk.vector)) {
                throw new Error(
                    "Chunk vector must be an array"
                );
            }

            if (chunk.vector.length !== VECTOR_SIZE) {
                throw new Error(
                    `Chunk vector must contain ${VECTOR_SIZE} dimensions`
                );
            }

            return {
                id: generatePointId(
                    chunk.documentId,
                    chunk.chunkIndex
                ),
                vector: chunk.vector,
                payload: {
                    documentId: chunk.documentId,
                    text: chunk.text,
                    chunkIndex: chunk.chunkIndex,
                    startOffset: chunk.startOffset,
                    endOffset: chunk.endOffset,
                },
            };;
        });

        await qdrant.upsert(COLLECTION_NAME, {
            wait: true,
            points,
        });

        console.log(
            `${points.length} chunks stored successfully`
        );
    } catch (error) {
        console.error(
            "Failed to upsert chunks into Qdrant:",
            error
        );

        throw new Error(
            `Qdrant upsert failed: ${error.message}`
        );
    }
}

export { generatePointId };