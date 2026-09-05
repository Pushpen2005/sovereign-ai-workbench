import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = 384;

let embeddingPipeline = null;

let totalEmbeddingCalls = 0;
let totalEmbeddingTimeMs = 0;

/**
 * Load the embedding model lazily or return cached instance.
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
 * Check whether the embedding pipeline is currently warm in memory.
 *
 * @returns {boolean}
 */
export function isEmbeddingPipelineWarm() {
    return Boolean(embeddingPipeline);
}

/**
 * Pre-warms the local embedding model into memory.
 *
 * @returns {Promise<{ warm: boolean, durationMs: number }>}
 */
export async function warmEmbeddingPipeline() {
    const t0 = Date.now();
    const extractor = await getEmbeddingPipeline();
    // Warm up the ONNX session with a tiny seed
    await extractor("sovereign ai", { pooling: "mean", normalize: true });
    return {
        warm: true,
        durationMs: Date.now() - t0,
    };
}

/**
 * Return aggregate telemetry for the embedding service.
 *
 * @returns {object}
 */
export function getEmbeddingMetrics() {
    return {
        model: MODEL_NAME,
        dimensions: EMBEDDING_DIMENSIONS,
        isWarm: Boolean(embeddingPipeline),
        totalInvocations: totalEmbeddingCalls,
        avgLatencyMs: totalEmbeddingCalls > 0 ? Math.round(totalEmbeddingTimeMs / totalEmbeddingCalls) : 0,
    };
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

    const t0 = Date.now();
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

        totalEmbeddingCalls++;
        totalEmbeddingTimeMs += (Date.now() - t0);

        return embedding;
    } catch (error) {
        console.error("Embedding generation failed:", error);

        throw new Error(
            `Failed to generate embedding: ${error.message}`
        );
    }
}

export { EMBEDDING_DIMENSIONS };