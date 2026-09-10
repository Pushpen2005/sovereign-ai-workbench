/**
 * Model Gateway (ai-service/llm/llm.service.js)
 *
 * Centralized inference gateway orchestrating local model runtime adapters:
 *   - GemmaMlxAdapter (Native macOS MLX server via :8080)
 *   - OllamaAdapter (Local Ollama daemon via :11434)
 *
 * INVARIANTS PRESERVED:
 *   - Identical external signature: generateAnswer(prompt, modelOrOptions, maybeOptions)
 *   - Identical error contract: LLMError class with status code & error codes
 *   - Identical streaming contract: options.onChunk callback
 *   - Defense-in-depth sovereign allowlist enforcement
 */

import { isModelAllowed } from "../router/modelRouter.js";
import { OllamaAdapter } from "./adapters/ollama.adapter.js";
import { GemmaMlxAdapter } from "./adapters/gemmaMlx.adapter.js";
import { QwenCoderMlxAdapter } from "./adapters/qwenCoderMlx.adapter.js";
import { QwenVlMlxAdapter } from "./adapters/qwenVlMlx.adapter.js";
import { localModelRuntimeManager, isManagedModel } from "./runtime/localModelRuntime.manager.js";

export class LLMError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "LLMError";
        this.code = options.code || "LLM_ERROR";
        this.model = options.model;
        if (options.statusCode) {
            this.statusCode = options.statusCode;
        }
    }
}

// Instantiate singleton adapters
const ollamaAdapter = new OllamaAdapter();
const gemmaMlxAdapter = new GemmaMlxAdapter();
const qwenCoderMlxAdapter = new QwenCoderMlxAdapter();
const qwenVlMlxAdapter = new QwenVlMlxAdapter();

const ADAPTERS = Object.freeze({
    ollama: ollamaAdapter,
    mlx: gemmaMlxAdapter,
    gemma_mlx: gemmaMlxAdapter,
    qwen_coder_mlx: qwenCoderMlxAdapter,
    qwen_mlx: qwenCoderMlxAdapter,
    qwen_vl_mlx: qwenVlMlxAdapter,
    vision_mlx: qwenVlMlxAdapter,
});

/**
 * Returns the active provider adapter for the specified model and options.
 *
 * @param {string} modelName
 * @param {object} options
 * @returns {import("./adapters/base.adapter.js").BaseAdapter}
 */
export function resolveAdapter(modelName, options = {}) {
    const explicitProvider = options.provider || process.env.LLM_PROVIDER;

    if (explicitProvider && ADAPTERS[explicitProvider.toLowerCase()]) {
        return ADAPTERS[explicitProvider.toLowerCase()];
    }

    // Auto-selection based on model identifier:
    const norm = String(modelName || "").toLowerCase().trim();
    if (norm.includes("vl") || norm.includes("qwen2.5-vl") || norm.includes("vision-mlx")) {
        return qwenVlMlxAdapter;
    }
    if (norm.startsWith("qwen") || norm.includes("qwen2.5-coder") || norm.includes("coder-mlx")) {
        return qwenCoderMlxAdapter;
    }
    if (norm.startsWith("gemma") || norm.includes("mlx")) {
        return gemmaMlxAdapter;
    }

    return ollamaAdapter;
}

/**
 * Normalizes input arguments into standard prompt, model, options tuple.
 */
function normalizeInvocationArgs(prompt, modelOrOptions, maybeOptions = {}) {
    if (typeof prompt !== "string") {
        throw new LLMError("Prompt must be a string");
    }

    if (!prompt.trim()) {
        throw new LLMError("Prompt cannot be empty");
    }

    let model = undefined;
    let options = {};

    if (typeof modelOrOptions === "string") {
        model = modelOrOptions;
        options = maybeOptions || {};
    } else if (modelOrOptions && typeof modelOrOptions === "object") {
        options = modelOrOptions;
        model = options.model;
    } else if (
        (modelOrOptions === undefined || modelOrOptions === null) &&
        maybeOptions &&
        typeof maybeOptions === "object"
    ) {
        options = maybeOptions;
        model = options.model;
    }

    if (model !== undefined && model !== null) {
        if (typeof model !== "string") {
            throw new LLMError("Model must be a string");
        }

        if (!model.trim()) {
            throw new LLMError("Model cannot be empty");
        }
    }

    return {
        prompt: prompt.trim(),
        model: model?.trim(),
        options: options || {},
    };
}

/**
 * Primary inference entry point used by RAG, Inspection, Risk, and Agents.
 *
 * @param {string} prompt
 * @param {string|object} [modelOrOptions]
 * @param {object} [maybeOptions]
 * @returns {Promise<string>}
 */
