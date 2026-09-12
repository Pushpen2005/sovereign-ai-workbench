/**
 * Model Runtime Registry (ai-service/llm/runtime/modelRegistry.js)
 *
 * Single authoritative source of truth for SovereignAI local MLX model runtimes.
 * Defines runtime metadata, ports, health endpoints, paths, and lifecycle states.
 */

import path from "path";
import { fileURLToPath } from "url";
import { MODEL_RUNTIME_CONFIG } from "../../config/modelRuntime.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LIFECYCLE_STATE = Object.freeze({
    STOPPED:   "STOPPED",
    STARTING:  "STARTING",
    READY:     "READY",
    UNHEALTHY: "UNHEALTHY",
    STOPPING:  "STOPPING",
    FAILED:    "FAILED",
});

export const DEFAULT_MLX_RUNTIME_DIR = path.resolve(__dirname, "../../mlx-runtime");

export const MODEL_RUNTIME_REGISTRY = Object.freeze({
    gemma: Object.freeze({
        id: "gemma",
        logicalModel: MODEL_RUNTIME_CONFIG.INSPECTION.model,
        provider: "gemma_mlx",
        runtime: MODEL_RUNTIME_CONFIG.INSPECTION.runtime,
        port: 8080,
        host: "127.0.0.1",
        get healthUrl() {
            const base = MODEL_RUNTIME_CONFIG.INSPECTION.url.replace(/\/$/, "");
            return `${base}/health`;
        },
        modelRelPath: "models/gemma-2-2b-it-4bit",
        serverModule: "mlx_lm.server",
        defaultArgs: ["--host", "0.0.0.0", "--port", "8080"],
        aliases: [
            "gemma-2-2b-it-4bit",
            "gemma-2-2b-it",
            "gemma-2-2b",
            "gemma",
            "gemma_mlx",
            "mlx",
        ],
    }),

    qwen_coder: Object.freeze({
        id: "qwen_coder",
        logicalModel: MODEL_RUNTIME_CONFIG.CODING.model,
        provider: "qwen_coder_mlx",
        runtime: MODEL_RUNTIME_CONFIG.CODING.runtime,
        port: 8081,
        host: "127.0.0.1",
        get healthUrl() {
            const base = MODEL_RUNTIME_CONFIG.CODING.url.replace(/\/$/, "");
            return `${base}/health`;
        },
        modelRelPath: "models/qwen2.5-coder-3b-4bit",
        serverModule: "mlx_lm.server",
        defaultArgs: ["--host", "0.0.0.0", "--port", "8081"],
        aliases: [
            "qwen2.5-coder:3b-4bit",
            "qwen2.5-coder:3b",
            "qwen2.5-coder",
            "coder-mlx",
            "qwen_coder_mlx",
            "qwen_mlx",
        ],
    }),

    qwen_vl: Object.freeze({
        id: "qwen_vl",
        logicalModel: MODEL_RUNTIME_CONFIG.VISION.model,
        provider: "qwen_vl_mlx",
        runtime: MODEL_RUNTIME_CONFIG.VISION.runtime,
        port: 8082,
        host: "127.0.0.1",
        get healthUrl() {
            const base = MODEL_RUNTIME_CONFIG.VISION.url.replace(/\/$/, "");
            return `${base}/health`;
        },
        modelRelPath: "models/qwen2.5-vl-3b-4bit",
        serverModule: "mlx_vlm.server",
        defaultArgs: ["--host", "0.0.0.0", "--port", "8082"],
        aliases: [
            "qwen2.5-vl:3b-4bit",
            "qwen2.5-vl:3b",
            "qwen2.5-vl",
            "models/qwen2.5-vl-3b-4bit",
            "vision-mlx",
            "qwen_vl_mlx",
            "vision_mlx",
        ],
    }),
});

/**
 * Resolves a model name or alias to its registry entry.
 *
 * @param {string} modelOrAlias
 * @returns {typeof MODEL_RUNTIME_REGISTRY[keyof typeof MODEL_RUNTIME_REGISTRY] | null}
 */
export function resolveRegistryEntry(modelOrAlias) {
    if (!modelOrAlias || typeof modelOrAlias !== "string") return null;
    const clean = modelOrAlias.trim().toLowerCase();

    // Direct key match
    if (MODEL_RUNTIME_REGISTRY[clean]) {
        return MODEL_RUNTIME_REGISTRY[clean];
    }

    // Alias scan
    for (const entry of Object.values(MODEL_RUNTIME_REGISTRY)) {
        if (entry.logicalModel.toLowerCase() === clean) return entry;
        if (entry.id.toLowerCase() === clean) return entry;
        if (entry.provider.toLowerCase() === clean) return entry;
        if (entry.aliases.some((alias) => alias.toLowerCase() === clean)) {
            return entry;
        }
    }

    // Substring fallback for common variations
    if (clean.includes("vl") || clean.includes("vision")) {
        return MODEL_RUNTIME_REGISTRY.qwen_vl;
    }
    if (clean.includes("coder") || clean.includes("qwen")) {
        return MODEL_RUNTIME_REGISTRY.qwen_coder;
    }
    if (clean.includes("gemma")) {
        return MODEL_RUNTIME_REGISTRY.gemma;
    }

    return null;
}

/**
 * Checks if a model name corresponds to a managed local MLX runtime.
 *
 * @param {string} modelName
 * @returns {boolean}
 */
export function isManagedModel(modelName) {
    return resolveRegistryEntry(modelName) !== null;
}
