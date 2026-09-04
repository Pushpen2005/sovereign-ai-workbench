/**
 * Autonomous Agent Orchestration Service (LangGraph Production Layer)
 *
 * Coordinates the multi-step tool-calling agent runtime through the
 * compiled LangGraph StateGraph, with persistent PostgreSQL observability
 * and real-time Server-Sent Events (SSE) streaming.
 *
 * Guarantees:
 * - Multi-tenant isolation: Preserves organizationId/userId throughout execution
 * - Tool Security: Whitelist validation before invocation
 * - Bounded Execution: Enforces step limits (maxSteps) and deadline (timeoutMs)
 * - Persistent Observability: Records run status and trace steps in PostgreSQL
 * - Real-time SSE Streaming: Dispatches operational node/tool events in real-time
 * - Non-blocking Observability: DB/SSE failures never abort or compromise AI workflow
 * - API Compatibility: Maps final state exactly to runAgentLoop() response contract
 */

import { randomUUID } from "crypto";
import { compiledAgentGraph } from "../orchestration/agent/index.js";
import { AgentRuntimeError } from "./agent.service.js";
import {
    createAgentRun,
    updateAgentRun,
    createAgentRunStep,
} from "../repositories/agent.repository.js";
import { executionEvents } from "./execution-events.service.js";
import { DEFAULT_ORGANIZATION_ID } from "../config/organization.js";

const DEFAULT_MAX_STEPS = 5;
const MAX_ALLOWED_STEPS = 6;
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Runs the LangGraph autonomous tool agent workflow with PostgreSQL persistence
 * and real-time SSE event publishing.
 *
 * @param {string|object} input Goal string or input parameter object
 * @param {object} [options] Execution options (maxSteps, timeoutMs, userId, organizationId, runId)
 * @returns {Promise<object>} Result conforming to the legacy runAgentLoop contract
 */
