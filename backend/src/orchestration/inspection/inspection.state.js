/**
 * Inspection Agent State Definition
 *
 * Defines the formal state schema and channel reducers for the LangGraph
 * inspection orchestration workflow.
 *
 * All state transitions in the inspection pipeline are tracked here:
 *   START -> ingest -> retrieve -> extract_findings -> retrieve_sop -> assess_risk -> validate_citations -> generate_report -> END
 */

import { Annotation } from "@langchain/langgraph";

/**
 * Standard reducer for scalar values: updates if new value is provided,
 * otherwise preserves current value.
 */
function replaceReducer(current, update) {
    return update !== undefined ? update : current;
}

/**
 * Standard reducer for list values that are fully overwritten by node output
 * (e.g. findings, retrievalResults).
 */
function listReplaceReducer(current, update) {
    if (update === undefined) return current;
    return Array.isArray(update) ? update : [update];
}

/**
 * Reducer for accumulating lists across node transitions (e.g. executionOrder, errors).
 */
function accumulateReducer(current, update) {
    if (update === undefined || update === null) return current;
    const items = Array.isArray(update) ? update : [update];
    return current.concat(items);
}

/**
 * Reducer for dictionary/metadata merging.
 */
function mergeReducer(current, update) {
    if (!update || typeof update !== "object") return current;
    return { ...current, ...update };
}

/**
 * InspectionAgentState
 *
 * Root state annotation encompassing all attributes needed by the SovereignAI
 * inspection pipeline:
 *
 * - runId: Unique workflow invocation identifier
 * - documentId: Target document identifier
 * - task: Inspection analysis instruction
 * - filePath: Local path to source PDF (when available)
 * - organizationId: Multi-tenant tenant identifier
 * - ingestionResult: Metadata from document ingestion ({ documentId, filename, chunksStored })
 * - retrievalResults: Candidate chunks retrieved from Qdrant vector store
 * - findings: Structured findings array conforming to inspection.schema.js
 * - sopEvidence: Retrieved SOP reference chunks for cross-referencing
 * - riskAssessment: Primary risk assessment ({ level: 'LOW'|'MEDIUM'|'HIGH'|null, reason })
 * - riskAssessments: List of individual finding risk evaluations
 * - recommendation: Primary actionable recommendation string
 * - recommendations: List of individual recommendation strings
 * - citations: List of verified bibliographic citations
 * - report: Generated Approval Note report metadata ({ filename, filePath, downloadUrl })
 * - currentNode: Current or most recently executed graph node name
 * - executionOrder: Chronological list of executed node names
 * - status: Workflow lifecycle status ('pending'|'in_progress'|'completed'|'failed')
 * - errors: Accumulated error records ({ node, message, timestamp })
 * - metadata: Arbitrary key-value context or configuration options
 */
export const InspectionAgentState = Annotation.Root({
    runId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    documentId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    task: Annotation({
        reducer: replaceReducer,
        default: () => "Analyze this inspection report and extract all significant findings.",
    }),

    filePath: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    organizationId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    userId: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    ingestionResult: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    retrievalResults: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    findings: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    sopEvidence: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    riskAssessment: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    riskAssessments: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    recommendation: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    recommendations: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    citations: Annotation({
        reducer: listReplaceReducer,
        default: () => [],
    }),

    report: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    currentNode: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    executionOrder: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    status: Annotation({
        reducer: replaceReducer,
        default: () => "pending",
    }),

    errors: Annotation({
        reducer: accumulateReducer,
        default: () => [],
    }),

    findingValidation: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    extractionAttempts: Annotation({
        reducer: replaceReducer,
        default: () => 1,
    }),

    maxExtractionAttempts: Annotation({
        reducer: replaceReducer,
        default: () => 2,
    }),

    sopEvidenceStatus: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    riskValidation: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    citationValidation: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    failureReason: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    workflowOutcome: Annotation({
        reducer: replaceReducer,
        default: () => null,
    }),

    metadata: Annotation({
        reducer: mergeReducer,
        default: () => ({}),
    }),
});
