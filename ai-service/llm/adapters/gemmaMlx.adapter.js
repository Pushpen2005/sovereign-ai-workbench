/**
 * Gemma MLX Provider Adapter
 *
 * Implements the BaseAdapter contract for Gemma running on Apple Silicon
 * via native macOS MLX HTTP server (mlx_lm.server).
 */

import { BaseAdapter } from "./base.adapter.js";

export class GemmaMlxAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("mlx");
        this.baseUrl = options.baseUrl || process.env.MLX_URL || "http://127.0.0.1:8080";
        this.defaultModel = options.defaultModel || process.env.MLX_MODEL || "gemma-2-2b-it-4bit";
    }

    getBaseUrl() {
        return process.env.MLX_URL || this.baseUrl;
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
        const taskName = options.task || "general";
        const startTime = Date.now();
        const inputChars = prompt.length;

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
                : 0.0;

        const topP = typeof options.top_p === "number" ? options.top_p : 1.0;

        // mlx_lm.server binds the locally loaded model to 'default_model' or its absolute path.
        // Using 'default_model' ensures zero external network lookups and routes to local memory.
        const serverModel = model?.startsWith("/") ? model : "default_model";

        // Prompt adaptation: Gemma 2B requires the actual document name in citation examples
        // rather than generic placeholders (e.g. Document_Name.pdf) to prevent echo hallucinations.
        let adaptedPrompt = prompt.trim();
        const docMatch = adaptedPrompt.match(/Document:\s*([a-zA-Z0-9_\-\.]+\.pdf)/i);
        const primaryDoc = docMatch ? docMatch[1] : null;
        if (primaryDoc && adaptedPrompt.includes("Document_Name.pdf")) {
            adaptedPrompt = adaptedPrompt.replaceAll("Document_Name.pdf", primaryDoc);
        }

        const requestBody = {
            model: serverModel,
            messages: [
                {
                    role: "user",
                    content: adaptedPrompt,
                },
            ],
            max_tokens: maxTokens,
            temperature,
            top_p: topP,
            stream: isStreaming,
        };

        const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : Number(process.env.MLX_TIMEOUT_MS || 120000);
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
                    ? "Model unavailable on MLX server"
                    : `MLX inference generation failed with status ${response.status}`
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
                    if (!trimmed || trimmed.startsWith(":")) continue; // Skip comments/keepalives

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
                throw new Error("MLX generation produced empty stream response");
            }

            const durationMs = Date.now() - startTime;
            console.log(
                `[LLM:GemmaMLX] task=${taskName} model=${model} status=success ` +
                `input_chars=${inputChars} output_chars=${fullText.length} duration_ms=${durationMs}`
            );

            let resultText = fullText.trim();
            if (primaryDoc && resultText.includes("Document_Name.pdf")) {
                resultText = resultText.replaceAll("Document_Name.pdf", primaryDoc);
            }
            return resultText;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;

        if (typeof content !== "string" || !content.trim()) {
            throw new Error("MLX generation produced empty response");
        }

        const durationMs = Date.now() - startTime;
        const outputChars = content.length;
        const promptTokens = data?.usage?.prompt_tokens ?? "N/A";
        const evalTokens = data?.usage?.completion_tokens ?? "N/A";

        console.log(
            `[LLM:GemmaMLX] task=${taskName} model=${model} status=success ` +
            `input_chars=${inputChars} output_chars=${outputChars} ` +
            `prompt_tokens=${promptTokens} eval_tokens=${evalTokens} duration_ms=${durationMs}`
        );

        let finalAnswer = content.trim();
        if (primaryDoc && finalAnswer.includes("Document_Name.pdf")) {
            finalAnswer = finalAnswer.replaceAll("Document_Name.pdf", primaryDoc);
        }
        return finalAnswer;
    }

    async checkHealth() {
        try {
            const res = await this._fetchWithDockerFallback("/health", {
                signal: AbortSignal.timeout(3000),
            });
            return res.ok;
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
                ? data.data.map((m) => ({ name: m.id || "gemma-2-2b-it-4bit" }))
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
                    messages: [{ role: "user", content: "hi" }],
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
