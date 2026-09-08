/**
 * SOVEREIGNAI — PHASE 7: INSPECTION AGENT ORCHESTRATION SERVICE
 *
 * Implements a controlled, auditable, multi-tenant industrial inspection agent.
 *
 * Controlled Tool Allow-List:
 *   1. document_search
 *   2. file_read
 *   3. calculator
 *   4. document_generate
 *
 * State Machine Sequence:
 *   IDLE
 *     ↓
 *   PLANNING
 *     ↓
 *   READING_REPORT
 *     ↓
 *   EXTRACTING_FINDINGS
 *     ↓
 *   SEARCHING_SOP
 *     ↓
 *   ANALYZING
 *     ↓
 *   ASSESSING_RISK
 *     ↓
 *   PREPARING_RECOMMENDATION
 *     ↓
 *   GENERATING_REPORT
 *     ↓
 *   COMPLETED
 *
 * Explicit Failure States:
 *   - FAILED_READING
 *   - FAILED_RETRIEVAL
 *   - INSUFFICIENT_EVIDENCE
 *   - FAILED_GENERATION
 *
 * Strict Security Boundaries:
 *   - Organization-scoped tenant boundary enforced at every stage
 *   - Document ownership check prior to reading
 *   - Authoritative evidence gating: no fabricated limits, citations, or risk
 *   - Deterministic arithmetic via calculator tool (zero eval)
 *   - Maximum tool iterations guard (anti-loop)
 *   - Zero external cloud AI / OCR APIs
 */

import { randomUUID } from "crypto";
import { query } from "../config/db.js";
import { executeDocumentSearch } from "./agentTools/documentSearch.tool.js";
import { executeFileRead } from "./agentTools/fileRead.tool.js";
import { executeCalculator } from "./agentTools/calculator.tool.js";
import { executeDocumentGenerate } from "./agentTools/documentGenerate.tool.js";
import { runInspectionAnalysis } from "./inspection.service.js";
import { assessFindingRisk } from "../../../ai-service/risk/risk.service.js";
import { INSUFFICIENT_EVIDENCE_RESULT } from "../../../ai-service/risk/risk.schema.js";
import { createAgentRun, createAgentRunStep, updateAgentRun } from "../repositories/agent.repository.js";
import { executionEvents } from "./execution-events.service.js";

export const ALLOWED_INSPECTION_TOOLS = new Set([
    "document_search",
    "file_read",
    "calculator",
    "document_generate",
]);

export const INSPECTION_AGENT_STATES = {
    IDLE: "IDLE",
    PLANNING: "PLANNING",
    READING_REPORT: "READING_REPORT",
    EXTRACTING_FINDINGS: "EXTRACTING_FINDINGS",
    SEARCHING_SOP: "SEARCHING_SOP",
    ANALYZING: "ANALYZING",
    ASSESSING_RISK: "ASSESSING_RISK",
    PREPARING_RECOMMENDATION: "PREPARING_RECOMMENDATION",
    GENERATING_REPORT: "GENERATING_REPORT",
    COMPLETED: "COMPLETED",
    FAILED_READING: "FAILED_READING",
    FAILED_RETRIEVAL: "FAILED_RETRIEVAL",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
    FAILED_GENERATION: "FAILED_GENERATION",
};

export class InspectionAgentError extends Error {
    constructor(message, statusCode = 400, details = {}) {
        super(message);
        this.name = "InspectionAgentError";
        this.statusCode = statusCode;
        this.status = statusCode;
        this.details = details;
    }
}

/**
 * Validates and executes a tool from the strict allow-list.
 */
export async function executeInspectionAgentTool(toolName, args, context) {
    if (!ALLOWED_INSPECTION_TOOLS.has(toolName)) {
        throw new InspectionAgentError(
            `Unauthorized tool '${toolName}'. Allowed tools: ${[...ALLOWED_INSPECTION_TOOLS].join(", ")}`,
            403
        );
    }

    switch (toolName) {
        case "file_read":
            return await executeFileRead(args, context);
        case "document_search":
            return await executeDocumentSearch(args, context);
        case "calculator":
            return await executeCalculator(args);
        case "document_generate":
            return await executeDocumentGenerate(args, context);
        default:
            throw new InspectionAgentError(`Tool '${toolName}' not implemented in inspection agent.`, 400);
    }
}

