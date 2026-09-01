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

    const requestBody = {
        model: selectedModel,
        prompt: prompt.trim(),
        stream: false,
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

export {
    generateAnswer,
    generateVisionAnswer,
    LLMError,
};


