/**
 * PR #26 — Autonomous Agent Tool Orchestration Service
 *
 * Implements a bounded, iterative multi-step tool-calling agent runtime.
 * STRICT CONSTRAINTS:
 *   - Maximum step limit (default: 8)
 *   - Overall timeout limit (default: 60s)
 *   - Robust JSON action validation & single-attempt repair
 *   - No arbitrary tool execution (strict whitelist in toolRegistry)
 *   - Zero external cloud AI calls (100% on-premise local Ollama)
 *   - Zero hidden chain-of-thought exposed to the frontend
 */

import { generateAnswer, LLMError } from "../../../ai-service/llm/llm.service.js";
import { routeTask } from "../../../ai-service/router/modelRouter.js";
import {
    TOOL_REGISTRY,
    getToolDefinitionsPrompt,
    executeRegisteredTool,
} from "./agentTools/toolRegistry.js";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 60000; // 60 seconds

export class AgentRuntimeError extends Error {
    constructor(message) {
        super(message);
        this.name = "AgentRuntimeError";
    }
}

/**
 * Strips markdown code blocks and attempts JSON parse.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseActionJSON(text) {
    if (typeof text !== "string" || !text.trim()) {
        throw new AgentRuntimeError("Model returned empty action response");
    }

    let cleaned = text.trim();

    // Strip ```json ... ``` or ``` ... ```
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }

    // Try finding the first '{' and last '}'
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch (parseErr) {
        throw new AgentRuntimeError(`LLM returned malformed JSON: ${parseErr.message}`);
    }
}

/**
 * Creates a concise, safe summary of a tool execution for context and UI display.
 *
 * @param {string} toolName
 * @param {object} toolResult
 * @returns {string}
 */
function summarizeToolResult(toolName, toolResult) {
    if (toolResult.status === "error") {
        return `Error: ${toolResult.error}`;
    }

    const res = toolResult.result;
    if (!res) return "Tool completed with empty result.";

    if (toolName === "calculator") {
        return `Result: ${res.result} (for '${res.expression}')`;
    }

    if (toolName === "document_search") {
        return `Found ${res.totalResults} relevant chunks in Qdrant.`;
    }

    if (toolName === "file_read") {
        return `Read document '${res.filename}' (${res.chunksRetrieved} chunks retrieved).`;
    }

    if (toolName === "execute_sandbox_code") {
        const out = (res.stdout || "").trim();
        const err = (res.stderr || "").trim();
        return out ? `Output: ${out.slice(0, 100)}` : err ? `Stderr: ${err.slice(0, 100)}` : "Executed cleanly.";
    }

    if (toolName === "document_generate") {
        return `Compiled '${res.filename}' deliverable (${res.sectionsCount} sections).`;
    }

    if (toolName === "analyze_image") {
        return `Visual analysis completed using model '${res.model}'.`;
    }

    return "Completed successfully.";
}

/**
 * Sanitizes arguments for UI display and execution context (removes large payloads).
 *
 * @param {object} args
 * @returns {object}
 */
function sanitizeArgsForDisplay(args) {
    if (!args || typeof args !== "object") return {};
    const sanitized = { ...args };
    if (sanitized.imageBase64) {
        sanitized.imageBase64 = `<base64 image buffer ${sanitized.imageBase64.length} chars>`;
    }
    if (typeof sanitized.code === "string" && sanitized.code.length > 200) {
        sanitized.code = sanitized.code.slice(0, 200) + "... [truncated]";
    }
    return sanitized;
}

/**
 * Builds the prompt for the agent planner at step N.
 *
 * @param {string} goal
 * @param {Array<object>} stepHistory
 * @returns {string}
 */
