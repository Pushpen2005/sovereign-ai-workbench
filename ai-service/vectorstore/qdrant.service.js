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
        } else {
            await qdrant.createCollection(COLLECTION_NAME, {
                vectors: {
                    size: VECTOR_SIZE,
                    distance: "Cosine",
                },
            });

            console.log(
                `Collection "${COLLECTION_NAME}" created successfully`
            );
        }

        // Ensure payload index on organizationId for fast, tenant-isolated vector filtering
        try {
            await qdrant.createPayloadIndex(COLLECTION_NAME, {
                field_name: "organizationId",
                field_schema: "keyword",
                wait: true,
            });
            console.log(`Payload index for "organizationId" verified on "${COLLECTION_NAME}"`);
        } catch (idxErr) {
            // Index already exists or non-fatal
            if (!String(idxErr?.message || "").includes("already exists")) {
                console.warn(`[Qdrant] Payload index warning on organizationId:`, idxErr?.message);
            }
        }
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
                typeof chunk.organizationId !== "string" ||
                chunk.organizationId.trim().length === 0
            ) {
                throw new Error(
                    "Chunk organizationId must be a non-empty string for tenant-scoped vector storage"
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
                typeof chunk.pageStartOffset !== "number" ||
                chunk.pageStartOffset < 0
            ) {
                throw new Error(
                    "Chunk pageStartOffset must be a non-negative number"
                );
            }

            if (
                typeof chunk.pageEndOffset !== "number" ||
                chunk.pageEndOffset < chunk.pageStartOffset
            ) {
                throw new Error(
                    "Chunk pageEndOffset is invalid"
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
                    filename: chunk.filename,
                    documentType: chunk.documentType,
                    organizationId: chunk.organizationId.trim(),
                    page: chunk.page,
                    text: chunk.text,
                    chunkIndex: chunk.chunkIndex,
                    pageStartOffset: chunk.pageStartOffset,
                    pageEndOffset: chunk.pageEndOffset,
                    startOffset: chunk.pageStartOffset,
                    endOffset: chunk.pageEndOffset,
                    source: chunk.source || "pdf-text",
                    extractionMethod: chunk.extractionMethod || chunk.source || "pdf-text",
                },
            };
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

/**
 * Safely delete chunks for a document scoped strictly by organizationId.
 * Prevents cross-tenant deletion even if an attacker supplies a foreign documentId.
 *
 * @param {string} documentId
 * @param {string} organizationId
 */
export async function deleteChunksByDocumentId(documentId, organizationId) {
    if (typeof documentId !== "string" || !documentId.trim()) {
        throw new Error("documentId is required for tenant-scoped vector deletion");
    }
    if (typeof organizationId !== "string" || !organizationId.trim()) {
        throw new Error("organizationId is required for tenant-scoped vector deletion");
    }

    try {
        await qdrant.delete(COLLECTION_NAME, {
            wait: true,
            filter: {
                must: [
                    {
                        key: "documentId",
                        match: {
                            value: documentId.trim(),
                        },
                    },
                    {
                        key: "organizationId",
                        match: {
                            value: organizationId.trim(),
                        },
                    },
                ],
            },
        });
    } catch (error) {
        throw new Error(`Qdrant vector deletion failed: ${error.message}`);
    }
}

/**
 * Safely backfill organizationId for pre-indexed demo data points.
 *
 * @param {string} documentId
 * @param {string} organizationId
 */
export async function backfillDemoDocumentPoints(documentId, organizationId) {
    if (!documentId || !organizationId) return;

    try {
        await qdrant.setPayload(COLLECTION_NAME, {
            payload: {
                organizationId: organizationId.trim(),
            },
            filter: {
                must: [
                    {
                        key: "documentId",
                        match: {
                            value: documentId.trim(),
                        },
                    },
                ],
            },
            wait: true,
        });
    } catch (err) {
        console.warn(`[Qdrant] Warning during demo points backfill for ${documentId}:`, err.message);
    }
}

export { generatePointId, qdrant as qdrantClient };