export async function runAgentWorkflow(input, options = {}) {
    let goal = "";
    let maxSteps = options.maxSteps;
    let timeoutMs = options.timeoutMs;
    let userId = options.userId;
    let organizationId = options.organizationId;
    let runId = options.runId;

    if (typeof input === "string") {
        goal = input;
    } else if (input && typeof input === "object") {
        goal = input.goal || "";
        maxSteps = maxSteps ?? input.maxSteps;
        timeoutMs = timeoutMs ?? input.timeoutMs;
        userId = userId ?? input.userId;
        organizationId = organizationId ?? input.organizationId;
        runId = input.runId || runId;
    }

    if (!goal || typeof goal !== "string" || !goal.trim()) {
        throw new AgentRuntimeError("goal must be a non-empty string");
    }

    const cleanGoal = goal.trim();
    const cleanRunId = runId || randomUUID();
    const cleanOrgId = organizationId || DEFAULT_ORGANIZATION_ID;
    const cleanMaxSteps = Math.min(
        Number.isInteger(maxSteps) && maxSteps > 0 ? maxSteps : DEFAULT_MAX_STEPS,
        MAX_ALLOWED_STEPS
    );
    const cleanTimeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();

    // 1. Register tenant ownership for run
    try {
        executionEvents.registerRunOwner(cleanRunId, cleanOrgId, "agent");
    } catch {
        // Non-blocking
    }

    // 2. Persist initial agent run in PostgreSQL (Observability)
    try {
        await createAgentRun({
            runId: cleanRunId,
            userId: userId || null,
            organizationId: cleanOrgId,
            goal: cleanGoal,
            status: "in_progress",
            startedAt: new Date(startTime),
        });
    } catch (dbErr) {
        console.warn("[AgentOrchestrator] Warning: Failed to persist agent run initiation:", dbErr.message);
    }

    // 3. Publish run_started SSE event
    try {
        executionEvents.publish(cleanRunId, "run_started", {
            runId: cleanRunId,
            engine: "langgraph",
            status: "in_progress",
            goal: cleanGoal,
            model: "llama3.2:3b",
            maxSteps: cleanMaxSteps,
        });
    } catch (sseErr) {
        console.warn("[AgentOrchestrator] Warning: Failed to publish run_started event:", sseErr.message);
    }

    const initialState = {
        runId: cleanRunId,
        userId: userId || null,
        organizationId: cleanOrgId,
        goal: cleanGoal,
        maxSteps: cleanMaxSteps,
        timeoutMs: cleanTimeoutMs,
        startTime,
        currentStep: 0,
        metadata: {
            ...options.metadata,
        },
    };

    // 4. Stream compiled LangGraph StateGraph snapshots in real-time
    let finalState = { ...initialState };
    let executionError = null;
    let currentStepNum = 0;
    let lastHandledNode = null;

    try {
        for await (const stateSnapshot of await compiledAgentGraph.stream(initialState, { streamMode: "values" })) {
            finalState = stateSnapshot;
            const nodeName = stateSnapshot.currentNode;

            if (nodeName && nodeName !== lastHandledNode) {
                lastHandledNode = nodeName;

                try {
                    if (nodeName === "initialize") {
                        executionEvents.publish(cleanRunId, "node_started", { runId: cleanRunId, node: "initialize", step: 0 });
                        executionEvents.publish(cleanRunId, "node_completed", { runId: cleanRunId, node: "initialize", step: 0 });
                    } else if (nodeName === "reason") {
                        currentStepNum = stateSnapshot.currentStep || currentStepNum + 1;
                        executionEvents.publish(cleanRunId, "node_started", { runId: cleanRunId, node: "reason", step: currentStepNum });
                        executionEvents.publish(cleanRunId, "node_completed", {
                            runId: cleanRunId,
                            node: "reason",
                            step: currentStepNum,
                            actionType: stateSnapshot.action?.type,
                        });

                        if (stateSnapshot.action?.type === "tool_call") {
                            executionEvents.publish(cleanRunId, "tool_started", {
                                runId: cleanRunId,
                                tool: stateSnapshot.action.tool,
                                step: currentStepNum,
                                arguments: stateSnapshot.action.arguments,
                            });
                        }
                    } else if (nodeName === "execute_tool") {
                        const lastTool = stateSnapshot.lastTool || {};
                        executionEvents.publish(cleanRunId, "tool_completed", {
                            runId: cleanRunId,
                            tool: lastTool.toolName,
                            status: lastTool.status || "completed",
                            durationMs: lastTool.durationMs || 0,
                            step: currentStepNum,
                        });
                        executionEvents.publish(cleanRunId, "node_completed", {
                            runId: cleanRunId,
                            node: "execute_tool",
                            step: currentStepNum,
                        });
                    } else if (nodeName === "validate_tool_result") {
                        executionEvents.publish(cleanRunId, "node_completed", {
                            runId: cleanRunId,
                            node: "validate_tool_result",
                            step: currentStepNum,
                        });
                    } else if (nodeName === "final_answer") {
                        executionEvents.publish(cleanRunId, "node_completed", {
                            runId: cleanRunId,
                            node: "final_answer",
                            step: currentStepNum,
                        });
                    } else if (nodeName === "safe_failure") {
                        executionEvents.publish(cleanRunId, "node_completed", {
                            runId: cleanRunId,
                            node: "safe_failure",
                            step: currentStepNum,
                        });
                        executionEvents.publish(cleanRunId, "run_stopped", {
                            runId: cleanRunId,
                            node: "safe_failure",
                            stoppedReason: stateSnapshot.stoppedReason || "safe_failure",
                        });
                    }
                } catch {
                    // Non-blocking SSE broadcast
                }
            }
        }
    } catch (err) {
        executionError = err;
    }

    const durationMs = Date.now() - startTime;

    // 5. Handle orchestration failure
    if (executionError) {
        try {
            await updateAgentRun(cleanRunId, cleanOrgId, {
                status: "failed",
                stoppedReason: "safe_failure",
                error: executionError.message,
                completedAt: new Date(),
                durationMs,
            });
        } catch (dbErr) {
            console.warn("[AgentOrchestrator] Warning: Failed to persist agent run failure:", dbErr.message);
        }

        try {
            executionEvents.publish(cleanRunId, "run_failed", {
                runId: cleanRunId,
                status: "failed",
                reason: executionError.message,
            });
        } catch {
            // Non-blocking
        }

        throw executionError;
    }

    // 6. Deduplicate collected sources
    const uniqueSources = [];
    const seen = new Set();
    for (const src of finalState.sources || []) {
        const key = `${src.filename}:${src.page}:${src.chunkIndex}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueSources.push(src);
        }
    }

    const steps = finalState.steps || [];

    // 7. Persist trace steps and final run update in PostgreSQL (Observability)
    try {
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            await createAgentRunStep({
                runId: cleanRunId,
                stepNumber: s.step || (i + 1),
                node: s.type === "tool_call" ? "execute_tool" : (s.type === "final" ? "final_answer" : "reason"),
                action: s.type || "step",
                toolName: s.tool || null,
                toolArguments: s.arguments || null,
                toolResultSummary: s.resultSummary || null,
                status: s.status || "success",
                durationMs: s.durationMs || 0,
            });
        }

        await updateAgentRun(cleanRunId, cleanOrgId, {
            status: finalState.status || "completed",
            stoppedReason: finalState.stoppedReason || "completed",
            totalSteps: steps.length,
            durationMs,
            finalAnswer: finalState.finalAnswer || "",
            model: finalState.model || "llama3.2:3b",
            completedAt: new Date(),
        });
    } catch (dbErr) {
        console.warn("[AgentOrchestrator] Warning: Failed to persist agent completion to PostgreSQL:", dbErr.message);
    }

    // 8. Publish terminal SSE event (run_completed or run_stopped)
    try {
        if (finalState.stoppedReason === "completed" || Boolean(finalState.finalAnswer)) {
            executionEvents.publish(cleanRunId, "run_completed", {
                runId: cleanRunId,
                status: finalState.status || "completed",
                stoppedReason: finalState.stoppedReason || "completed",
                totalSteps: steps.length,
                durationMs,
                answer: finalState.finalAnswer || "Goal processing completed.",
            });
        } else {
            executionEvents.publish(cleanRunId, "run_stopped", {
                runId: cleanRunId,
                status: finalState.status || "stopped",
                stoppedReason: finalState.stoppedReason || "safe_failure",
                totalSteps: steps.length,
                durationMs,
            });
        }
    } catch (sseErr) {
        console.warn("[AgentOrchestrator] Warning: Failed to publish terminal SSE event:", sseErr.message);
    }

    // 9. Return response contract
    return {
        success: finalState.stoppedReason === "completed" || Boolean(finalState.finalAnswer),
        goal: cleanGoal,
        model: finalState.model,
        answer: finalState.finalAnswer || "Goal processing completed.",
        steps,
        sources: uniqueSources,
        deliverable: finalState.deliverable || null,
        stoppedReason: finalState.stoppedReason || "completed",
        totalSteps: steps.length,
        durationMs,
        orchestration: {
            engine: "langgraph",
            runId: cleanRunId,
            executionOrder: finalState.executionOrder,
            status: finalState.status,
            stoppedReason: finalState.stoppedReason,
            totalSteps: steps.length,
        },
    };
}