async function generateAnswer(prompt, modelOrOptions, maybeOptions = {}) {
    const normalized = normalizeInvocationArgs(prompt, modelOrOptions, maybeOptions);
    const options = normalized.options;

    const defaultModel =
        process.env.DEFAULT_MODEL ||
        process.env.OLLAMA_MODEL ||
        process.env.MLX_MODEL ||
        "llama3.2:3b";

    const selectedModel = normalized.model || defaultModel;

    // Defense-in-depth sovereign allowlist enforcement: block unauthorized model execution
    if (!isModelAllowed(selectedModel)) {
        const err = new LLMError(
            `Model '${selectedModel}' is not in the sovereign model allowlist.`,
            { code: "MODEL_NOT_ALLOWED", model: selectedModel, statusCode: 400 }
        );
        err.code = "MODEL_NOT_ALLOWED";
        err.statusCode = 400;
        throw err;
    }

    const managed = isManagedModel(selectedModel);
    if (managed) {
        try {
            await localModelRuntimeManager.ensureRunning(selectedModel);
        } catch (startupErr) {
            console.warn(`[RUNTIME-MANAGER] ensureRunning failed for '${selectedModel}': ${startupErr.message}`);
            const norm = String(selectedModel).toLowerCase();
            if (norm.includes("vl") || norm.includes("vision")) {
                const fallbackVision = process.env.VISION_MODEL || "moondream";
                console.log(`[RUNTIME-MANAGER] Falling back to vision fallback: ${fallbackVision}`);
                return await ollamaAdapter.generate(normalized.prompt, fallbackVision, options);
            }
            if (norm.includes("coder") || norm.includes("qwen")) {
                const fallbackCoding = process.env.DEFAULT_MODEL || "llama3.2:3b";
                console.log(`[RUNTIME-MANAGER] Falling back to coding fallback: ${fallbackCoding}`);
                return await ollamaAdapter.generate(normalized.prompt, fallbackCoding, options);
            }
            throw new LLMError(`Failed to start local model server for '${selectedModel}': ${startupErr.message}`, {
                cause: startupErr,
                code: "STARTUP_FAILED",
                statusCode: 503,
                model: selectedModel,
            });
        }
        localModelRuntimeManager.incrementActiveRequests(selectedModel);
        localModelRuntimeManager.recordUsage(selectedModel);
    }

    const adapter = resolveAdapter(selectedModel, options);

    try {
        const result = await adapter.generate(normalized.prompt, selectedModel, options);
        if (managed) {
            localModelRuntimeManager.recordUsage(selectedModel);
        }
        return result;
    } catch (error) {
        if (error instanceof LLMError) {
            throw error;
        }

        if (
            error.name === "TimeoutError" ||
            error.message?.includes("timed out") ||
            error.message?.includes("The operation was aborted")
        ) {
            throw new LLMError("Inference timed out", {
                cause: error,
                code: "TIMEOUT",
                statusCode: 408,
                model: selectedModel,
            });
        }

        if (error.statusCode === 404 || error.message?.includes("Model unavailable")) {
            throw new LLMError("Model unavailable", {
                cause: error,
                code: "MODEL_UNAVAILABLE",
                statusCode: 404,
                model: selectedModel,
            });
        }

        if (error instanceof TypeError || error.code === "ECONNREFUSED" || error.message?.includes("fetch failed")) {
            throw new LLMError(`${adapter.name.toUpperCase()} connection failed: ${error.message}`, {
                cause: error,
                code: "CONNECTION_FAILED",
                statusCode: 503,
                model: selectedModel,
            });
        }

        throw new LLMError(error.message || "LLM generation failed", {
            cause: error,
            code: error.code || "GENERATION_FAILED",
            statusCode: error.statusCode || 500,
            model: selectedModel,
        });
    } finally {
        if (managed) {
            localModelRuntimeManager.decrementActiveRequests(selectedModel);
        }
    }
}

/**
 * Multimodal vision inference wrapper.
 *
 * @param {string} prompt
 * @param {string|string[]} images - Base64 encoded image strings
 * @param {string} [model]
 * @param {object} [options]
 * @returns {Promise<string>}
 */
async function generateVisionAnswer(prompt, images, model, options = {}) {
    const imageList = Array.isArray(images) ? images : [images];
    return generateAnswer(prompt, model, {
        ...options,
        images: imageList.filter(Boolean),
    });
}

/**
 * Pre-warms local models across registered adapters.
 *
 * @param {string[]} [models]
 * @returns {Promise<Array<{ model: string, success: boolean, durationMs: number, provider: string }>>}
 */
async function warmLocalModels(models = ["llama3.2:3b", "gemma-2-2b-it-4bit"]) {
    const results = [];

    for (const model of models) {
        const adapter = resolveAdapter(model);
        try {
            const res = await adapter.warmModel(model);
            results.push({
                ...res,
                provider: adapter.name,
            });
        } catch (err) {
            results.push({
                model,
                success: false,
                durationMs: 0,
                provider: adapter.name,
                error: err.message,
            });
        }
    }

    return results;
}

/**
 * Diagnostic helper to check health across all registered adapters.
 *
 * @returns {Promise<Record<string, { healthy: boolean, url: string }>>}
 */
async function checkGatewayHealth() {
    const [ollamaHealthy, mlxHealthy, qwenHealthy, qwenVlHealthy] = await Promise.all([
        ollamaAdapter.checkHealth(),
        gemmaMlxAdapter.checkHealth(),
        qwenCoderMlxAdapter.checkHealth(),
        qwenVlMlxAdapter.checkHealth(),
    ]);

    return {
        ollama: {
            healthy: ollamaHealthy,
            url: ollamaAdapter.getBaseUrl(),
        },
        mlx: {
            healthy: mlxHealthy,
            url: gemmaMlxAdapter.getBaseUrl(),
        },
        qwen_mlx: {
            healthy: qwenHealthy,
            url: qwenCoderMlxAdapter.getBaseUrl(),
        },
        qwen_vl_mlx: {
            healthy: qwenVlHealthy,
            url: qwenVlMlxAdapter.getBaseUrl(),
        },
    };
}

export {
    generateAnswer,
    generateVisionAnswer,
    warmLocalModels,
    checkGatewayHealth,
    ADAPTERS,
    ollamaAdapter,
    gemmaMlxAdapter,
    qwenCoderMlxAdapter,
    qwenVlMlxAdapter,
    localModelRuntimeManager,
};
