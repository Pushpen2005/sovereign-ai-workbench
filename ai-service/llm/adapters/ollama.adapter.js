/**
 * Ollama Provider Adapter
 *
 * Implements the BaseAdapter contract for the local Ollama daemon.
 */

import { BaseAdapter } from "./base.adapter.js";

export class OllamaAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("ollama");
        this.baseUrl = options.baseUrl || process.env.OLLAMA_URL || "http://localhost:11434";
        this.defaultKeepAlive = options.keepAlive || process.env.OLLAMA_KEEP_ALIVE || "30m";
    }

    getBaseUrl() {
        return process.env.OLLAMA_URL || this.baseUrl;
    }

    async _fetchWithDockerFallback(endpoint, init) {
        const primaryUrl = this.getBaseUrl();
        try {
            return await fetch(`${primaryUrl}${endpoint}`, init);
        } catch (err) {
            if (primaryUrl.includes("host.docker.internal")) {
                const fallbackUrl = primaryUrl.replace("host.docker.internal", "127.0.0.1");
                return await fetch(`${fallbackUrl}${endpoint}`, init);
            }
            throw err;
        }
    }

    async generate(prompt, model, options = {}) {
        const isStreaming = typeof options.onChunk === "function" || options.stream === true;
        const keepAlive = options.keep_alive || this.defaultKeepAlive;
        const taskName = options.task || "general";
        const startTime = Date.now();
        const inputChars = prompt.length;

        const requestBody = {
            model,
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

        const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 60000;
        const abortSignal = options.signal || AbortSignal.timeout(timeoutMs);

        const response = await this._fetchWithDockerFallback("/api/generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        });

        if (!response.ok) {
            const err = new Error(response.status === 404 ? "Model unavailable" : "LLM generation failed");
            err.statusCode = response.status;
            throw err;
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
                throw new Error("LLM generation produced empty stream response");
            }

            const durationMs = Date.now() - startTime;
            console.log(
                `[LLM:Ollama] task=${taskName} model=${model} status=success ` +
                `input_chars=${inputChars} output_chars=${fullText.length} duration_ms=${durationMs}`
            );

            return fullText.trim();
        }

        const data = await response.json();
        if (!data || typeof data.response !== "string" || !data.response.trim()) {
            throw new Error("LLM generation failed");
        }

        const durationMs = Date.now() - startTime;
        const outputChars = data.response.length;
        const promptTokens = data.prompt_eval_count ?? "N/A";
        const evalTokens = data.eval_count ?? "N/A";
        const loadDurationMs = data.load_duration ? Math.round(data.load_duration / 1e6) : "N/A";

        console.log(
            `[LLM:Ollama] task=${taskName} model=${model} status=success ` +
            `input_chars=${inputChars} output_chars=${outputChars} ` +
            `prompt_tokens=${promptTokens} eval_tokens=${evalTokens} ` +
            `load_ms=${loadDurationMs} duration_ms=${durationMs}`
        );

        return data.response.trim();
    }

    async checkHealth() {
        try {
            const res = await this._fetchWithDockerFallback("/api/tags", {
                signal: AbortSignal.timeout(3000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    async listModels() {
        try {
            const res = await this._fetchWithDockerFallback("/api/tags", {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.models)
                ? data.models.map((m) => ({ name: m.name, size: m.size }))
                : [];
        } catch {
            return [];
        }
    }

    async warmModel(model) {
        const t0 = Date.now();
        const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "15m";
        try {
            const res = await this._fetchWithDockerFallback("/api/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model, prompt: "", keep_alive: keepAlive }),
                signal: AbortSignal.timeout(10000),
            });
            return {
                model,
                success: res.ok,
                durationMs: Date.now() - t0,
            };
        } catch (err) {
            return {
                model,
                success: false,
                durationMs: Date.now() - t0,
                error: err.message,
            };
        }
    }
}
