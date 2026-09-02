/**
 * Inspection Orchestration Service (LangGraph Production Layer)
 *
 * Coordinates the end-to-end confidential industrial document inspection
 * workflow through the compiled LangGraph StateGraph.
 *
 * Pipeline Sequencing:
 *   START -> ingest -> retrieve -> extract_findings -> retrieve_sop -> assess_risk -> validate_citations -> generate_report -> END
 *
 * Guarantees:
 * - Multi-tenant isolation: Preserves organizationId across all graph operations
 * - Safety & Integrity: Discards ungrounded/hallucinated findings & citations
 * - API Compatibility: Maps final state exactly to runCompleteWorkflow() response contract
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { compiledInspectionGraph } from "../orchestration/inspection/index.js";

/**
 * Executes the formal LangGraph inspection workflow.
 *
 * @param {string|object} input Target file path, documentId, or descriptor object
 * @param {object} [options] Execution options including sub-service configs
 * @returns {Promise<object>} Result conforming to the legacy runCompleteWorkflow contract
 */
export async function runInspectionWorkflow(input, options = {}) {
    if (!input || (typeof input !== "string" && typeof input !== "object")) {
        throw new TypeError("Target inspection file must be a file path, documentId, or descriptor object");
    }

    let documentId = options.documentId || options.ingestOptions?.documentId;
    let filePath = options.filePath;
    let filename = options.filename || options.ingestOptions?.filename;

    if (typeof input === "string") {
        if (fs.existsSync(input)) {
            filePath = path.resolve(input);
            filename = filename || path.basename(filePath);
        } else {
            // DocumentId string
            documentId = documentId || input.trim();
        }
    } else if (typeof input === "object") {
        documentId = documentId || input.documentId;
        filePath = filePath || input.filePath;
        filename = filename || input.filename;
    }

    const task =
        options.task ||
        input?.task ||
        "Analyze this inspection report and extract all significant findings.";

    const organizationId =
        options.organizationId ||
        options.ingestOptions?.organizationId ||
        null;

    const runId = options.runId || randomUUID();

    // Construct initial state conforming to InspectionAgentState schema
    const initialState = {
        runId,
        documentId: documentId || null,
        filePath: filePath || null,
        task,
        organizationId,
        metadata: {
            input,
            ingestOptions: options.ingestOptions || {},
            analysisOptions: options.analysisOptions || {},
            riskOptions: options.riskOptions || {},
            approvalNoteOptions: options.approvalNoteOptions || {},
            filename,
            ...options.metadata,
        },
    };

    // Invoke compiled LangGraph StateGraph
    const finalState = await compiledInspectionGraph.invoke(initialState);

    // Fail-closed error handling: Propagate failure if graph halted with errors
    if (finalState.status === "failed" || (Array.isArray(finalState.errors) && finalState.errors.length > 0)) {
        const primaryError = finalState.errors[0];
        const error = new Error(primaryError?.message || "Inspection workflow failed during execution");
        error.node = primaryError?.node || finalState.currentNode || "unknown";
        error.executionOrder = finalState.executionOrder;
        error.errors = finalState.errors;
        throw error;
    }

    // Map final InspectionAgentState to established legacy response contract
    const uniqueCitations = finalState.citations || [];
    const riskAssessments = finalState.riskAssessments?.length
        ? finalState.riskAssessments
        : (finalState.riskAssessment ? [finalState.riskAssessment] : []);
    const recommendations = finalState.recommendations?.length
        ? finalState.recommendations
        : (finalState.recommendation ? [finalState.recommendation] : []);

    return {
        documentId: finalState.documentId,
        filename: finalState.ingestionResult?.filename || filename || `${finalState.documentId}.pdf`,
        chunksStored: finalState.ingestionResult?.chunksStored ?? 0,
        findings: finalState.findings || [],
        riskAssessments,
        recommendations,
        citations: uniqueCitations,
        approvalNote: {
            filename: finalState.report?.filename || `Approval_Note_${finalState.documentId}.docx`,
            filePath: finalState.report?.filePath || "",
        },
        orchestration: {
            engine: "langgraph",
            runId: finalState.runId,
            executionOrder: finalState.executionOrder,
            status: finalState.status,
        },
    };
}
