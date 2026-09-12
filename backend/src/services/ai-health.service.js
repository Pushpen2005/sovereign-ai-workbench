/**
 * Unified AI Health Service
 *
 * Performs real-time runtime health checks across all three local model servers:
 *   - Vision: Qwen 2.5 VL (mlx_vlm on port 8082)
 *   - Coding: Qwen 2.5 Coder (mlx_lm on port 8081)
 *   - Inspection: Gemma 2 2B (mlx_lm on port 8080)
 *
 * Invariant: Never hardcodes "online", zero cloud fallbacks, zero document data sent.
 */

import { MODEL_RUNTIME_CONFIG } from "../config/modelRuntime.config.js";

async function probeRuntime(config) {
    const primaryUrl = config.url.replace(/\/$/, "");
    const healthPath = config.healthEndpoint || "/health";
    const modelsPath = config.modelsEndpoint || "/v1/models";

    const urlsToTry = [primaryUrl];
    if (primaryUrl.includes("host.docker.internal")) {
        urlsToTry.push(primaryUrl.replace("host.docker.internal", "127.0.0.1"));
    } else if (primaryUrl.includes("127.0.0.1")) {
        urlsToTry.push(primaryUrl.replace("127.0.0.1", "host.docker.internal"));
    }

    let lastError = null;
    let lastStatus = null;

    for (const baseUrl of urlsToTry) {
        try {
            // Probe /health first
            const res = await fetch(`${baseUrl}${healthPath}`, {
                signal: AbortSignal.timeout(2500),
            });

            if (res.ok) {
                return {
                    model: config.model,
                    runtime: config.runtime,
                    reachable: true,
                    status: "ready",
                };
            }

            // If /health returns 404, probe /v1/models as alternate standard endpoint
            if (res.status === 404) {
                try {
                    const mRes = await fetch(`${baseUrl}${modelsPath}`, {
                        signal: AbortSignal.timeout(2500),
                    });
                    if (mRes.ok) {
                        return {
                            model: config.model,
                            runtime: config.runtime,
                            reachable: true,
                            status: "ready",
                        };
                    }
                    lastStatus = mRes.status;
                } catch (mErr) {
                    lastError = mErr;
                }
            } else {
                lastStatus = res.status;
            }
        } catch (err) {
            lastError = err;
        }
    }

    // Determine failure classification
    if (lastStatus === 404) {
        return {
            model: config.model,
            runtime: config.runtime,
            reachable: false,
            status: "model_not_found",
        };
    }

    if (
        lastError &&
        (lastError.name === "TimeoutError" ||
            lastError.name === "AbortError" ||
            lastError.code === "TIMEOUT" ||
            lastError.message?.includes("timed out"))
    ) {
        return {
            model: config.model,
            runtime: config.runtime,
            reachable: false,
            status: "timeout",
        };
    }

    if (
        !lastStatus &&
        (lastError instanceof TypeError ||
            lastError?.code === "ECONNREFUSED" ||
            lastError?.message?.includes("fetch failed"))
    ) {
        return {
            model: config.model,
            runtime: config.runtime,
            reachable: false,
            status: "unavailable",
        };
    }

    return {
        model: config.model,
        runtime: config.runtime,
        reachable: false,
        status: "error",
    };
}

export async function checkAllAiHealth() {
    const [vision, coding, inspection] = await Promise.all([
        probeRuntime(MODEL_RUNTIME_CONFIG.VISION),
        probeRuntime(MODEL_RUNTIME_CONFIG.CODING),
        probeRuntime(MODEL_RUNTIME_CONFIG.INSPECTION),
    ]);

    return {
        vision,
        coding,
        inspection,
    };
}

export default checkAllAiHealth;
