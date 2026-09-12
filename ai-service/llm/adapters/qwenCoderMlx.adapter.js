/**
 * Qwen2.5-Coder MLX Provider Adapter
 *
 * Implements the BaseAdapter contract for Qwen2.5-Coder running on Apple Silicon
 * via native macOS MLX HTTP server (mlx_lm.server on port 8081).
 */

import { BaseAdapter } from "./base.adapter.js";
import { MODEL_RUNTIME_CONFIG } from "../../config/modelRuntime.config.js";
import { logModelInference } from "../../utils/modelObservability.js";

export class QwenCoderMlxAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("qwen_coder_mlx");
        this.baseUrl = options.baseUrl || MODEL_RUNTIME_CONFIG.CODING.url;
        this.defaultModel = options.defaultModel || MODEL_RUNTIME_CONFIG.CODING.model;
        this.serverModel = options.serverModel || MODEL_RUNTIME_CONFIG.CODING.serverModel;
    }

    getBaseUrl() {
        const url = this.baseUrl || MODEL_RUNTIME_CONFIG.CODING.url;
        return url.trim().replace(/\/$/, "");
    }

    async _fetchWithDockerFallback(endpoint, init) {
        const primaryUrl = this.getBaseUrl();
        try {
            return await fetch(`${primaryUrl}${endpoint}`, init);
        } catch (err) {
            if (primaryUrl.includes("host.docker.internal")) {
                try {
                    const fallbackUrl = primaryUrl.replace("host.docker.internal", "127.0.0.1");
                    return await fetch(`${fallbackUrl}${endpoint}`, init);
                } catch {
                    // fall through to primary error handling
                }
            }

            const isTimeout =
                err.name === "TimeoutError" ||
                err.name === "AbortError" ||
                err.cause?.name === "TimeoutError" ||
                err.cause?.name === "AbortError" ||
                err.message?.includes("timed out") ||
                err.message?.includes("aborted");

            if (isTimeout) {
                const timeoutErr = new Error(`Qwen Coder MLX request timed out: ${err.message}`);
                timeoutErr.code = "TIMEOUT";
                timeoutErr.statusCode = 504;
                throw timeoutErr;
            }

            const unavailErr = new Error(`Local Qwen Coder MLX runtime unavailable at ${primaryUrl}: ${err.message}`);
            unavailErr.code = "RUNTIME_UNAVAILABLE";
            unavailErr.statusCode = 503;
            throw unavailErr;
        }
    }

    async generate(prompt, model, options = {}) {
        const isStreaming = typeof options.onChunk === "function" || options.stream === true;
        const taskName = options.task || "coding";
        const startTime = Date.now();
        const inputChars = typeof prompt === "string" ? prompt.length : 0;

        const maxTokens =
            typeof options.num_predict === "number"
                ? options.num_predict
                : typeof options.maxTokens === "number"
                ? options.maxTokens
                : 1024;

        const temperature =
            typeof options.temperature === "number"
                ? options.temperature
                : options.format === "json"
                ? 0.1
                : 0.2;

        const topP = typeof options.top_p === "number" ? options.top_p : 0.95;

        // mlx_lm.server binds locally loaded model to 'default_model' or model path
        const serverModel = model?.startsWith("/") ? model : (this.serverModel || "default_model");

        const requestBody = {
            model: serverModel,
            messages: [
                {
                    role: "user",
                    content: typeof prompt === "string" ? prompt.trim() : "",
                },
            ],
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            stream: isStreaming,
        };

        const timeoutMs =
            typeof options.timeoutMs === "number"
                ? options.timeoutMs
                : MODEL_RUNTIME_CONFIG.CODING.timeoutMs;
        const abortSignal = options.signal || AbortSignal.timeout(timeoutMs);

        const response = await this._fetchWithDockerFallback("/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        });

        if (!response.ok) {
            const isNotFound = response.status === 404;
            const err = new Error(
                isNotFound
                    ? "Model unavailable on Qwen MLX server"
                    : `Qwen MLX inference generation failed with status ${response.status}`
            );
            err.code = isNotFound ? "MODEL_NOT_FOUND" : "RUNTIME_UNAVAILABLE";
            err.statusCode = response.status;
            logModelInference({
                requestId: options.requestId,
                task: taskName,
                model: model || this.defaultModel,
                runtime: "mlx",
                startedAt: new Date(startTime).toISOString(),
                durationMs: Date.now() - startTime,
                status: "FAILED",
                errorCode: err.code,
            });
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
                    if (!trimmed || trimmed.startsWith(":")) continue;

                    if (trimmed.startsWith("data: ")) {
                        const dataStr = trimmed.slice(6).trim();
                        if (dataStr === "[DONE]") {
                            break;
                        }

                        try {
                            const parsed = JSON.parse(dataStr);
                            const token = parsed.choices?.[0]?.delta?.content;
                            if (token) {
                                fullText += token;
                                if (typeof options.onChunk === "function") {
                                    options.onChunk(token);
                                }
                            }
                        } catch {}
                    }
                }
            }

            if (buffer.trim().startsWith("data: ")) {
                const dataStr = buffer.trim().slice(6).trim();
                if (dataStr !== "[DONE]") {
                    try {
                        const parsed = JSON.parse(dataStr);
                        const token = parsed.choices?.[0]?.delta?.content;
                        if (token) {
                            fullText += token;
                            if (typeof options.onChunk === "function") {
                                options.onChunk(token);
                            }
                        }
                    } catch {}
                }
            }

            if (!fullText.trim()) {
                throw new Error("Qwen MLX generation produced empty stream response");
            }

            const durationMs = Date.now() - startTime;
            console.log(
                `[LLM:QwenCoderMLX] task=${taskName} model=${model} status=success ` +
                `input_chars=${inputChars} output_chars=${fullText.length} duration_ms=${durationMs}`
            );

            return fullText.trim();
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (typeof content !== "string" || !content.trim()) {
            throw new Error("Qwen MLX generation produced empty response");
        }

        const durationMs = Date.now() - startTime;
        const outputChars = content.length;
        const promptTokens = data?.usage?.prompt_tokens ?? "N/A";
        const evalTokens = data?.usage?.completion_tokens ?? "N/A";

        logModelInference({
            requestId: options.requestId,
            task: taskName,
            model: model || this.defaultModel,
            runtime: "mlx",
            startedAt: new Date(startTime).toISOString(),
            durationMs,
            status: "SUCCESS",
        });

        return content.trim();
    }

    async checkHealth() {
        try {
            const res = await this._fetchWithDockerFallback("/health", {
                signal: AbortSignal.timeout(3000),
            });
            return Boolean(res && res.ok);
        } catch {
            return false;
        }
    }

    async listModels() {
        try {
            const res = await this._fetchWithDockerFallback("/v1/models", {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.data)
                ? data.data.map((m) => ({ name: m.id || "qwen2.5-coder:3b-4bit" }))
                : [];
        } catch {
            return [];
        }
    }

    async warmModel(model) {
        const t0 = Date.now();
        try {
            const serverModel = model?.startsWith("/") ? model : "default_model";
            const res = await this._fetchWithDockerFallback("/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: serverModel,
                    messages: [{ role: "user", content: "def hello():" }],
                    max_tokens: 1,
                }),
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
