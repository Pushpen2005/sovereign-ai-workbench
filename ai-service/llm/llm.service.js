import { isModelAllowed } from "../router/modelRouter.js";

const OLLAMA_URL = process.env.OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

class LLMError extends Error {
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

async function generateAnswer(prompt, modelOrOptions, maybeOptions = {}) {
    // Validate prompt
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
    } else if ((modelOrOptions === undefined || modelOrOptions === null) && maybeOptions && typeof maybeOptions === "object") {
        options = maybeOptions;
        model = options.model;
    }

    // Validate model override
    if (model !== undefined && model !== null) {
        if (typeof model !== "string") {
            throw new LLMError("Model must be a string");
        }

        if (!model.trim()) {
            throw new LLMError("Model cannot be empty");
        }
    }

    const ollamaUrl = process.env.OLLAMA_URL || OLLAMA_URL;
    const ollamaModel = process.env.OLLAMA_MODEL || OLLAMA_MODEL;

    // Validate environment configuration
    if (!ollamaUrl) {
        throw new LLMError("OLLAMA_URL is not configured");
    }

    if (!ollamaModel) {
        throw new LLMError("OLLAMA_MODEL is not configured");
    }

    const selectedModel = model?.trim() || ollamaModel;

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
    const keepAlive = options.keep_alive || process.env.OLLAMA_KEEP_ALIVE || "30m";
    const isStreaming = typeof options.onChunk === "function" || options.stream === true;
    const taskName = options.task || "general";
    const startTime = Date.now();
    const inputChars = prompt.length;

    const requestBody = {
        model: selectedModel,
        prompt: prompt.trim(),
        stream: isStreaming,
        keep_alive: keepAlive,
    };

    if (options.format) {
        requestBody.format = options.format;
    }

    if (Array.isArray(options.images) && options.images.length > 0) {
        requestBody.images = options.images;
    }

    // Configure low-variance, deterministic parameters for structured/JSON tasks
    const ollamaOptions = {};
    if (typeof options.temperature === "number") {
        ollamaOptions.temperature = options.temperature;
    } else if (options.format === "json") {
        ollamaOptions.temperature = 0.1;
    }

    if (typeof options.top_p === "number") {
        ollamaOptions.top_p = options.top_p;
    }

    if (typeof options.num_predict === "number") {
        ollamaOptions.num_predict = options.num_predict;
    } else if (typeof options.maxTokens === "number") {
        ollamaOptions.num_predict = options.maxTokens;
    }

    if (Object.keys(ollamaOptions).length > 0) {
        requestBody.options = ollamaOptions;
    }

    try {
        const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 60000;
        const abortSignal = options.signal || AbortSignal.timeout(timeoutMs);

        let response;
        try {
            response = await fetch(`${ollamaUrl}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
                signal: abortSignal,
            });
        } catch (fetchErr) {
            if (ollamaUrl.includes("host.docker.internal")) {
                const fallbackUrl = ollamaUrl.replace("host.docker.internal", "127.0.0.1");
                response = await fetch(`${fallbackUrl}/api/generate`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                    signal: abortSignal,
                });
            } else {
                throw fetchErr;
            }
        }

        if (!response.ok) {
            if (response.status === 404) {
                throw new LLMError("Model unavailable");
            }

            throw new LLMError("LLM generation failed");
        }

        if (isStreaming && response.body) {
            let fullText = "";
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.response) {
                            fullText += parsed.response;
                            if (typeof options.onChunk === "function") {
                                options.onChunk(parsed.response);
                            }
                        }
                    } catch {}
                }
            }

            if (buffer.trim()) {
                try {
                    const parsed = JSON.parse(buffer.trim());
                    if (parsed.response) {
                        fullText += parsed.response;
                        if (typeof options.onChunk === "function") {
                            options.onChunk(parsed.response);
                        }
                    }
                } catch {}
            }

            if (!fullText.trim()) {
                throw new LLMError("LLM generation produced empty stream response");
            }

            const durationMs = Date.now() - startTime;
            console.log(
                `[LLM] task=${taskName} model=${selectedModel} status=success ` +
                `input_chars=${inputChars} output_chars=${fullText.length} duration_ms=${durationMs}`
            );

            return fullText.trim();
        }

        const data = await response.json();

        if (
            !data ||
            typeof data.response !== "string" ||
            !data.response.trim()
        ) {
            throw new LLMError("LLM generation failed");
        }

        const durationMs = Date.now() - startTime;
        const outputChars = data.response.length;
        const promptTokens = data.prompt_eval_count ?? "N/A";
        const evalTokens = data.eval_count ?? "N/A";
        const loadDurationMs = data.load_duration ? Math.round(data.load_duration / 1e6) : "N/A";

        console.log(
            `[LLM] task=${taskName} model=${selectedModel} status=success ` +
            `input_chars=${inputChars} output_chars=${outputChars} ` +
            `prompt_tokens=${promptTokens} eval_tokens=${evalTokens} ` +
            `load_ms=${loadDurationMs} duration_ms=${durationMs}`
        );

        return data.response.trim();

    } catch (error) {
        const durationMs = Date.now() - startTime;
        console.error(
            `[LLM] task=${taskName} model=${selectedModel} status=failure ` +
            `input_chars=${inputChars} duration_ms=${durationMs} error=${error.message}`
        );

        if (error instanceof LLMError) {
            throw error;
        }

        if (error.name === "TimeoutError" || error.message?.includes("timed out") || error.message?.includes("The operation was aborted")) {
            throw new LLMError("Inference timed out", { cause: error, code: "TIMEOUT", statusCode: 408 });
        }

        if (error instanceof TypeError) {
            throw new LLMError(
                "Ollama connection failed",
                { cause: error }
            );
        }

        throw new LLMError(
            "LLM generation failed",
            { cause: error }
        );
    }
}

async function generateVisionAnswer(prompt, images, model, options = {}) {
    const imageList = Array.isArray(images) ? images : [images];
    return generateAnswer(prompt, model, {
        ...options,
        images: imageList.filter(Boolean),
    });
}

/**
 * Pre-warms local Ollama models into memory without token generation.
 *
 * @param {string[]} [models]
 * @returns {Promise<Array<{ model: string, success: boolean, durationMs: number }>>}
 */
async function warmLocalModels(models = ["llama3.2:3b", "moondream"]) {
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "15m";
    const results = [];

    for (const model of models) {
        const t0 = Date.now();
        try {
            const res = await fetch(`${ollamaUrl}/api/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model, prompt: "", keep_alive: keepAlive }),
            });
            results.push({
                model,
                success: res.ok,
                durationMs: Date.now() - t0,
            });
        } catch (err) {
            results.push({
                model,
                success: false,
                durationMs: Date.now() - t0,
                error: err.message,
            });
        }
    }
    return results;
}

export {
    generateAnswer,
    generateVisionAnswer,
    warmLocalModels,
    LLMError,
};


