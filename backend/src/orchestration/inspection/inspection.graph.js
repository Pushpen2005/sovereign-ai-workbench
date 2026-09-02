/**
 * Inspection StateGraph Builder
 *
 * Constructs and compiles the formal LangGraph StateGraph for the SovereignAI
 * inspection pipeline.
 *
 * Target Architecture:
 *   START
 *     ↓
 *   ingest
 *     ↓
 *   retrieve
 *     ↓
 *   extract_findings
 *     ↓
 *   retrieve_sop
 *     ↓
 *   assess_risk
 *     ↓
 *   validate_citations
 *     ↓
 *   generate_report
 *     ↓
 *   END
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { InspectionAgentState } from "./inspection.state.js";
import { defaultNodes } from "./inspection.nodes.js";

/**
 * Build and compile the inspection StateGraph.
 *
 * @param {object} [customNodes] Optional custom node map (default: defaultNodes)
 * @param {object} [compileOptions] Optional LangGraph compilation options (e.g. checkpointer)
 * @returns {CompiledStateGraph} Compiled LangGraph instance
 */
export function createInspectionGraph(customNodes = null, compileOptions = {}) {
    const nodes = customNodes || defaultNodes;

    const graph = new StateGraph(InspectionAgentState)
        .addNode("ingest", nodes.ingestNode)
        .addNode("retrieve", nodes.retrieveNode)
        .addNode("extract_findings", nodes.extractFindingsNode)
        .addNode("retrieve_sop", nodes.retrieveSopNode)
        .addNode("assess_risk", nodes.assessRiskNode)
        .addNode("validate_citations", nodes.validateCitationsNode)
        .addNode("generate_report", nodes.generateReportNode)

        .addEdge(START, "ingest")
        .addEdge("ingest", "retrieve")
        .addEdge("retrieve", "extract_findings")
        .addEdge("extract_findings", "retrieve_sop")
        .addEdge("retrieve_sop", "assess_risk")
        .addEdge("assess_risk", "validate_citations")
        .addEdge("validate_citations", "generate_report")
        .addEdge("generate_report", END);

    return graph.compile(compileOptions);
}

/**
 * Pre-compiled default instance for ready execution.
 */
export const compiledInspectionGraph = createInspectionGraph();
