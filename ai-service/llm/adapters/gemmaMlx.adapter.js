/**
 * Gemma MLX Provider Adapter
 *
 * Implements the BaseAdapter contract for Gemma running on Apple Silicon
 * via native macOS MLX HTTP server (mlx_lm.server).
 */

import { BaseAdapter } from "./base.adapter.js";
import { MODEL_RUNTIME_CONFIG } from "../../config/modelRuntime.config.js";
import { logModelInference } from "../../utils/modelObservability.js";

let gemmaQueue = Promise.resolve();

function enqueueGemma(fn, options = {}) {
    const queueTimeoutMs = typeof options.queueTimeoutMs === "number"
        ? options.queueTimeoutMs
        : Math.max(options.timeoutMs || MODEL_RUNTIME_CONFIG.INSPECTION.timeoutMs, 180000);
    
    return new Promise((resolve, reject) => {
        let isTimeout = false;
        const timer = setTimeout(() => {
            isTimeout = true;
            const err = new Error(`Gemma MLX queue wait exceeded ${queueTimeoutMs}ms — server is busy with another request`);
            err.code = "TIMEOUT";
            err.statusCode = 503;
            reject(err);
        }, queueTimeoutMs);

        const next = gemmaQueue.then(async () => {
            if (isTimeout) return;
            clearTimeout(timer);
            try {
                resolve(await fn());
            } catch (err) {
                reject(err);
            }
        }, async () => {
            if (isTimeout) return;
            clearTimeout(timer);
            try {
                resolve(await fn());
            } catch (err) {
                reject(err);
            }
        });
        
        gemmaQueue = next.catch(() => {});
    });
}

export class GemmaMlxAdapter extends BaseAdapter {
    constructor(options = {}) {
        super("gemma_mlx");
        this.baseUrl = options.baseUrl || MODEL_RUNTIME_CONFIG.INSPECTION.url;
        this.defaultModel = options.defaultModel || MODEL_RUNTIME_CONFIG.INSPECTION.model;
    }

    getBaseUrl() {
        const url = this.baseUrl || MODEL_RUNTIME_CONFIG.INSPECTION.url;
        return url.trim().replace(/\/$/, "");
    }

    async _fetch(endpoint, init) {
        const baseUrl = this.getBaseUrl();
        try {
            return await fetch(`${baseUrl}${endpoint}`, init);
        } catch (err) {
            // If running outside Docker container directly on host, host.docker.internal may not resolve.
            // Fall back to 127.0.0.1 on the same port for local host test scripts and diagnostic runners.
            if (baseUrl.includes("host.docker.internal")) {
                try {
                    const fallbackUrl = baseUrl.replace("host.docker.internal", "127.0.0.1");
                    return await fetch(`${fallbackUrl}${endpoint}`, init);
                } catch {
                    // Ignore fallback failure and report primary error below
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
                const timeoutErr = new Error(`Gemma MLX request timed out: ${err.message}`);
                timeoutErr.code = "TIMEOUT";
                timeoutErr.statusCode = 504;
                throw timeoutErr;
            }

            const unavailErr = new Error(`Local Gemma MLX runtime unavailable at ${baseUrl}: ${err.message}`);
            unavailErr.code = "RUNTIME_UNAVAILABLE";
            unavailErr.statusCode = 503;
            throw unavailErr;
        }
    }

    async generate(prompt, model, options = {}) {
        return enqueueGemma(() => this._executeGenerate(prompt, model, options), options);
    }

    async _executeGenerate(prompt, model, options = {}) {
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

        const timeoutMs = typeof options.timeoutMs === "number"
            ? options.timeoutMs
            : MODEL_RUNTIME_CONFIG.INSPECTION.timeoutMs;
        const abortSignal = options.signal || AbortSignal.timeout(timeoutMs);

        const response = await this._fetch("/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: abortSignal,
        });

        if (!response.ok) {
            const responseText = await response.text().catch(() => "");
            const isNotFound = response.status === 404;
            const err = new Error(
                `Gemma MLX host runtime returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 240)}` : ""}`
            );
            err.code = isNotFound ? "MODEL_NOT_FOUND" : "RUNTIME_UNAVAILABLE";
            err.statusCode = response.status >= 500 || response.status === 404 ? 503 : response.status;
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

            let isDone = false;
            while (!isDone) {
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
                            isDone = true;
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
                const err = new Error("Gemma MLX returned a malformed streaming response (no generated content).");
                err.code = "MALFORMED_RESPONSE";
                err.statusCode = 502;
                throw err;
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

        let data;
        try {
            data = await response.json();
        } catch (cause) {
            const err = new Error("Gemma MLX returned malformed JSON.");
            err.code = "MALFORMED_RESPONSE";
            err.statusCode = 502;
            err.cause = cause;
            throw err;
        }
        const content = data?.choices?.[0]?.message?.content;

        if (typeof content !== "string" || !content.trim()) {
            const err = new Error("Gemma MLX returned a malformed completion response.");
            err.code = "MALFORMED_RESPONSE";
            err.statusCode = 502;
            throw err;
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

        logModelInference({
            requestId: options.requestId,
            task: taskName,
            model: model || this.defaultModel,
            runtime: "mlx",
            startedAt: new Date(startTime).toISOString(),
            durationMs,
            status: "SUCCESS",
        });

        let finalAnswer = content.trim();
        if (primaryDoc && finalAnswer.includes("Document_Name.pdf")) {
            finalAnswer = finalAnswer.replaceAll("Document_Name.pdf", primaryDoc);
        }
        return finalAnswer;
    }

    async checkHealth() {
        try {
            const res = await this._fetch("/health", {
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) return true;
            const modelsRes = await this._fetch("/v1/models", {
                signal: AbortSignal.timeout(3000),
            });
            return modelsRes.ok;
        } catch {
            return false;
        }
    }

    async listModels() {
        try {
            const res = await this._fetch("/v1/models", {
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
            const res = await this._fetch("/v1/chat/completions", {
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