function buildAgentPlannerPrompt(goal, stepHistory) {
    const toolDefs = getToolDefinitionsPrompt();

    let historyText = "No previous tools have been executed yet.";
    if (stepHistory.length > 0) {
        historyText = stepHistory
            .map((s, idx) => {
                return `Step ${idx + 1}: Tool '${s.tool}'
- Arguments: ${JSON.stringify(s.arguments)}
- Status: ${s.status}
- Summary: ${s.resultSummary}
- Details: ${s.detailsText ? s.detailsText.slice(0, 400) : "N/A"}`;
            })
            .join("\n\n");
    }

    return `You are an expert autonomous industrial AI agent in the SovereignAI platform.
Your objective is to accomplish the user's goal by planning multi-step work and calling local tools.

AVAILABLE TOOLS:
${toolDefs}

OUTPUT FORMAT:
You MUST respond with valid JSON matching EXACTLY one of the following two schemas:

OPTION A: Call a tool
{
  "type": "tool_call",
  "tool": "<registered_tool_name>",
  "arguments": { "<param>": "<value>" },
  "reason": "<one sentence describing why this tool is needed>"
}

OPTION B: Final answer (when the goal is fully accomplished or no more tools are needed)
{
  "type": "final",
  "answer": "<thorough, evidence-backed answer addressing the user's goal>"
}

RULES:
1. ONLY call registered tools: ${Object.keys(TOOL_REGISTRY).join(", ")}.
2. NEVER use eval() or make up tool names.
3. For calculations, use the "calculator" tool or "execute_sandbox_code" (Python).
4. For searching regulations, SOPs, or inspection reports, use "document_search" or "file_read".
5. When generating a formal report, call "document_generate".
6. Do NOT expose internal chain-of-thought; keep "reason" concise.
7. CRITICAL: If the previous tool calls in PAST EXECUTION HISTORY already provide the answer or result, DO NOT call another tool! You MUST immediately return OPTION B with the final answer.
8. NEVER repeat the same tool with the same calculation or query. Once you have the output, return OPTION B immediately.

USER GOAL:
"${goal}"

PAST EXECUTION HISTORY:
${historyText}

Decide your next action:`;
}

/**
 * Runs the bounded agent loop.
 *
 * @param {object} params
 * @param {string} params.goal - The user's goal or inquiry
 * @param {number} [params.maxSteps=8] - Maximum tool steps permitted
 * @param {number} [params.timeoutMs=60000] - Total execution timeout in ms
 * @returns {Promise<object>}
 */
