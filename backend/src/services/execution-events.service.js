/**
 * Execution Events Service (Server-Sent Events Observability Layer)
 *
 * Provides a decoupled, lightweight in-process pub/sub event broker for streaming
 * real-time LangGraph execution progress to connected clients.
 *
 * Guarantees:
 * - Run-scoped Channels: Subscribers to Run A never receive events from Run B
 * - Race Condition Resilience: Buffers recent events per runId so late-connecting
 *   SSE clients receive the complete historical timeline
 * - Event Data Security: Strips secrets, raw binary buffers, and internal tokens
 * - Non-blocking Execution: Slow or failing SSE clients never abort or block LangGraph
 * - Clean Disconnect Handling: Heartbeat timers and listeners are cleaned up on close
 */

import { EventEmitter } from "events";

const BUFFER_MAX_EVENTS_PER_RUN = 100;
const BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

class ExecutionEventsManager {
    constructor() {
        this.subscribers = new Map(); // Map<runId, Set<res>>
        this.eventHistory = new Map(); // Map<runId, Array<{ id, event, data, timestamp }>>
        this.runOwners = new Map(); // Map<runId, { organizationId, workflowType, createdAt }>
        this.ttlTimers = new Map(); // Map<runId, Timeout>
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100);
    }

    /**
     * Registers tenant ownership for a runId.
     *
     * @param {string} runId
     * @param {string} organizationId
     * @param {string} [workflowType="agent"]
     */
    registerRunOwner(runId, organizationId, workflowType = "agent") {
        if (!runId || !organizationId) return;
        this.runOwners.set(runId, {
            organizationId,
            workflowType,
            createdAt: Date.now(),
        });
    }

    /**
     * Retrieves tenant ownership for a runId.
     *
     * @param {string} runId
     * @returns {{ organizationId: string, workflowType: string, createdAt: number }|null}
     */
    getRunOwner(runId) {
        if (!runId) return null;
        return this.runOwners.get(runId) || null;
    }

    /**
     * Sanitizes data payload to prevent secret leakage or raw binary flooding over SSE.
     *
     * @param {object} data
     * @returns {object} Safe serializable metadata
     */
    sanitizePayload(data) {
        if (!data || typeof data !== "object") {
            return data;
        }

        const safe = {};
        for (const [k, v] of Object.entries(data)) {
            // Strip private secrets and credentials
            if (/password|secret|token|key|credential|hash|authorization/i.test(k)) {
                safe[k] = "[REDACTED]";
                continue;
            }

            // Strip raw buffers or huge base64 strings
            if (typeof v === "string" && v.length > 2000 && !/^(https?:\/\/|\/)/.test(v)) {
                safe[k] = `${v.slice(0, 500)}... [truncated ${v.length} chars]`;
                continue;
            }

            if (Buffer.isBuffer(v)) {
                safe[k] = `<Buffer of ${v.length} bytes>`;
                continue;
            }

            if (v && typeof v === "object" && !Array.isArray(v)) {
                safe[k] = this.sanitizePayload(v);
            } else if (Array.isArray(v)) {
                safe[k] = v.slice(0, 50).map((item) => (typeof item === "object" ? this.sanitizePayload(item) : item));
            } else {
                safe[k] = v;
            }
        }
        return safe;
    }

    /**
     * Publishes an SSE event for a specific runId.
     *
     * @param {string} runId Execution run identifier
     * @param {string} event Event type (e.g. 'node_started', 'tool_completed')
     * @param {object} payload Event data
     * @param {string|number} [id] Optional explicit event sequence ID
     */
    publish(runId, event, payload = {}, id = null) {
        if (!runId) return;

        const safeData = this.sanitizePayload(payload);
        const eventRecord = {
            id: id ?? `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            event,
            data: safeData,
            timestamp: Date.now(),
        };

        // 1. Store in bounded historical buffer for replay to late subscribers
        if (!this.eventHistory.has(runId)) {
            this.eventHistory.set(runId, []);
        }
        const history = this.eventHistory.get(runId);
        history.push(eventRecord);
        if (history.length > BUFFER_MAX_EVENTS_PER_RUN) {
            history.shift();
        }

        // Reset buffer TTL cleanup timer
        if (this.ttlTimers.has(runId)) {
            clearTimeout(this.ttlTimers.get(runId));
        }
        this.ttlTimers.set(
            runId,
            setTimeout(() => {
                this.eventHistory.delete(runId);
                this.ttlTimers.delete(runId);
            }, BUFFER_TTL_MS)
        );

        // 2. Dispatch to live active subscribers
        const clientSet = this.subscribers.get(runId);
        if (clientSet && clientSet.size > 0) {
            const sseChunk = `id: ${eventRecord.id}\nevent: ${event}\ndata: ${JSON.stringify(safeData)}\n\n`;
            for (const res of clientSet) {
                try {
                    res.write(sseChunk);
                } catch (writeErr) {
                    // Client socket error; silently clean up client
                    this.removeSubscriber(runId, res);
                }
            }
        }

        this.emitter.emit(`event:${runId}`, eventRecord);

        // 3. If terminal event, close subscriber connections
        if (["run_completed", "run_failed", "run_stopped"].includes(event)) {
            setTimeout(() => {
                this.closeRunStream(runId);
            }, 100);
        }
    }

    /**
     * Subscribes an HTTP response to an SSE stream for a specific runId.
     * Replays historical events if the client connected after graph initiation.
     *
     * @param {string} runId
     * @param {object} req Express request
     * @param {object} res Express response
     * @param {object} [options]
     * @param {Array<object>} [options.persistedSteps] Optional persisted steps from PostgreSQL
     */
    subscribe(runId, req, res, options = {}) {
        // 1. Establish SSE HTTP headers
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        });
        res.flushHeaders?.();

        // 2. Send immediate initial connection confirmation event
        res.write(`event: connected\ndata: ${JSON.stringify({ runId, timestamp: Date.now() })}\n\n`);

        // 3. Register subscriber
        if (!this.subscribers.has(runId)) {
            this.subscribers.set(runId, new Set());
        }
        const clientSet = this.subscribers.get(runId);
        clientSet.add(res);

        // 4. Send lightweight periodic heartbeat comments to prevent socket timeout
        const heartbeatTimer = setInterval(() => {
            try {
                res.write(`: heartbeat\n\n`);
            } catch {
                clearInterval(heartbeatTimer);
                this.removeSubscriber(runId, res);
            }
        }, 15000);

        // 5. Clean up on client disconnect
        req.on("close", () => {
            clearInterval(heartbeatTimer);
            this.removeSubscriber(runId, res);
        });

        // 6. Replay historical buffered events to handle race conditions
        const history = this.eventHistory.get(runId) || [];
        const seenEventIds = new Set();
        const lastEventId = req?.headers?.["last-event-id"];
        let replaying = !lastEventId;

        for (const record of history) {
            if (!replaying) {
                if (record.id === lastEventId) {
                    replaying = true;
                }
                continue;
            }
            seenEventIds.add(record.id);
            res.write(`id: ${record.id}\nevent: ${record.event}\ndata: ${JSON.stringify(record.data)}\n\n`);
        }

        // If persisted steps from DB provided and history was empty (e.g. reconnect or cache flush), replay
        if (history.length === 0 && Array.isArray(options.persistedSteps)) {
            for (const step of options.persistedSteps) {
                const stepId = `step-${step.stepNumber}`;
                if (!seenEventIds.has(stepId)) {
                    seenEventIds.add(stepId);
                    const eventType = step.node === "execute_tool" ? "tool_completed" : "node_completed";
                    res.write(
                        `id: ${stepId}\nevent: ${eventType}\ndata: ${JSON.stringify(
                            this.sanitizePayload({
                                runId,
                                step: step.stepNumber,
                                node: step.node,
                                tool: step.toolName,
                                status: step.status,
                                durationMs: step.durationMs,
                                resultSummary: step.toolResultSummary,
                            })
                        )}\n\n`
                    );
                }
            }
        }
    }

    /**
     * Removes an active subscriber.
     *
     * @param {string} runId
     * @param {object} res
     */
    removeSubscriber(runId, res) {
        const clientSet = this.subscribers.get(runId);
        if (clientSet) {
            clientSet.delete(res);
            if (clientSet.size === 0) {
                this.subscribers.delete(runId);
            }
        }
    }

    /**
     * Closes all subscriber connections for a run when complete.
     *
     * @param {string} runId
     */
    closeRunStream(runId) {
        const clientSet = this.subscribers.get(runId);
        if (clientSet) {
            for (const res of clientSet) {
                try {
                    res.end();
                } catch {
                    // Ignore already closed sockets
                }
            }
            this.subscribers.delete(runId);
        }
    }

    /**
     * Returns count of active subscribers for a run (useful for diagnostics & tests).
     *
     * @param {string} runId
     * @returns {number}
     */
    getSubscriberCount(runId) {
        return this.subscribers.get(runId)?.size || 0;
    }

    /**
     * Returns copy of buffered event history for testing.
     *
     * @param {string} runId
     * @returns {Array<object>}
     */
    getBufferedEvents(runId) {
        return this.eventHistory.get(runId) || [];
    }
}

export const executionEvents = new ExecutionEventsManager();
export default executionEvents;