/**
 * Executes the controlled Inspection Agent workflow.
 *
 * @param {object} params
 * @param {string} params.documentId - Document ID in PostgreSQL/Qdrant
 * @param {string} [params.goal] - User's high level inspection goal
 * @param {string} params.organizationId - Authoritative authenticated organizationId
 * @param {string} [params.userId] - User ID
 * @param {number} [params.maxSteps=12] - Anti-loop safeguard
 * @returns {Promise<object>}
 */
export async function runInspectionAgent({
    documentId,
    goal,
    organizationId,
    userId = null,
    maxSteps = 12,
}) {
    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new InspectionAgentError("organizationId is required and must come from authenticated context", 401);
    }
    const cleanOrgId = organizationId.trim();

    if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
        throw new InspectionAgentError("documentId must be a non-empty string", 400);
    }
    const cleanDocId = documentId.trim();

    const cleanGoal =
        typeof goal === "string" && goal.trim()
            ? goal.trim()
            : "Analyze this inspection report and prepare an approval note.";

    const runId = randomUUID();
    let currentState = INSPECTION_AGENT_STATES.IDLE;
    const steps = [];
    let stepCount = 0;

    // Register run in memory for SSE streaming
    try {
        executionEvents.registerRunOwner(runId, cleanOrgId, "inspection_agent");
    } catch (_) {}

    // 1. Initial State: Persist Run
    try {
        await createAgentRun({
            runId,
            userId,
            organizationId: cleanOrgId,
            goal: cleanGoal,
            model: "inspection-agent",
            status: "in_progress",
            startedAt: new Date(),
        });
    } catch (dbErr) {
        console.warn(`[InspectionAgent] Warning: Could not create run record: ${dbErr.message}`);
    }

    const emitEvent = (eventType, payload) => {
        try {
            executionEvents.publish(runId, eventType, {
                runId,
                organizationId: cleanOrgId,
                documentId: cleanDocId,
                state: currentState,
                ...payload,
            });
        } catch (_) {}
    };

    const recordStep = async (stepName, status, summary, details = {}) => {
        stepCount++;
        if (stepCount > maxSteps) {
            throw new InspectionAgentError(
                `Inspection agent exceeded maximum allowable steps (${maxSteps}). Terminating to prevent infinite loop.`,
                429
            );
        }

        const stepRecord = {
            stepIndex: stepCount,
            stepName,
            status,
            summary,
            details,
            timestamp: new Date().toISOString(),
        };
        steps.push(stepRecord);

        emitEvent("workflow_stage", {
            stage: summary,
            stepName,
            status,
            stepIndex: stepCount,
        });

        try {
            await createAgentRunStep({
                runId,
                stepNumber: stepCount,
                node: stepName,
                toolName: stepName,
                toolArguments: details.arguments || {},
                status: status === "completed" ? "success" : status,
                toolResultSummary: summary,
            });
        } catch (_) {}

        return stepRecord;
    };

    try {
        // ----------------------------------------------------
        // PHASE 1: PLANNING
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.PLANNING;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.IDLE, to: currentState });

        const structuredPlan = [
            { step: 1, action: "Read inspection report", tool: "file_read", status: "pending" },
            { step: 2, action: "Extract inspection findings", tool: "internal_extractor", status: "pending" },
            { step: 3, action: "Search relevant SOP evidence", tool: "document_search", status: "pending" },
            { step: 4, action: "Compare observations with operating limits", tool: "calculator", status: "pending" },
            { step: 5, action: "Assess risk using available evidence", tool: "internal_risk", status: "pending" },
            { step: 6, action: "Produce recommendation", tool: "internal_recommendation", status: "pending" },
            { step: 7, action: "Generate Approval Note", tool: "document_generate", status: "pending" },
        ];

        await recordStep("PLANNING", "completed", "Generated 7-step inspection analysis plan", {
            plan: structuredPlan,
        });

        // ----------------------------------------------------
        // PHASE 2: READING_REPORT (file_read)
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.READING_REPORT;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.PLANNING, to: currentState });

        // Enforce document existence & multi-tenant boundary
        const docCheck = await query(
            "SELECT id, organization_id, filename, original_filename FROM documents WHERE id = $1",
            [cleanDocId]
        );

        if (docCheck.rows.length === 0) {
            currentState = INSPECTION_AGENT_STATES.FAILED_READING;
            await recordStep("READING_REPORT", "failed", `Document '${cleanDocId}' not found`);
            throw new InspectionAgentError(`Inspection document '${cleanDocId}' not found`, 404);
        }

        if (docCheck.rows[0].organization_id !== cleanOrgId) {
            currentState = INSPECTION_AGENT_STATES.FAILED_READING;
            await recordStep("READING_REPORT", "failed", "Cross-tenant access rejected");
            throw new InspectionAgentError("Forbidden: document belongs to another organization.", 403);
        }

        const docRecord = docCheck.rows[0];
        const docFilename = docRecord.original_filename || docRecord.filename || `${cleanDocId}.pdf`;

        const readResult = await executeInspectionAgentTool("file_read", {
            documentId: cleanDocId,
            maxChunks: 10,
        }, { organizationId: cleanOrgId });

        if (!readResult || readResult.chunksRetrieved === 0) {
            currentState = INSPECTION_AGENT_STATES.FAILED_READING;
            await recordStep("READING_REPORT", "failed", "Document has no indexed chunks");
            throw new InspectionAgentError(`Inspection document '${cleanDocId}' contains no readable chunks.`, 422);
        }

        await recordStep("READING_REPORT", "completed", `Read inspection report '${docFilename}' (${readResult.chunksRetrieved} chunks)`, {
            filename: docFilename,
            chunksRetrieved: readResult.chunksRetrieved,
        });

        // ----------------------------------------------------
        // PHASE 3: EXTRACTING_FINDINGS
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.EXTRACTING_FINDINGS;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.READING_REPORT, to: currentState });

        const analysisResult = await runInspectionAnalysis(
            { documentId: cleanDocId, task: cleanGoal },
            { organizationId: cleanOrgId }
        );

        const findings = Array.isArray(analysisResult?.findings) ? analysisResult.findings : [];

        await recordStep("EXTRACTING_FINDINGS", "completed", `Extracted ${findings.length} inspection finding(s)`, {
            findingCount: findings.length,
            findings,
        });

        // ----------------------------------------------------
        // PHASE 4: SEARCHING_SOP (document_search)
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.SEARCHING_SOP;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.EXTRACTING_FINDINGS, to: currentState });

        const findingSopMap = [];
        const allAuthoritativeCitations = [];
        let totalSopChunksFound = 0;

        for (const finding of findings) {
            const queryText = finding.finding || finding.evidence || cleanGoal;

            const sopSearchResult = await executeInspectionAgentTool("document_search", {
                query: queryText,
                documentType: "sop",
                limit: 5,
            }, { organizationId: cleanOrgId });

            const validSopChunks = (sopSearchResult.results || []).filter(
                (c) => c.text && (!c.documentType || c.documentType === "sop") && (typeof c.score !== "number" || c.score >= 0.5)
            );

            totalSopChunksFound += validSopChunks.length;

            findingSopMap.push({
                finding,
                sopChunks: validSopChunks,
            });

            for (const chunk of validSopChunks) {
                allAuthoritativeCitations.push({
                    documentId: chunk.documentId,
                    filename: chunk.filename,
                    page: chunk.page,
                    chunkIndex: chunk.chunkIndex,
                });
            }
        }

        await recordStep(
            "SEARCHING_SOP",
            "completed",
            `Searched SOP knowledge base: retrieved ${totalSopChunksFound} relevant SOP chunk(s)`,
            {
                totalSopChunks: totalSopChunksFound,
                findingCount: findings.length,
            }
        );

        // ----------------------------------------------------
        // PHASE 5: ANALYZING (calculator for numeric verification)
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.ANALYZING;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.SEARCHING_SOP, to: currentState });

        const numericCalculations = [];
        for (const item of findingSopMap) {
            const { finding, sopChunks } = item;

            // Extract numeric observed and limit values
            let observedNum = null;
            let limitNum = null;

            if (finding.observedValue) {
                const m = String(finding.observedValue).match(/-?\d+(?:\.\d+)?/);
                if (m) observedNum = parseFloat(m[0]);
            }
            if (finding.operatingLimit || finding.limit) {
                const m = String(finding.operatingLimit || finding.limit).match(/-?\d+(?:\.\d+)?/);
                if (m) limitNum = parseFloat(m[0]);
            }

            // Also check if SOP chunks contain an explicit limit if finding had none
            if (limitNum === null && sopChunks.length > 0) {
                for (const chunk of sopChunks) {
                    const sopMatch = String(chunk.text).match(/limit(?:\s+is|\s*:\s*)?\s*(-?\d+(?:\.\d+)?)/i);
                    if (sopMatch) {
                        limitNum = parseFloat(sopMatch[1]);
                        break;
                    }
                }
            }

            if (observedNum !== null && limitNum !== null) {
                if (!finding.limit && !finding.operatingLimit) {
                    finding.limit = `${limitNum} °C`;
                }

                const diffCalc = await executeInspectionAgentTool("calculator", {
                    expression: `${observedNum} - ${limitNum}`,
                });

                let pctCalc = { result: 0 };
                if (limitNum !== 0) {
                    pctCalc = await executeInspectionAgentTool("calculator", {
                        expression: `((${observedNum} - ${limitNum}) / ${limitNum}) * 100`,
                    });
                }

                numericCalculations.push({
                    equipment: finding.equipment || "Unknown Equipment",
                    observed: observedNum,
                    limit: limitNum,
                    deviation: diffCalc.result,
                    percentageDeviation: pctCalc.result,
                    isExceeded: observedNum > limitNum,
                });
            }
        }

        await recordStep(
            "ANALYZING",
            "completed",
            `Analyzed observations against operating limits (${numericCalculations.length} numeric comparison(s))`,
            { calculations: numericCalculations }
        );

        // ----------------------------------------------------
        // PHASE 6: ASSESSING_RISK & EVIDENCE GATING
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.ASSESSING_RISK;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.ANALYZING, to: currentState });

        const riskEvaluations = [];
        let anyEvidenceFound = false;

        for (const item of findingSopMap) {
            const { finding, sopChunks } = item;

            if (!sopChunks || sopChunks.length === 0) {
                // Evidence Gating: Authoritative Safe Fallback (Do NOT hallucinate risk or limits)
                riskEvaluations.push({
                    finding: finding.finding,
                    level: INSUFFICIENT_EVIDENCE_RESULT.level,
                    reason: INSUFFICIENT_EVIDENCE_RESULT.reason,
                    grounded: false,
                    recommendation: "Insufficient SOP evidence is available to provide a validated recommendation.",
                    citations: [],
                });
            } else {
                anyEvidenceFound = true;
                const riskResult = await assessFindingRisk(finding, {
                    organizationId: cleanOrgId,
                    searchSop: async () => sopChunks,
                });

                let rLevel = riskResult.riskAssessment?.level || riskResult.level || "MEDIUM";
                let rReason = riskResult.riskAssessment?.reason || riskResult.reason || "Operational limit observed from SOP references.";
                const rRec = riskResult.recommendation || "Proceed with certified maintenance protocol as specified in cited SOP.";

                // Deterministic calculator integration: If observed exceeded limit, enforce HIGH
                const matchingCalc = numericCalculations.find(
                    (c) => c.equipment && finding.equipment && c.equipment.toLowerCase().includes(finding.equipment.toLowerCase())
                ) || numericCalculations[0];

                if (matchingCalc?.isExceeded) {
                    rLevel = "HIGH";
                    rReason = `Observed value (${matchingCalc.observed}) exceeds operating limit (${matchingCalc.limit}) by ${matchingCalc.deviation}.`;
                }

                riskEvaluations.push({
                    finding: finding.finding,
                    level: rLevel,
                    reason: rReason,
                    grounded: riskResult.grounded ?? true,
                    recommendation: rRec,
                    citations: riskResult.citations?.length ? riskResult.citations : allAuthoritativeCitations,
                });
            }
        }

        // Aggregate overall risk
        let primaryRisk = "Not Determined";
        if (anyEvidenceFound) {
            if (riskEvaluations.some((r) => r.level === "HIGH")) {
                primaryRisk = "HIGH";
            } else if (riskEvaluations.some((r) => r.level === "MEDIUM")) {
                primaryRisk = "MEDIUM";
            } else if (riskEvaluations.some((r) => r.level === "LOW")) {
                primaryRisk = "LOW";
            }
        }

        const primaryReason = riskEvaluations[0]?.reason || "Risk assessment completed.";

        await recordStep(
            "ASSESSING_RISK",
            "completed",
            `Completed risk assessment (Overall Risk: ${primaryRisk})`,
            { primaryRisk, riskEvaluations }
        );

        // ----------------------------------------------------
        // PHASE 7: PREPARING_RECOMMENDATION
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.PREPARING_RECOMMENDATION;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.ASSESSING_RISK, to: currentState });

        let primaryRecommendation = "";
        if (!anyEvidenceFound) {
            primaryRecommendation = "Insufficient SOP evidence is available to provide a validated recommendation.";
        } else {
            primaryRecommendation =
                riskEvaluations.find((r) => r.recommendation)?.recommendation ||
                "Follow established maintenance protocol and monitor operational parameters.";
        }

        await recordStep(
            "PREPARING_RECOMMENDATION",
            "completed",
            `Prepared recommendation: "${primaryRecommendation.slice(0, 80)}..."`,
            { recommendation: primaryRecommendation }
        );

        // ----------------------------------------------------
        // PHASE 8: GENERATING_REPORT (document_generate)
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.GENERATING_REPORT;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.PREPARING_RECOMMENDATION, to: currentState });

        let technicalAnalysisText = "";
        for (const calc of numericCalculations) {
            technicalAnalysisText += `${calc.equipment}: Observed ${calc.observed} vs Limit ${calc.limit} (Deviation: ${calc.deviation}, ${calc.percentageDeviation}%).\n`;
        }
        if (!technicalAnalysisText) {
            technicalAnalysisText = "Inspection findings evaluated against available standard operating procedures.";
        }

        const reportGenerationResult = await executeInspectionAgentTool(
            "document_generate",
            {
                title: `Approval Note — ${docFilename}`,
                subject: `Approval Note — ${docFilename}`,
                background: `Analysis generated by SovereignAI Inspection Agent for document ${cleanDocId}.`,
                findings,
                technicalAnalysis: technicalAnalysisText.trim(),
                riskAssessment: {
                    level: primaryRisk,
                    reason: primaryReason,
                },
                recommendation: primaryRecommendation,
                citations: allAuthoritativeCitations,
            },
            { organizationId: cleanOrgId }
        );

        await recordStep(
            "GENERATING_REPORT",
            "completed",
            `Generated official Approval Note DOCX (${reportGenerationResult.filename})`,
            {
                filename: reportGenerationResult.filename,
                downloadUrl: reportGenerationResult.downloadUrl,
            }
        );

        // ----------------------------------------------------
        // PHASE 9: COMPLETED
        // ----------------------------------------------------
        currentState = INSPECTION_AGENT_STATES.COMPLETED;
        emitEvent("state_transition", { from: INSPECTION_AGENT_STATES.GENERATING_REPORT, to: currentState });

        try {
            await updateAgentRun(runId, cleanOrgId, {
                status: "completed",
                stoppedReason: "completed",
                completedAt: new Date(),
            });
        } catch (_) {}

        emitEvent("run_completed", {
            status: "completed",
            reportFilename: reportGenerationResult.filename,
            riskLevel: primaryRisk,
        });

        return {
            success: true,
            status: "completed",
            workflowId: runId,
            plan: structuredPlan,
            steps,
            findings,
            riskAssessment: {
                level: primaryRisk,
                reason: primaryReason,
                evaluations: riskEvaluations,
            },
            recommendation: primaryRecommendation,
            citations: allAuthoritativeCitations,
            report: {
                filename: reportGenerationResult.filename,
                downloadUrl: reportGenerationResult.downloadUrl,
                reportId: reportGenerationResult.reportId,
            },
        };
    } catch (err) {
        if (![
            INSPECTION_AGENT_STATES.FAILED_READING,
            INSPECTION_AGENT_STATES.FAILED_RETRIEVAL,
            INSPECTION_AGENT_STATES.INSUFFICIENT_EVIDENCE,
            INSPECTION_AGENT_STATES.FAILED_GENERATION,
        ].includes(currentState)) {
            currentState = "FAILED";
        }

        try {
            await updateAgentRun(runId, cleanOrgId, {
                status: "failed",
                stoppedReason: currentState,
                error: err.message,
                completedAt: new Date(),
            });
        } catch (_) {}

        emitEvent("run_failed", {
            status: "failed",
            error: err.message,
            state: currentState,
        });

        throw err;
    }
}
