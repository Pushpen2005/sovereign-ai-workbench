/**
 * Autonomous Agent StateGraph Builder
 *
 * Constructs and compiles the LangGraph StateGraph for the multi-step
 * autonomous tool-calling agent.
 *
 * Architecture:
 *   START
 *     ↓
 *   initialize
 *     ↓
 *   reason ◄──────────────────┐
 *     │                       │
 *     ├─► execute_tool        │
 *     │        ↓              │
 *     │   validate_tool_result┘
 *     │
 *     ├─► final_answer ──► END
 *     │
 *     └─► safe_failure ──► END
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentAgentState } from "./agent.state.js";
import { defaultAgentNodes, routeAgentDecision, routeToolResultNext } from "./agent.nodes.js";

/**
 * Builds and compiles the agent StateGraph.
 *
 * @param {object} [customNodes] Optional custom node overrides
 * @param {object} [compileOptions] Optional compiler options
 * @returns {CompiledStateGraph}
 */
export function createAgentGraph(customNodes = null, compileOptions = {}) {
    const nodes = customNodes || defaultAgentNodes;

    const graph = new StateGraph(AgentAgentState)
        .addNode("initialize", nodes.initializeAgentNode)
        .addNode("reason", nodes.reasonNode)
        .addNode("execute_tool", nodes.executeToolNode)
        .addNode("validate_tool_result", nodes.validateToolResultNode)
        .addNode("final_answer", nodes.finalAnswerNode)
        .addNode("safe_failure", nodes.safeFailureNode)

        .addEdge(START, "initialize")
        .addEdge("initialize", "reason")

        .addConditionalEdges("reason", routeAgentDecision, {
            execute_tool: "execute_tool",
            final_answer: "final_answer",
            safe_failure: "safe_failure",
        })

        .addEdge("execute_tool", "validate_tool_result")
        .addConditionalEdges("validate_tool_result", routeToolResultNext, {
            reason: "reason",
            safe_failure: "safe_failure",
        })

        .addEdge("final_answer", END)
        .addEdge("safe_failure", END);

    return graph.compile(compileOptions);
}

export const compiledAgentGraph = createAgentGraph();
