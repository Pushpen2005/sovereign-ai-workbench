/**
 * Production AI Telemetry & Observability Service
 *
 * Lightweight, tenant-safe observability layer for recording AI executions,
 * tracking real-time latency percentiles (P50, P95), and emitting structured
 * audit logs without leaking secrets, private prompts, or tenant documents.
 */

const MAX_HISTORY_RECORDS = 500;

class TelemetryManager {
    constructor() {
        this.records = [];
        this.startTime = Date.now();
        this.countsByTask = {
            DOCUMENT_ANALYSIS: 0,
            INSPECTION: 0,
            CODING: 0,
            VISION: 0,
            GENERAL_CHAT: 0,
        };
        this.countsByModel = {};
    }

    /**
     * Sanitizes sensitive fields before logging or recording.
     * Never logs passwords, tokens, API keys, full prompts, or tenant documents.
     *
     * @param {object} data
     * @returns {object}
     */
    sanitizeRecord(data) {
        if (!data || typeof data !== "object") return {};

        const safe = {
            runId: data.runId || null,
            taskType: data.taskType || "UNKNOWN",
            selectedModel: data.selectedModel || "unknown",
            local: data.local ?? true,
            status: data.status || (data.success === false ? "failed" : "completed"),
            totalLatencyMs: Number(data.totalLatencyMs || data.latencyMs || data.durationMs || 0),
            modelLatencyMs: Number(data.modelLatencyMs || 0),
            retrievalLatencyMs: Number(data.retrievalLatencyMs || 0),
            timestamp: data.timestamp || new Date().toISOString(),
        };

        if (data.errorCode) {
            safe.errorCode = String(data.errorCode);
        }

        if (data.organizationId) {
            // Organization ID kept only for server-side tenancy verification
            safe.organizationId = String(data.organizationId);
        }

        return safe;
    }

    /**
     * Record an AI execution event and emit a structured JSON audit line.
     *
     * @param {object} event
     * @returns {object} Safe sanitized record
     */
    recordAiExecution(event) {
        const sanitized = this.sanitizeRecord(event);

        // Emit structured JSON telemetry log (machine-parseable)
        console.log(`[AI-TELEMETRY] ${JSON.stringify(sanitized)}`);

        // Bounded ring buffer
        this.records.push(sanitized);
        if (this.records.length > MAX_HISTORY_RECORDS) {
            this.records.shift();
        }

        // Aggregate counters
        if (sanitized.taskType && this.countsByTask[sanitized.taskType] !== undefined) {
            this.countsByTask[sanitized.taskType]++;
        }
        if (sanitized.selectedModel) {
            this.countsByModel[sanitized.selectedModel] = (this.countsByModel[sanitized.selectedModel] || 0) + 1;
        }

        return sanitized;
    }

    /**
     * Calculate percentile from an array of numbers.
     *
     * @param {number[]} values
     * @param {number} p (0 to 100)
     * @returns {number}
     */
    _percentile(values, p) {
        if (!values || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }

    /**
     * Returns aggregate technical performance summary.
     * Contains NO tenant data, document contents, or user queries.
     *
     * @returns {object}
     */
    getPerformanceSummary() {
        const total = this.records.length;
        const latencies = this.records.map((r) => r.totalLatencyMs).filter((n) => n > 0);
        const modelLatencies = this.records.map((r) => r.modelLatencyMs).filter((n) => n > 0);

        const p50 = this._percentile(latencies, 50);
        const p95 = this._percentile(latencies, 95);
        const avg = latencies.length > 0
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : 0;

        const p50Model = this._percentile(modelLatencies, 50);
        const p95Model = this._percentile(modelLatencies, 95);

        const successful = this.records.filter((r) => r.status === "completed").length;
        const failed = this.records.filter((r) => r.status === "failed").length;

        return {
            local: true,
            uptimeSeconds: Math.round((Date.now() - this.startTime) / 1000),
            totalExecutions: total,
            successCount: successful,
            failureCount: failed,
            overallLatencies: {
                p50Ms: p50,
                p95Ms: p95,
                avgMs: avg,
            },
            modelLatencies: {
                p50Ms: p50Model,
                p95Ms: p95Model,
            },
            tasksBreakdown: { ...this.countsByTask },
            modelsBreakdown: { ...this.countsByModel },
        };
    }

    /**
     * Reset telemetry buffer (for testing).
     */
    reset() {
        this.records = [];
        this.countsByTask = {
            DOCUMENT_ANALYSIS: 0,
            INSPECTION: 0,
            CODING: 0,
            VISION: 0,
            GENERAL_CHAT: 0,
        };
        this.countsByModel = {};
    }
}

export const telemetryService = new TelemetryManager();
export default telemetryService;
