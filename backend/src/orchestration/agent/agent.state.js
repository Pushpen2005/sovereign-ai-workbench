/**
 * Autonomous Tool Agent State Definition
 *
 * Defines the formal state schema and channel reducers for the LangGraph
 * autonomous agent orchestration workflow.
 */

import { Annotation } from "@langchain/langgraph";

function replaceReducer(current, update) {
    return update !== undefined ? update : current;
}

function listReplaceReducer(current, update) {
    if (update === undefined) return current;
    return Array.isArray(update) ? update : [update];
}

function accumulateReducer(current, update) {
    if (update === undefined || update === null) return current;
    const items = Array.isArray(update) ? update : [update];
    return current.concat(items);
}

function mergeReducer(current, update) {
    if (!update || typeof update !== "object") return current;
    return { ...current, ...update };
}

/**
 * AgentAgentState
 *
 * Root state annotation encompassing all attributes needed by the SovereignAI
 * autonomous tool-calling agent runtime:
 *
 * - runId: Unique workflow invocation identifier
 * - userId: User identifier (when authenticated)
 * - organizationId: Multi-tenant tenant identifier
 * - goal: User inquiry or instruction
 * - model: Selected local Ollama model (e.g. llama3.2:3b)
 * - currentStep: Current step index (1-based)
 * - maxSteps: Hard ceiling for total tool executions (default: 8)
 * - timeoutMs: Execution deadline in milliseconds (default: 60000)
 * - startTime: Timestamp of workflow initiation
 * - stepHistory: Prompt context history with tool summaries and details
 * - steps: Public execution trace steps for UI observability
 * - sources: Deduplicated citations retrieved from vector search
 * - deliverable: Generated report metadata (e.g. from document_generate)
 * - action: Parsed action object from local LLM (type: "tool_call" | "final")
 * - finalAnswer: Concluding answer addressing the user's goal
 * - stoppedReason: Lifecycle reason ("completed" | "max_steps_reached" | "timeout" | "invalid_json" | "safe_failure")
 * - status: Workflow lifecycle status ("pending" | "in_progress" | "completed" | "failed")
 * - errors: Accumulated error records ({ node, message, timestamp })
 * - executionOrder: Chronological list of executed node names
 * - currentNode: Current or most recently executed graph node name
 * - metadata: Arbitrary key-value options
 */
export const AgentAgentState = Annotation.Root({
    runId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    userId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    organizationId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    goal: Annotation({
        reducer: replaceReducer,
        default: () => "",
    }),

    model: Annotation({
        reducer: replaceReducer,
        default: () => "llama3.2:3b",
    }),

    currentStep: Annotation({
        reducer: replaceReducer,
        default: () => 0,
    }),

    maxSteps: Annotation({
        reducer: replaceReducer,
        default: () => 8,
    }),

    timeoutMs: Annotation({
        reducer: replaceReducer,
        default: () => 60000,
    }),

    startTime: Annotation({
        reducer: replaceReducer,
        default: () => Date.now(),
    }),

    stepHistory: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    steps: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    sources: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    deliverable: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    action: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    lastTool: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    finalAnswer: Annotation({
        reducer: replaceReducer,
        default: () => "",
    }),

    stoppedReason: Annotation({
        reducer: replaceReducer,
        default: () => "in_progress",
    }),

    status: Annotation({
        reducer: replaceReducer,
        default: () => "pending",
    }),

    errors: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    executionOrder: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    currentNode: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    metadata: Annotation({
        reducer: mergeReducer,
        default: () => ({}),
    }),
});
