/**
 * Qwen2.5-VL MLX Provider Adapter
 *
 * Implements the BaseAdapter contract for Qwen2.5-VL multimodal vision running on Apple Silicon
 * via native macOS MLX-VLM HTTP server (mlx_vlm.server on port 8082).
 */

import { BaseAdapter } from "./base.adapter.js";

export class QwenVlMlxAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("qwen_vl_mlx");
        this.baseUrl =
            options.baseUrl ||
            process.env.QWEN_VL_MLX_URL ||
            process.env.MLX_VISION_URL ||
            "http://127.0.0.1:8082";
        this.defaultModel =
            options.defaultModel ||
            process.env.QWEN_VL_MODEL ||
            "qwen2.5-vl:3b-4bit";
        this.serverModel =
            options.serverModel ||
            process.env.QWEN_VL_SERVER_MODEL ||
            "models/qwen2.5-vl-3b-4bit";
    }

    getBaseUrl() {
        return (
            this.baseUrl ||
            process.env.QWEN_VL_MLX_URL ||
            process.env.MLX_VISION_URL ||
            "http://127.0.0.1:8082"
        );
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
                : Number(process.env.QWEN_VL_TIMEOUT_MS || process.env.MLX_TIMEOUT_MS || 60000);
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
            const err = new Error(
                response.status === 404
                    ? "Model unavailable on Qwen VL MLX server"
                    : `Qwen VL MLX inference generation failed with status ${response.status}`
            );
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
            return fullText;
        }

        const data = await response.json();
        const output = data.choices?.[0]?.message?.content || "";
        const durationMs = Date.now() - startTime;

        console.log(
            `[LLM:QwenVLMlx] task=${taskName} model=${model || this.defaultModel} status=success duration_ms=${durationMs} input_chars=${inputChars} output_chars=${output.length} images=${options.images?.length || 0}`
        );

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
