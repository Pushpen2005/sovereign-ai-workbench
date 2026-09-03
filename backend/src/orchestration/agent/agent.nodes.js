/**
 * Autonomous Agent Workflow Nodes
 *
 * Implements the LangGraph nodes for the multi-step autonomous tool agent runtime.
 * Architecture:
 *   START
 *     ↓
 *   initialize
 *     ↓
 *   reason ◄──────────────┐
 *     │                   │
 *     ├─► final_answer    │
 *     ├─► execute_tool    │
 *     │        ↓          │
 *     │   validate_tool ──┘
 *     └─► safe_failure
 */

import { generateAnswer } from "../../../../ai-service/llm/llm.service.js";
import { routeTask } from "../../../../ai-service/router/modelRouter.js";
import {
    TOOL_REGISTRY,
    executeRegisteredTool,
} from "../../services/agentTools/toolRegistry.js";
import {
    parseActionJSON,
    summarizeToolResult,
    sanitizeArgsForDisplay,
    buildAgentPlannerPrompt,
    AgentRuntimeError,
} from "../../services/agent.service.js";

/**
 * Conditional router for the reasonNode decision.
 */
export function routeAgentDecision(state) {
    if (state.stoppedReason === "timeout") {
        return "safe_failure";
    }

    if (state.stoppedReason === "max_steps_reached") {
        return "safe_failure";
    }

    if (state.stoppedReason === "invalid_json") {
        return "safe_failure";
    }

    if (state.stoppedReason === "unknown_action_type") {
        return "safe_failure";
    }

    if (!state.action || typeof state.action !== "object") {
        return "safe_failure";
    }

    if (state.action.type === "final") {
        return "final_answer";
    }

    if (state.action.type === "tool_call") {
        return "execute_tool";
    }

    return "safe_failure";
}

/**
 * Factory creating node implementations with dependency injection support for tests.
 *
 * @param {object} [customServices] Optional overrides for testing
 * @returns {object} Map of node functions
 */
