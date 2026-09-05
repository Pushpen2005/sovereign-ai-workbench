/**
 * Inspection Orchestration Service (LangGraph Production Layer)
 *
 * Coordinates the end-to-end confidential industrial document inspection
 * workflow through the compiled LangGraph StateGraph, with real-time SSE streaming.
 *
 * Pipeline Sequencing:
 *   START -> ingest -> retrieve -> extract_findings -> validate_findings
 *         -> retry_extraction? -> retrieve_sop -> check_sop_evidence
 *         -> assess_risk -> validate_risk -> validate_citations -> generate_report -> END
 *
 * Guarantees:
 * - Multi-tenant isolation: Preserves organizationId across all graph operations
 * - Safety & Integrity: Discards ungrounded/hallucinated findings & citations
 * - Real-time SSE Streaming: Publishes node events and validation transitions
 * - Non-blocking Observability: SSE broadcast failures never fail active inspection
 * - API Compatibility: Maps final state exactly to runCompleteWorkflow() response contract
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { compiledInspectionGraph } from "../orchestration/inspection/index.js";
import { executionEvents } from "./execution-events.service.js";
import { createAgentRun, updateAgentRun } from "../repositories/agent.repository.js";

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

    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new Error("organizationId is mandatory in workflow options for tenant isolation");
    }

    const runId = options.runId || randomUUID();

    // 1. Register tenant ownership for run (in-memory cache & PostgreSQL)
    try {
        executionEvents.registerRunOwner(runId, organizationId, "inspection");
        await createAgentRun({
            runId,
            userId: options.userId || null,
            organizationId,
            goal: task,
            model: "inspection-workflow",
            status: "in_progress",
            startedAt: new Date(),
        });
    } catch (dbErr) {
        console.warn("[InspectionOrchestrator] Warning: Failed to persist inspection run initiation:", dbErr.message);
    }

    // 2. Publish run_started SSE event
    try {
        executionEvents.publish(runId, "run_started", {
            runId,
            engine: "langgraph",
            workflow: "inspection",
            status: "in_progress",
            documentId: documentId || null,
            filename: filename || null,
        });
    } catch {
        // Non-blocking
    }

    // Construct initial state conforming to InspectionAgentState schema
    const initialState = {
        runId,
        documentId: documentId || null,
        filePath: filePath || null,
        task,
        organizationId,
        userId: options.userId || null,
        extractionAttempts: 1,
        maxExtractionAttempts: 2,
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

    // Stage labels conforming to Phase 6 Step 17
    const STAGE_LABELS = {
        ingest: "Reading inspection report",
        retrieve: "Reading inspection report",
        extract_findings: "Extracting findings",
        validate_findings: "Validating findings",
        retry_extraction: "Retrying findings extraction",
        retrieve_sop: "Searching SOP",
        check_sop_evidence: "Validating SOP evidence",
        assess_risk: "Assessing risk",
        validate_risk: "Preparing recommendation",
        validate_citations: "Validating citations",
        generate_report: "Generating approval note",
    };

    // 3. Stream compiled LangGraph StateGraph snapshots in real-time
    let finalState = { ...initialState };
    let executionError = null;
    let lastHandledNode = null;

    try {
        for await (const stateSnapshot of await compiledInspectionGraph.stream(initialState, { streamMode: "values" })) {
            finalState = stateSnapshot;
            const nodeName = stateSnapshot.currentNode;

            if (nodeName && nodeName !== lastHandledNode) {
                lastHandledNode = nodeName;

                try {
                    executionEvents.publish(runId, "node_started", { runId, node: nodeName });
                    executionEvents.publish(runId, "node_completed", { runId, node: nodeName });

                    if (STAGE_LABELS[nodeName]) {
                        executionEvents.publish(runId, "workflow_stage", {
                            runId,
                            node: nodeName,
                            stage: STAGE_LABELS[nodeName],
                        });
                    }

                    if (nodeName === "validate_findings") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "validate_findings",
                            valid: stateSnapshot.findingValidation?.valid ?? stateSnapshot.findingValidation?.isValid,
                            findingsCount: stateSnapshot.findings?.length || 0,
                        });
                    } else if (nodeName === "check_sop_evidence") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "check_sop_evidence",
                            status: stateSnapshot.sopEvidenceStatus,
                        });
                    } else if (nodeName === "validate_risk") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "validate_risk",
                            valid: stateSnapshot.riskValidation?.isValid ?? stateSnapshot.riskValidation?.valid,
                        });
                    } else if (nodeName === "validate_citations") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "validate_citations",
                            valid: stateSnapshot.citationValidation?.isValid ?? true,
                            citationsCount: stateSnapshot.citations?.length || 0,
                        });
                    } else if (nodeName === "generate_report") {
                        executionEvents.publish(runId, "workflow_stage", {
                            runId,
                            node: "generate_report",
                            stage: "Validating report",
                        });
                    } else if (nodeName === "insufficient_evidence") {
                        executionEvents.publish(runId, "run_stopped", {
                            runId,
                            node: "insufficient_evidence",
                            outcome: "INSUFFICIENT_EVIDENCE",
                            reason: stateSnapshot.failureReason,
                        });
                    } else if (nodeName === "safe_failure") {
                        executionEvents.publish(runId, "run_failed", {
                            runId,
                            node: "safe_failure",
                            outcome: "SAFE_FAILURE",
                            reason: stateSnapshot.failureReason,
                        });
                    }
                } catch {
                    // Non-blocking
                }
            }
        }
    } catch (err) {
        executionError = err;
    }

    // 4. Fail-closed error handling: Propagate failure if graph halted with errors or safe failure
    if (
        executionError ||
        finalState.status === "failed" ||
        finalState.workflowOutcome === "SAFE_FAILURE" ||
        (Array.isArray(finalState.errors) && finalState.errors.length > 0)
    ) {
        const primaryError = finalState.errors?.[0];
        const errorMsg =
            executionError?.message ||
            finalState.failureReason ||
            primaryError?.message ||
            "Inspection workflow failed during execution";

        try {
            executionEvents.publish(runId, "run_failed", {
                runId,
                status: "failed",
                workflowOutcome: finalState.workflowOutcome || "SAFE_FAILURE",
                reason: errorMsg,
            });
        } catch {
            // Non-blocking
        }

        if (organizationId) {
            try {
                await updateAgentRun(runId, organizationId, {
                    status: "failed",
                    stoppedReason: finalState.workflowOutcome || "safe_failure",
                    error: errorMsg,
                    completedAt: new Date(),
                });
            } catch (dbErr) {
                console.warn("[InspectionOrchestrator] Warning: Failed to persist inspection run failure:", dbErr.message);
            }
        }

        const error = new Error(errorMsg);
        error.node = primaryError?.node || finalState.currentNode || "unknown";
        error.executionOrder = finalState.executionOrder;
        error.errors = finalState.errors;
        error.workflowOutcome = finalState.workflowOutcome || "SAFE_FAILURE";
        error.failureReason = finalState.failureReason;
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

    const approvalNote = finalState.report?.filename
        ? {
            filename: finalState.report.filename,
            filePath: finalState.report.filePath || "",
        }
        : {
            filename: null,
            filePath: null,
        };

    // 5. Publish terminal run_completed SSE event
    try {
        executionEvents.publish(runId, "run_completed", {
            runId,
            status: "completed",
            documentId: finalState.documentId,
            workflowOutcome: finalState.workflowOutcome || "SUCCESS",
            reportFilename: approvalNote.filename,
        });
    } catch {
        // Non-blocking
    }

    if (organizationId) {
        try {
            await updateAgentRun(runId, organizationId, {
                status: "completed",
                stoppedReason: finalState.workflowOutcome || "completed",
                completedAt: new Date(),
            });
        } catch (dbErr) {
            console.warn("[InspectionOrchestrator] Warning: Failed to persist inspection run completion:", dbErr.message);
        }
    }

    return {
        documentId: finalState.documentId,
        filename: finalState.ingestionResult?.filename || filename || `${finalState.documentId}.pdf`,
        chunksStored: finalState.ingestionResult?.chunksStored ?? 0,
        findings: finalState.findings || [],
        riskAssessments,
        recommendations,
        citations: uniqueCitations,
        approvalNote,
        orchestration: {
            engine: "langgraph",
            runId: finalState.runId,
            executionOrder: finalState.executionOrder,
            status: finalState.status,
            workflowOutcome: finalState.workflowOutcome || "SUCCESS",
            failureReason: finalState.failureReason || null,
        },
    };
}
