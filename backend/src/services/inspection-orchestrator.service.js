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
    console.log(`[INSPECTION_STARTED] Starting inspection pipeline runId=${runId}`);
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

    // Stage labels conforming to Phase 6
    const STAGE_LABELS = {
        ingest: "Reading inspection report",
        retrieve: "Reading inspection report",
        extract_findings: "Extracting observations",
        validate_findings: "Validating observations",
        retry_extraction: "Retrying findings extraction",
        retrieve_sop: "Searching Knowledge Base",
        check_sop_evidence: "Validating evidence",
        assess_risk: "Assessing risk",
        validate_risk: "Preparing recommendation",
        validate_citations: "Validating citations",
        generate_report: "Generating approval note",
        insufficient_evidence: "Evidence insufficient",
    };

    const SSE_STAGES = {
        ingest: { stage: "READING_REPORT", message: "Reading inspection report" },
        retrieve: { stage: "READING_REPORT", message: "Reading inspection report" },
        extract_findings: { stage: "EXTRACTING_FINDINGS", message: "Extracting candidate observations" },
        validate_findings: { stage: "EXTRACTING_FINDINGS", message: "Validating observations" },
        retrieve_sop: { stage: "SEARCHING_KB", message: "Searching Knowledge Base for relevant SOP evidence" },
        check_sop_evidence: { stage: "VALIDATING_SOP_EVIDENCE", message: "Validating retrieved SOP evidence" },
        assess_risk: { stage: "ANALYSING_RISK", message: "Assessing risk level for validated findings" },
        validate_risk: { stage: "PREPARING_RECOMMENDATION", message: "Preparing actionable recommendations" },
        validate_citations: { stage: "PREPARING_RECOMMENDATION", message: "Validating citations" },
        generate_report: { stage: "GENERATING_APPROVAL_NOTE", message: "Generating approval note document" },
        insufficient_evidence: { stage: "INSUFFICIENT_EVIDENCE", message: "Insufficient Knowledge Base evidence found" },
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

                    
                    switch(nodeName) {
                        case 'ingest': console.log(`[INSPECTION_DOCUMENT_VALIDATED] documentId=${finalState.documentId}`); break;
                        case 'retrieve': console.log(`[INSPECTION_TEXT_LOADED]`); break;
                        case 'extract_findings': console.log(`[FINDINGS_EXTRACTED] count=${finalState.findings?.length || 0}`); break;
                        case 'validate_findings': console.log(`[FINDINGS_VALIDATED] valid=${finalState.findingValidation?.isValid || false}`); break;
                        case 'retrieve_sop': console.log(`[KB_SOP_SEARCH_STARTED]\n[KB_SOP_SEARCH_COMPLETED] candidates=${finalState.sopEvidence?.length || 0}`); break;
                        case 'check_sop_evidence': console.log(`[SOP_EVIDENCE_VALIDATED] validated_count=${finalState.findings?.length || 0}`); break;
                        case 'assess_risk': console.log(`[RISK_ANALYSIS_STARTED]\n[RISK_ANALYSIS_COMPLETED]\n[RECOMMENDATION_STARTED]\n[RECOMMENDATION_COMPLETED]`); break;
                        case 'validate_risk': if(!finalState.riskValidation?.isValid) console.log('[RISK_VALIDATION_FAILED]'); break;
                        case 'validate_citations': console.log(`[APPROVAL_NOTE_GENERATION_STARTED]`); break;
                        case 'generate_report': console.log(`[APPROVAL_NOTE_GENERATED] filename=${finalState.report?.filename || "none"}`); break;
                        case 'insufficient_evidence': console.log(`[INSUFFICIENT_SOP_EVIDENCE]`); break;
                        case 'safe_failure': console.log(`[INSPECTION_FAILED]`); break;
                    }

                    if (SSE_STAGES[nodeName]) {
                        executionEvents.publish(runId, "inspection_stage", {
                            runId,
                            stage: SSE_STAGES[nodeName].stage,
                            status: "running",
                            message: SSE_STAGES[nodeName].message,
                        });
                    }

                    if (STAGE_LABELS[nodeName]) {
                        executionEvents.publish(runId, "workflow_stage", {
                            runId,
                            node: nodeName,
                            stage: STAGE_LABELS[nodeName],
                        });
                    }

                    if (nodeName === "extract_findings" && stateSnapshot.findings?.length > 0) {
                        executionEvents.publish(runId, "observations_extracted", {
                            runId,
                            observations: stateSnapshot.findings,
                        });
                    } else if (nodeName === "validate_findings") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "validate_findings",
                            valid: stateSnapshot.findingValidation?.valid ?? stateSnapshot.findingValidation?.isValid,
                            observationsCount: stateSnapshot.findings?.length || 0,
                        });
                    } else if (nodeName === "retrieve_sop" && stateSnapshot.sopEvidence?.length > 0) {
                        executionEvents.publish(runId, "sop_matched", {
                            runId,
                            sopEvidence: stateSnapshot.sopEvidence.map((c) => ({
                                documentId: c.documentId,
                                filename: c.filename,
                                page: c.page,
                                chunkIndex: c.chunkIndex,
                                score: c.score,
                                text: typeof c.text === "string" ? c.text.slice(0, 400) : "",
                            })),
                        });
                    } else if (nodeName === "check_sop_evidence") {
                        executionEvents.publish(runId, "validation", {
                            runId,
                            validator: "check_sop_evidence",
                            status: stateSnapshot.sopEvidenceStatus,
                        });
                        // Publish validated findings only when confirmed by evidence gate
                        if (stateSnapshot.sopEvidenceStatus === "EVIDENCE_FOUND" && stateSnapshot.findings?.length > 0) {
                            executionEvents.publish(runId, "findings_extracted", {
                                runId,
                                findings: stateSnapshot.findings,
                            });
                        }
                    } else if (nodeName === "assess_risk") {
                        executionEvents.publish(runId, "risk_assessed", {
                            runId,
                            riskAssessment: stateSnapshot.riskAssessment || stateSnapshot.riskAssessments?.[0] || null,
                            riskAssessments: stateSnapshot.riskAssessments || [],
                            recommendation: stateSnapshot.recommendation || stateSnapshot.recommendations?.[0] || null,
                            recommendations: stateSnapshot.recommendations || [],
                            citations: stateSnapshot.citations || [],
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
                            stage: "Generating approval note",
                        });
                        if (stateSnapshot.report?.filename) {
                            executionEvents.publish(runId, "report_generated", {
                                runId,
                                reportFilename: stateSnapshot.report.filename,
                            });
                        }
                    } else if (nodeName === "insufficient_evidence") {
                        executionEvents.publish(runId, "inspection_error", {
                            stage: "VALIDATING_SOP_EVIDENCE",
                            code: "INSUFFICIENT_EVIDENCE",
                            message: stateSnapshot.failureReason || "No relevant SOP evidence was found in the Knowledge Base"
                        });
                        executionEvents.publish(runId, "workflow_stage", {
                            runId,
                            node: "insufficient_evidence",
                            stage: "Evidence insufficient",
                        });
                        executionEvents.publish(runId, "run_stopped", {
                            runId,
                            node: "insufficient_evidence",
                            outcome: "INSUFFICIENT_EVIDENCE",
                            reason: stateSnapshot.failureReason || "Analysis stopped because no sufficiently relevant Knowledge Base evidence was found.",
                            findings: [],
                            risk: null,
                            recommendation: null,
                            approvalNote: null,
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

    // Map final InspectionAgentState to established response contract
    const uniqueCitations = finalState.citations || [];
    const finalFindings = finalState.validatedFindings || finalState.findings || [];
    const finalSopEvidence = finalState.validatedSopEvidence || finalState.sopEvidence || [];
    const riskAssessments = finalState.riskAssessments?.length
        ? finalState.riskAssessments
        : (finalState.riskAssessment || finalState.risk ? [finalState.riskAssessment || finalState.risk] : []);
    const recommendations = finalState.recommendations?.length
        ? finalState.recommendations
        : (finalState.recommendation ? [finalState.recommendation] : []);

    const primaryRisk = finalState.risk || finalState.riskAssessment || riskAssessments[0] || null;
    const primaryRec = finalState.recommendation || recommendations[0] || null;

    const approvalNote = finalState.report?.filename
        ? {
            filename: finalState.report.filename,
            filePath: finalState.report.filePath || "",
            fileSize: finalState.report.fileSize || 0,
            reportId: finalState.report.reportId || finalState.reportId || null,
            downloadUrl: finalState.report.downloadUrl || `/api/v1/inspection/download/${encodeURIComponent(finalState.report.filename)}`,
        }
        : (finalState.approvalNote?.filename
            ? {
                filename: finalState.approvalNote.filename,
                filePath: finalState.approvalNote.filePath || "",
                fileSize: finalState.approvalNote.fileSize || 0,
                reportId: finalState.approvalNote.reportId || finalState.reportId || null,
                downloadUrl: finalState.approvalNote.downloadUrl || `/api/v1/inspection/download/${encodeURIComponent(finalState.approvalNote.filename)}`,
            }
            : {
                filename: null,
                filePath: null,
                fileSize: 0,
                downloadUrl: null,
            });

    console.log(`[FINAL_INSPECTION_STATE] validatedFindings=${finalFindings.length} sopEvidence=${finalSopEvidence.length} riskPresent=${!!primaryRisk} recommendationPresent=${!!primaryRec}`);

    // Section 13: SSE COMPLETED RULE
    // NEVER emit COMPLETED if outcome is INSUFFICIENT_EVIDENCE or if DOCX does not physically exist
    const isInsufficientEvidence = finalState.workflowOutcome === "INSUFFICIENT_EVIDENCE" || finalFindings.length === 0;

    if (isInsufficientEvidence) {
        if (organizationId) {
            try {
                await updateAgentRun(runId, organizationId, {
                    status: "stopped",
                    stoppedReason: "INSUFFICIENT_EVIDENCE",
                    completedAt: new Date(),
                });
            } catch (dbErr) {
                console.warn("[InspectionOrchestrator] Warning: Failed to persist inspection run stop:", dbErr.message);
            }
        }

        return {
            documentId: finalState.documentId,
            filename: finalState.ingestionResult?.filename || filename || `${finalState.documentId}.pdf`,
            chunksStored: finalState.ingestionResult?.chunksStored ?? 0,
            findings: [],
            validatedFindings: [],
            risk: null,
            riskAssessment: null,
            riskAssessments: [],
            recommendation: null,
            recommendations: [],
            citations: [],
            sopEvidence: [],
            validatedSopEvidence: [],
            approvalNote: null,
            downloadUrl: null,
            workflowOutcome: "INSUFFICIENT_EVIDENCE",
            orchestration: {
                engine: "langgraph",
                runId: finalState.runId,
                executionOrder: finalState.executionOrder,
                status: "completed",
                workflowOutcome: "INSUFFICIENT_EVIDENCE",
                failureReason: finalState.failureReason || "Analysis stopped because no sufficiently relevant Knowledge Base evidence was found.",
            },
        };
    }

    // Verify physical DOCX file existence and non-zero size before emitting COMPLETED
    let docxPhysicallyVerified = false;
    if (approvalNote.filePath) {
        try {
            const fsModule = await import("fs");
            if (fsModule.existsSync(approvalNote.filePath) && fsModule.statSync(approvalNote.filePath).size > 0) {
                docxPhysicallyVerified = true;
            }
        } catch {
            docxPhysicallyVerified = false;
        }
    }

    const isDeliverableReady =
        finalFindings.length > 0 &&
        finalSopEvidence.length > 0 &&
        primaryRisk !== null &&
        primaryRec !== null &&
        (approvalNote.reportId || finalState.reportId) &&
        approvalNote.downloadUrl &&
        docxPhysicallyVerified;

    if (isDeliverableReady) {
        try {
            console.log(`[INSPECTION_COMPLETED]`);
            executionEvents.publish(runId, "inspection_stage", {
                runId,
                stage: "COMPLETED",
                status: "completed",
                message: "Inspection workflow completed successfully"
            });
            executionEvents.publish(runId, "run_completed", {
                runId,
                status: "completed",
                documentId: finalState.documentId,
                workflowOutcome: "SUCCESS",
                reportId: approvalNote.reportId || finalState.reportId,
                reportFilename: approvalNote.filename,
                downloadUrl: approvalNote.downloadUrl,
            });
        } catch {
            // Non-blocking
        }
    } else {
        console.warn(`[INSPECTION_INCOMPLETE] Physical verification failed or deliverables missing: docxPhysicallyVerified=${docxPhysicallyVerified}`);
        finalState.workflowOutcome = "FAILURE";
    }

    if (organizationId) {
        try {
            await updateAgentRun(runId, organizationId, {
                status: isDeliverableReady ? "completed" : "failed",
                stoppedReason: isDeliverableReady ? (finalState.workflowOutcome || "completed") : "FAILURE",
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
        findings: finalFindings,
        validatedFindings: finalFindings,
        sopEvidence: finalSopEvidence,
        validatedSopEvidence: finalSopEvidence,
        risk: primaryRisk,
        riskAssessment: primaryRisk,
        riskAssessments,
        recommendation: primaryRec,
        recommendations,
        citations: uniqueCitations,
        approvalNote: isDeliverableReady && approvalNote.filename ? approvalNote : null,
        reportId: isDeliverableReady ? (approvalNote.reportId || finalState.reportId) : null,
        downloadUrl: isDeliverableReady ? (approvalNote.downloadUrl || null) : null,
        workflowOutcome: isDeliverableReady ? (finalState.workflowOutcome || "SUCCESS") : "FAILURE",
        orchestration: {
            engine: "langgraph",
            runId: finalState.runId,
            executionOrder: finalState.executionOrder,
            status: isDeliverableReady ? "completed" : "failed",
            workflowOutcome: isDeliverableReady ? (finalState.workflowOutcome || "SUCCESS") : "FAILURE",
            failureReason: isDeliverableReady ? null : (finalState.failureReason || "Approval Note DOCX was not verified on disk"),
        },
    };
}
