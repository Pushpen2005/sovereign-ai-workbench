const OLLAMA_URL = process.env.OLLAMA_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

class LLMError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "LLMError";
    }
}

async function generateAnswer(prompt, model) {
    // Validate prompt
    if (typeof prompt !== "string") {
        throw new LLMError("Prompt must be a string");
    }

    if (!prompt.trim()) {
        throw new LLMError("Prompt cannot be empty");
    }

    // Validate model override
    if (model !== undefined) {
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

    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: selectedModel,
                prompt: prompt.trim(),
                stream: false,
            }),
        });

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

export {
    generateAnswer,
};


