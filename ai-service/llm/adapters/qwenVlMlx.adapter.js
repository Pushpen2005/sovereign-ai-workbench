/**
 * Qwen2.5-VL MLX Provider Adapter
 *
 * Implements the BaseAdapter contract for Qwen2.5-VL multimodal vision running on Apple Silicon
 * via native macOS MLX-VLM HTTP server (mlx_vlm.server on port 8082).
 */

import { BaseAdapter } from "./base.adapter.js";
import { MODEL_RUNTIME_CONFIG } from "../../config/modelRuntime.config.js";
import { logModelInference } from "../../utils/modelObservability.js";

export class QwenVlMlxAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("qwen_vl_mlx");
        this.baseUrl = options.baseUrl || MODEL_RUNTIME_CONFIG.VISION.url;
        this.defaultModel = options.defaultModel || MODEL_RUNTIME_CONFIG.VISION.model;
        this.serverModel = options.serverModel || MODEL_RUNTIME_CONFIG.VISION.serverModel;
    }

    getBaseUrl() {
        const url = this.baseUrl || MODEL_RUNTIME_CONFIG.VISION.url;
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
                const timeoutErr = new Error(`Qwen VL MLX request timed out: ${err.message}`);
                timeoutErr.code = "TIMEOUT";
                timeoutErr.statusCode = 504;
                throw timeoutErr;
            }

            const unavailErr = new Error(`Local Qwen VL MLX runtime unavailable at ${primaryUrl}: ${err.message}`);
            unavailErr.code = "RUNTIME_UNAVAILABLE";
            unavailErr.statusCode = 503;
            throw unavailErr;
        }
    }

    async generate(prompt, model, options = {}) {
        const isStreaming = typeof options.onChunk === "function" || options.stream === true;
        const taskName = options.task || "vision";
        const startTime = Date.now();
        const inputChars = typeof prompt === "string" ? prompt.length : 0;

        const maxTokens =
            typeof options.num_predict === "number"
                ? options.num_predict
                : typeof options.maxTokens === "number"
                ? options.maxTokens
                : 512;

        const temperature =
            typeof options.temperature === "number"
                ? options.temperature
                : options.format === "json"
                ? 0.1
                : 0.2;

        const topP = typeof options.top_p === "number" ? options.top_p : 0.95;

        // Prepare multimodal content payload
        const contentParts = [
            {
                type: "text",
                text: typeof prompt === "string" ? prompt.trim() : "",
            },
        ];

        // Attach images if provided in options.images
        if (options.images && Array.isArray(options.images)) {
            for (const img of options.images) {
                if (typeof img === "string" && img.trim()) {
                    const cleanImg = img.trim();
                    const url = cleanImg.startsWith("data:")
                        ? cleanImg
                        : `data:image/png;base64,${cleanImg}`;
                    contentParts.push({
                        type: "image_url",
                        image_url: { url },
                    });
                }
            }
        }

        const requestBody = {
            model: this.serverModel,
            messages: [
                {
                    role: "user",
                    content: contentParts,
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
                : MODEL_RUNTIME_CONFIG.VISION.timeoutMs;
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
                    ? "Model unavailable on Qwen VL MLX server"
                    : `Qwen VL MLX inference generation failed with status ${response.status}`
            );
            err.code = isNotFound ? "MODEL_NOT_FOUND" : "RUNTIME_UNAVAILABLE";
            err.statusCode = response.status;
            logModelInference({
                requestId: options.requestId,
                task: taskName,
                model: model || this.defaultModel,
                runtime: "mlx_vlm",
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

            const durationMs = Date.now() - startTime;
            console.log(
                `[LLM:QwenVLMlx] task=${taskName} model=${model || this.defaultModel} (stream) status=success duration_ms=${durationMs} output_chars=${fullText.length}`
            );
            logModelInference({
                requestId: options.requestId,
                task: taskName,
                model: model || this.defaultModel,
                runtime: "mlx_vlm",
                startedAt: new Date(startTime).toISOString(),
                durationMs,
                status: "SUCCESS",
            });
            return fullText;
        }

        const data = await response.json();
        const output = data.choices?.[0]?.message?.content || "";
        const durationMs = Date.now() - startTime;

        logModelInference({
            requestId: options.requestId,
            task: taskName,
            model: model || this.defaultModel,
            runtime: "mlx_vlm",
            startedAt: new Date(startTime).toISOString(),
            durationMs,
            status: "SUCCESS",
        });

        return output;
    }

    async checkHealth() {
        const url = this.getBaseUrl();
        try {
            const res = await this._fetchWithDockerFallback("/health", {
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) {
                return {
                    healthy: true,
                    status: res.status,
                    provider: "qwen_vl_mlx",
                    url,
                };
            }
            return {
                healthy: false,
                status: res.status,
                provider: "qwen_vl_mlx",
                url,
            };
        } catch (err) {
            return {
                healthy: false,
                status: "UNREACHABLE",
                error: err.message,
                provider: "qwen_vl_mlx",
                url,
            };
        }
    }

    async listModels() {
        try {
            const res = await this._fetchWithDockerFallback("/v1/models", {
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok) return [];
            const data = await res.json();
            return data.data?.map((m) => m.id) || [];
        } catch {
            return [];
        }
    }

    async warmModel(model = this.defaultModel) {
        const t0 = Date.now();
        try {
            await this.generate("Warmup test", model, { maxTokens: 5, timeoutMs: 15000 });
            return {
                model,
                success: true,
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
