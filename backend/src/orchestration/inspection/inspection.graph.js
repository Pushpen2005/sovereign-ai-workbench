/**
 * Inspection StateGraph Builder (Phase 4: Conditional State Machine)
 *
 * Constructs and compiles the formal LangGraph StateGraph with conditional edges,
 * schema validation, bounded retry, and safe failure termination.
 *
 * Architecture:
 *   START
 *     ↓
 *   ingest
 *     ↓
 *   retrieve
 *     ↓
 *   extract_findings
 *     ↓
 *   validate_findings
 *     ├── VALID → retrieve_sop
 *     └── INVALID → retry_extraction (attempts < max) → validate_findings
 *                   safe_failure (attempts >= max) → END
 *
 *   retrieve_sop
 *     ↓
 *   check_sop_evidence
 *     ├── EVIDENCE_FOUND → assess_risk
 *     └── NO_EVIDENCE → insufficient_evidence → END
 *
 *   assess_risk
 *     ↓
 *   validate_risk
 *     ├── VALID → validate_citations
 *     └── INVALID → safe_failure → END
 *
 *   validate_citations
 *     ↓
 *   generate_report
 *     ↓
 *   END
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { InspectionAgentState } from "./inspection.state.js";
import {
    defaultNodes,
    routeFindingsValidation,
    routeSopEvidence,
    routeRiskValidation,
} from "./inspection.nodes.js";

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
        // 1. Pipeline nodes
        .addNode("ingest", nodes.ingestNode)
        .addNode("retrieve", nodes.retrieveNode)
        .addNode("extract_findings", nodes.extractFindingsNode)
        .addNode("validate_findings", nodes.validateFindingsNode)
        .addNode("retry_extraction", nodes.retryExtractionNode)
        .addNode("retrieve_sop", nodes.retrieveSopNode)
        .addNode("check_sop_evidence", nodes.checkSopEvidenceNode)
        .addNode("insufficient_evidence", nodes.insufficientEvidenceNode)
        .addNode("assess_risk", nodes.assessRiskNode)
        .addNode("validate_risk", nodes.validateRiskNode)
        .addNode("safe_failure", nodes.safeFailureNode)
        .addNode("validate_citations", nodes.validateCitationsNode)
        .addNode("generate_report", nodes.generateReportNode)

        // 2. Linear sequence from START to validate_findings
        .addEdge(START, "ingest")
        .addEdge("ingest", "retrieve")
        .addEdge("retrieve", "extract_findings")
        .addEdge("extract_findings", "validate_findings")

        // 3. Conditional routing on findings validation
        .addConditionalEdges("validate_findings", routeFindingsValidation, {
            retrieve_sop: "retrieve_sop",
            retry_extraction: "retry_extraction",
            safe_failure: "safe_failure",
        })

        // 4. Bounded retry loop back to validation
        .addEdge("retry_extraction", "validate_findings")

        // 5. SOP retrieval and evidence check
        .addEdge("retrieve_sop", "check_sop_evidence")

        // 6. Conditional routing on SOP evidence existence
        .addConditionalEdges("check_sop_evidence", routeSopEvidence, {
            assess_risk: "assess_risk",
            insufficient_evidence: "insufficient_evidence",
        })

        // 7. Risk assessment and risk validation
        .addEdge("assess_risk", "validate_risk")

        // 8. Conditional routing on risk assessment schema validity
        .addConditionalEdges("validate_risk", routeRiskValidation, {
            validate_citations: "validate_citations",
            safe_failure: "safe_failure",
        })

        // 9. Citation validation and deliverable generation
        .addEdge("validate_citations", "generate_report")

        // 10. Terminal edges to END
        .addEdge("generate_report", END)
        .addEdge("insufficient_evidence", END)
        .addEdge("safe_failure", END);

    return graph.compile(compileOptions);
}

/**
 * Pre-compiled default instance for production execution.
 */
export const compiledInspectionGraph = createInspectionGraph();
