const OLLAMA_URL = process.env.OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

class LLMError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "LLMError";
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
    const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "15m";
    const isStreaming = typeof options.onChunk === "function" || options.stream === true;

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

    try {
        let response;
        try {
            response = await fetch(`${ollamaUrl}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
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

        return data.response.trim();

    } catch (error) {
        if (error instanceof LLMError) {
            throw error;
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