export function createAgentNodes(customServices = {}) {
    const services = {
        generateAnswer,
        routeTask,
        executeRegisteredTool,
        ...customServices,
    };

    /**
     * Node 1: Initialize Agent
     */
    async function initializeAgentNode(state) {
        const executionOrder = ["initialize"];

        if (!state.goal || typeof state.goal !== "string" || !state.goal.trim()) {
            throw new AgentRuntimeError("goal must be a non-empty string");
        }

        const cleanGoal = state.goal.trim();

        // Determine model via router if not explicitly supplied
        let model = state.model || "llama3.2:3b";
        if (!state.model || state.model === "llama3.2:3b") {
            try {
                const routing = await services.routeTask(cleanGoal);
                if (routing?.selectedModel) {
                    model = routing.selectedModel;
                }
            } catch {
                model = process.env.DEFAULT_MODEL || "llama3.2:3b";
            }
        }

        return {
            goal: cleanGoal,
            model,
            startTime: state.startTime || Date.now(),
            status: "in_progress",
            currentNode: "initialize",
            executionOrder,
        };
    }

    /**
     * Node 2: Reason & Plan Action
     */
    async function reasonNode(state) {
        const executionOrder = ["reason"];

        // 1. Timeout boundary check
        if (Date.now() - state.startTime >= state.timeoutMs) {
            return {
                action: null,
                stoppedReason: "timeout",
                currentNode: "reason",
                executionOrder,
            };
        }

        // 2. Step limit boundary check
        if (state.currentStep >= state.maxSteps) {
            return {
                action: null,
                stoppedReason: "max_steps_reached",
                currentNode: "reason",
                executionOrder,
            };
        }

        const nextStep = (state.currentStep || 0) + 1;
        const prompt = buildAgentPlannerPrompt(state.goal, state.stepHistory || []);

        let action = null;
        let llmResponse = "";

        try {
            llmResponse = await services.generateAnswer(prompt, state.model, { format: "json" });
            action = parseActionJSON(llmResponse);
        } catch (err) {
            // Controlled single retry on malformed JSON
            try {
                const retryPrompt = `${prompt}\n\n[WARNING: Your previous response was not valid JSON. You MUST return ONLY valid JSON matching Option A or Option B.]`;
                llmResponse = await services.generateAnswer(retryPrompt, state.model, { format: "json" });
                action = parseActionJSON(llmResponse);
            } catch (retryErr) {
                return {
                    currentStep: nextStep,
                    action: null,
                    stoppedReason: "invalid_json",
                    finalAnswer: `Agent encountered an unrecoverable action parse error: ${retryErr.message}`,
                    currentNode: "reason",
                    executionOrder,
                };
            }
        }

        if (!action || typeof action !== "object" || !action.type) {
            return {
                currentStep: nextStep,
                action: null,
                stoppedReason: "unknown_action_type",
                finalAnswer: "Agent received an unformatted action from the model.",
                currentNode: "reason",
                executionOrder,
            };
        }

        if (action.type !== "final" && action.type !== "tool_call") {
            return {
                currentStep: nextStep,
                action,
                stoppedReason: "unknown_action_type",
                finalAnswer: `Agent received unknown action type '${action.type}'.`,
                currentNode: "reason",
                executionOrder,
            };
        }

        return {
            currentStep: nextStep,
            action,
            currentNode: "reason",
            executionOrder,
        };
    }

    /**
     * Node 3: Execute Tool
     */
    async function executeToolNode(state) {
        const executionOrder = ["execute_tool"];
        const action = state.action || {};

        const toolName = (action.tool || "").toLowerCase().trim();
        const toolArgs = action.arguments || {};
        const reason = action.reason || `Calling ${toolName}`;

        const toolStart = Date.now();
        const toolExecResult = await services.executeRegisteredTool(toolName, toolArgs);
        const toolDurationMs = Date.now() - toolStart;

        return {
            lastTool: {
                toolName,
                toolArgs,
                reason,
                status: toolExecResult.status,
                result: toolExecResult.result,
                error: toolExecResult.error,
                durationMs: toolDurationMs,
            },
            currentNode: "execute_tool",
            executionOrder,
        };
    }

    /**
     * Node 4: Validate Tool Result & Format History
     */
    async function validateToolResultNode(state) {
        const executionOrder = ["validate_tool_result"];
        const lastTool = state.lastTool || {};

        const { toolName, toolArgs, reason, status, result, error, durationMs } = lastTool;

        const summary = summarizeToolResult(toolName, { status, result, error });
        const sanitizedArgs = sanitizeArgsForDisplay(toolArgs);

        const traceStep = {
            step: state.currentStep,
            type: "tool_call",
            tool: toolName,
            status,
            reason,
            arguments: sanitizedArgs,
            resultSummary: summary,
            durationMs: durationMs || 0,
        };

        const newSources = [];
        let newDeliverable = state.deliverable;

        if (toolName === "document_search" && status === "success" && result?.results) {
            for (const r of result.results) {
                newSources.push({
                    filename: r.filename,
                    page: r.page,
                    chunkIndex: r.chunkIndex,
                    score: r.score,
                    text: (r.text || "").slice(0, 150),
                });
            }
        }

        if (toolName === "document_generate" && status === "success" && result?.downloadUrl) {
            newDeliverable = result;
        }

        let detailsText = "";
        if (status === "success") {
            if (toolName === "document_search") {
                detailsText = (result.results || [])
                    .map((r, i) => `[Result ${i + 1}] (${r.filename}, p.${r.page}): ${(r.text || "").slice(0, 200)}`)
                    .join("\n");
            } else if (toolName === "file_read") {
                detailsText = result.textExcerpt || "";
            } else if (toolName === "execute_sandbox_code") {
                detailsText = result.stdout || result.stderr || "";
            } else if (toolName === "calculator") {
                detailsText = String(result.result);
            } else {
                detailsText = JSON.stringify(result).slice(0, 300);
            }
        } else {
            detailsText = `Tool Error: ${error}`;
        }

        const historyEntry = {
            tool: toolName,
            arguments: toolArgs,
            status,
            resultSummary: summary,
            detailsText,
        };

        return {
            steps: [traceStep],
            stepHistory: [historyEntry],
            sources: newSources,
            deliverable: newDeliverable,
            currentNode: "validate_tool_result",
            executionOrder,
        };
    }

    /**
     * Node 5: Final Answer Node
     */
    async function finalAnswerNode(state) {
        const executionOrder = ["final_answer"];
        const finalAnswer = state.action?.answer || "Goal accomplished.";

        const traceStep = {
            step: state.currentStep,
            type: "final",
            status: "success",
            resultSummary: "Produced final answer.",
            durationMs: Date.now() - (state.startTime || Date.now()),
        };

        return {
            finalAnswer,
            steps: [traceStep],
            status: "completed",
            stoppedReason: "completed",
            currentNode: "final_answer",
            executionOrder,
        };
    }

    /**
     * Node 6: Safe Failure Node
     */
    async function safeFailureNode(state) {
        const executionOrder = ["safe_failure"];

        let finalAnswer = state.finalAnswer;
        let status = "failed";

        if (state.stoppedReason === "max_steps_reached") {
            status = "completed";
            if (!finalAnswer) {
                const summaries = (state.stepHistory || []).map((s) => s.resultSummary).join(" | ");
                finalAnswer = `The task reached the maximum of ${state.maxSteps} allowed tool steps. Summary of findings: ${summaries || "No tools executed"}`;
            }
        } else if (state.stoppedReason === "timeout") {
            status = "completed";
            if (!finalAnswer) {
                finalAnswer = `Agent execution timed out after ${state.timeoutMs}ms.`;
            }
        } else if (state.stoppedReason === "invalid_json") {
            status = "failed";
            if (!finalAnswer) {
                finalAnswer = "Agent encountered an unrecoverable action parse error.";
            }
        } else if (!finalAnswer) {
            finalAnswer = `Agent stopped safely due to: ${state.stoppedReason || "safe_failure"}`;
        }

        return {
            finalAnswer,
            status,
            stoppedReason: state.stoppedReason || "safe_failure",
            currentNode: "safe_failure",
            executionOrder,
        };
    }

    return {
        initializeAgentNode,
        reasonNode,
        executeToolNode,
        validateToolResultNode,
        finalAnswerNode,
        safeFailureNode,
    };
}

export const defaultAgentNodes = createAgentNodes();
export const {
    initializeAgentNode,
    reasonNode,
    executeToolNode,
    validateToolResultNode,
    finalAnswerNode,
    safeFailureNode,
} = defaultAgentNodes;
