import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = 384;

let embeddingPipeline = null;

/**
 * Load the embedding model lazily.
 *
 * The model is loaded only when the first embedding
 * request is made and reused for subsequent requests.
 */
async function getEmbeddingPipeline() {
    if (!embeddingPipeline) {
        embeddingPipeline = await pipeline(
            "feature-extraction",
            MODEL_NAME
        );
    }

    return embeddingPipeline;
}

/**
 * Generate an embedding vector for the provided text.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("Text must be a non-empty string");
    }

    try {
        const extractor = await getEmbeddingPipeline();

        const output = await extractor(text, {
            pooling: "mean",
            normalize: true,
        });

        const embedding = output.tolist()[0];

        if (!Array.isArray(embedding)) {
            throw new Error("Invalid embedding output");
        }

        if (embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
                `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, received ${embedding.length}`
            );
        }

        return embedding;
    } catch (error) {
        console.error("Embedding generation failed:", error);

        throw new Error(
            `Failed to generate embedding: ${error.message}`
        );
    }
}

export { EMBEDDING_DIMENSIONS };