export async function runAgentLoop({
    goal,
    maxSteps = DEFAULT_MAX_STEPS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
    if (typeof goal !== "string" || !goal.trim()) {
        throw new AgentRuntimeError("goal must be a non-empty string");
    }

    const cleanGoal = goal.trim();
    const startTime = Date.now();
    const steps = [];
    const collectedSources = [];
    let deliverable = null;
    let finalAnswer = "";
    let stoppedReason = "completed";

    // 1. Determine local model via router
    let model = "llama3.2:3b";
    try {
        const routing = await routeTask(cleanGoal);
        model = routing.selectedModel;
    } catch {
        model = process.env.DEFAULT_MODEL || "llama3.2:3b";
    }

    const stepHistory = [];
    let stepCount = 0;

    while (stepCount < maxSteps) {
        // Check timeout
        if (Date.now() - startTime >= timeoutMs) {
            stoppedReason = "timeout";
            break;
        }

        stepCount++;
        const prompt = buildAgentPlannerPrompt(cleanGoal, stepHistory);

        let action = null;
        let llmResponse = "";

        try {
            llmResponse = await generateAnswer(prompt, model, { format: "json" });
            action = parseActionJSON(llmResponse);
        } catch (err) {
            // Controlled single retry on malformed JSON
            try {
                const retryPrompt = `${prompt}\n\n[WARNING: Your previous response was not valid JSON. You MUST return ONLY valid JSON matching Option A or Option B.]`;
                llmResponse = await generateAnswer(retryPrompt, model, { format: "json" });
                action = parseActionJSON(llmResponse);
            } catch (retryErr) {
                // If model still fails to return valid JSON, terminate cleanly
                stoppedReason = "invalid_json";
                finalAnswer = `Agent encountered an unrecoverable action parse error: ${retryErr.message}`;
                break;
            }
        }

        // Validate action schema
        if (!action || typeof action !== "object" || !action.type) {
            stoppedReason = "invalid_action";
            finalAnswer = "Agent received an unformatted action from the model.";
            break;
        }

        // ─── Case 1: Final Answer ─────────────────────────────────────────────
        if (action.type === "final") {
            finalAnswer = action.answer || "Goal accomplished.";
            steps.push({
                step: stepCount,
                type: "final",
                status: "success",
                resultSummary: "Produced final answer.",
                durationMs: Date.now() - startTime,
            });
            stoppedReason = "completed";
            break;
        }

        // ─── Case 2: Tool Call ────────────────────────────────────────────────
        if (action.type === "tool_call") {
            const toolName = (action.tool || "").toLowerCase().trim();
            const toolArgs = action.arguments || {};
            const reason = action.reason || `Calling ${toolName}`;

            const toolStart = Date.now();
            const toolExecResult = await executeRegisteredTool(toolName, toolArgs);
            const toolDurationMs = Date.now() - toolStart;

            const summary = summarizeToolResult(toolName, toolExecResult);
            const sanitizedArgs = sanitizeArgsForDisplay(toolArgs);

            // Record in public timeline
            const traceStep = {
                step: stepCount,
                type: "tool_call",
                tool: toolName,
                status: toolExecResult.status,
                reason,
                arguments: sanitizedArgs,
                resultSummary: summary,
                durationMs: toolDurationMs,
            };

            // Extract citations if document_search
            if (toolName === "document_search" && toolExecResult.status === "success" && toolExecResult.result?.results) {
                for (const r of toolExecResult.result.results) {
                    collectedSources.push({
                        filename: r.filename,
                        page: r.page,
                        chunkIndex: r.chunkIndex,
                        score: r.score,
                        text: r.text.slice(0, 150),
                    });
                }
            }

            // Extract deliverable if document_generate
            if (toolName === "document_generate" && toolExecResult.status === "success" && toolExecResult.result?.downloadUrl) {
                deliverable = toolExecResult.result;
            }

            steps.push(traceStep);

            // Format details for subsequent LLM context
            let detailsText = "";
            if (toolExecResult.status === "success") {
                if (toolName === "document_search") {
                    detailsText = (toolExecResult.result.results || [])
                        .map((r, i) => `[Result ${i + 1}] (${r.filename}, p.${r.page}): ${r.text.slice(0, 200)}`)
                        .join("\n");
                } else if (toolName === "file_read") {
                    detailsText = toolExecResult.result.textExcerpt || "";
                } else if (toolName === "execute_sandbox_code") {
                    detailsText = toolExecResult.result.stdout || toolExecResult.result.stderr || "";
                } else if (toolName === "calculator") {
                    detailsText = String(toolExecResult.result.result);
                } else {
                    detailsText = JSON.stringify(toolExecResult.result).slice(0, 300);
                }
            } else {
                detailsText = `Tool Error: ${toolExecResult.error}`;
            }

            stepHistory.push({
                tool: toolName,
                arguments: toolArgs,
                status: toolExecResult.status,
                resultSummary: summary,
                detailsText,
            });

            continue;
        }

        // Unknown action type
        stoppedReason = "unknown_action_type";
        finalAnswer = `Agent received unknown action type '${action.type}'.`;
        break;
    }

    if (stepCount >= maxSteps && !finalAnswer) {
        stoppedReason = "max_steps_reached";
        // Synthesize a concluding answer if max steps reached
        finalAnswer = `The task reached the maximum of ${maxSteps} allowed tool steps. Summary of findings: ${stepHistory.map((s) => s.resultSummary).join(" | ")}`;
    }

    // Deduplicate collected sources
    const uniqueSources = [];
    const seen = new Set();
    for (const src of collectedSources) {
        const key = `${src.filename}:${src.page}:${src.chunkIndex}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueSources.push(src);
        }
    }

    return {
        success: stoppedReason === "completed" || Boolean(finalAnswer),
        goal: cleanGoal,
        model,
        answer: finalAnswer || "Goal processing completed.",
        steps,
        sources: uniqueSources,
        deliverable,
        stoppedReason,
        totalSteps: steps.length,
        durationMs: Date.now() - startTime,
    };
}
