/**
 * Centralized Model Runtime Configuration
 *
 * Single authoritative source of truth for all local model runtimes, endpoints, and timeouts.
 * Enforces zero-cloud air-gapped local model execution contracts across:
 *   - Vision: Qwen 2.5 VL 3B 4-bit (mlx_vlm.server on port 8082)
 *   - Coding: Qwen 2.5 Coder 3B 4-bit (mlx_lm.server on port 8081)
 *   - Inspection: Gemma 2 2B 4-bit (mlx_lm.server on port 8080)
 */

function getEnvUrl(primaryEnv, fallbackEnvs = [], defaultUrl) {
    if (process.env[primaryEnv]) return process.env[primaryEnv].trim().replace(/\/$/, "");
    for (const fb of fallbackEnvs) {
        if (process.env[fb]) return process.env[fb].trim().replace(/\/$/, "");
    }
    return defaultUrl;
}

function getEnvInt(envVar, fallbackEnvs = [], defaultVal) {
    if (process.env[envVar]) {
        const val = parseInt(process.env[envVar], 10);
        if (Number.isFinite(val) && val > 0) return val;
    }
    for (const fb of fallbackEnvs) {
        if (process.env[fb]) {
            const val = parseInt(process.env[fb], 10);
            if (Number.isFinite(val) && val > 0) return val;
        }
    }
    return defaultVal;
}

export const MODEL_RUNTIME_CONFIG = Object.freeze({
    VISION: Object.freeze({
        task: "vision",
        model: process.env.VISION_MODEL || "qwen2.5-vl:3b-4bit",
        serverModel: process.env.QWEN_VL_SERVER_MODEL || "models/qwen2.5-vl-3b-4bit",
        runtime: process.env.VISION_RUNTIME || "mlx_vlm",
        url: getEnvUrl("VISION_MLX_URL", ["QWEN_VL_MLX_URL", "MLX_VISION_URL"], "http://host.docker.internal:8082"),
        endpoint: "/v1/chat/completions",
        healthEndpoint: "/health",
        modelsEndpoint: "/v1/models",
        timeoutMs: getEnvInt("VISION_TIMEOUT_MS", ["QWEN_VL_TIMEOUT_MS", "MLX_TIMEOUT_MS"], 120000),
    }),
    CODING: Object.freeze({
        task: "coding",
        model: process.env.CODING_MODEL || "qwen2.5-coder:3b-4bit",
        serverModel: process.env.QWEN_CODER_SERVER_MODEL || "default_model",
        runtime: process.env.CODING_RUNTIME || "mlx_lm",
        url: getEnvUrl("CODING_MLX_URL", ["QWEN_CODER_MLX_URL", "MLX_CODER_URL"], "http://host.docker.internal:8081"),
        endpoint: "/v1/chat/completions",
        healthEndpoint: "/health",
        modelsEndpoint: "/v1/models",
        timeoutMs: getEnvInt("CODING_TIMEOUT_MS", ["QWEN_TIMEOUT_MS", "MLX_TIMEOUT_MS"], 120000),
    }),
    INSPECTION: Object.freeze({
        task: "inspection",
        model: process.env.INSPECTION_MODEL || "gemma-2-2b-it-4bit",
        serverModel: process.env.GEMMA_SERVER_MODEL || "default_model",
        runtime: process.env.INSPECTION_RUNTIME || "mlx_lm",
        url: getEnvUrl("GEMMA_MLX_URL", ["MLX_URL", "INSPECTION_MLX_URL"], "http://host.docker.internal:8080"),
        endpoint: "/v1/chat/completions",
        healthEndpoint: "/health",
        modelsEndpoint: "/v1/models",
        timeoutMs: getEnvInt("GEMMA_MLX_TIMEOUT_MS", ["INSPECTION_TIMEOUT_MS", "MLX_TIMEOUT_MS"], 120000),
    }),
});

export default MODEL_RUNTIME_CONFIG;
