/**
 * Model Inference Observability Helper (Backend)
 *
 * Logs standardized metrics for local inference requests without exposing
 * sensitive payloads, confidential documents, or image data.
 */

export function logModelInference({
    requestId = null,
    task = "unknown",
    model = "unknown",
    runtime = "mlx",
    startedAt,
    completedAt = new Date().toISOString(),
    durationMs,
    status = "SUCCESS",
    errorCode = null,
} = {}) {
    const calculatedDuration = durationMs !== undefined && durationMs !== null
        ? durationMs
        : (startedAt ? Date.now() - new Date(startedAt).getTime() : 0);

    const logParts = [
        `[MODEL_INFERENCE]`,
        requestId ? `requestId=${requestId}` : null,
        `task=${task}`,
        `model=${model}`,
        `runtime=${runtime}`,
        startedAt ? `startedAt=${startedAt}` : null,
        `completedAt=${completedAt}`,
        `durationMs=${calculatedDuration}`,
        `status=${status}`,
        errorCode ? `errorCode=${errorCode}` : null,
    ].filter(Boolean);

    console.log(logParts.join(" "));
}

export default logModelInference;
