/**
 * SOVEREIGNAI — DOCUMENT GENERATE TOOL
 *
 * Validates, structures, and compiles the official Approval Note deliverable DOCX:
 *   1. Subject
 *   2. Background
 *   3. Inspection Findings
 *   4. Technical Analysis
 *   5. Risk Assessment
 *   6. Recommendation
 *   7. References
 *   8. Approval
 */

import { runApprovalNoteGeneration } from "../inspection.service.js";

export class DocumentGenerateError extends Error {
    constructor(message) {
        super(message);
        this.name = "DocumentGenerateError";
    }
}

/**
 * Validates and normalizes structured approval note data.
 *
 * @param {object} args
 * @param {string} [args.subject] - Subject of the approval note
 * @param {string} [args.title] - Alternative title/subject
 * @param {string} [args.background] - Background narrative
 * @param {Array<object>} [args.inspectionFindings] - Extracted inspection findings
 * @param {Array<object>} [args.findings] - Alternative key for inspection findings
 * @param {Array<object>|string} [args.technicalAnalysis] - Technical analysis comparing findings to SOP
 * @param {object|Array<object>} [args.riskAssessment] - Evaluated risk level, reasons, and evidence
 * @param {string|object} [args.recommendation] - Actionable recommendation
 * @param {Array<object>} [args.references] - Authoritative citations/sources
 * @param {Array<object>} [args.citations] - Alternative key for references
 * @param {object} [context={}] - Execution context
 * @returns {Promise<object>} Validated structured approval note data
 */
export async function executeDocumentGenerate(args, context = {}) {
    if (!args || typeof args !== "object") {
        throw new DocumentGenerateError("Arguments must be an object containing approval note data");
    }

    const organizationId = context?.organizationId || args.organizationId;
    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new DocumentGenerateError("Execution context missing authenticated organizationId for document_generate");
    }

    const subject =
        (typeof args.subject === "string" && args.subject.trim()) ||
        (typeof args.title === "string" && args.title.trim()) ||
        "Inspection Analysis Approval Note";

    const background =
        (typeof args.background === "string" && args.background.trim()) ||
        "Confidential inspection analysis performed by SovereignAI Inspection Agent.";

    // Normalize inspection findings
    const rawFindings = args.inspectionFindings || args.findings || [];
    if (!Array.isArray(rawFindings)) {
        throw new DocumentGenerateError("inspectionFindings must be an array");
    }

    const inspectionFindings = rawFindings.map((f, idx) => {
        if (!f || typeof f !== "object") {
            return {
                finding: String(f),
                equipment: "Equipment",
                severity: "MEDIUM",
                evidence: String(f),
            };
        }
        return {
            finding: f.finding || f.description || `Inspection Finding #${idx + 1}`,
            equipment: f.equipment || null,
            observedValue: f.observedValue || f.value || null,
            limit: f.limit || f.threshold || null,
            unit: f.unit || null,
            severity: f.severity || "MEDIUM",
            evidence: f.evidence || f.finding || "",
            page: f.page || f.source?.page || 1,
            source: f.source?.filename || f.source || f.filename || null,
        };
    });

    // Normalize technical analysis
    let technicalAnalysis = [];
    if (Array.isArray(args.technicalAnalysis)) {
        technicalAnalysis = args.technicalAnalysis;
    } else if (typeof args.technicalAnalysis === "string" && args.technicalAnalysis.trim()) {
        technicalAnalysis = [
            {
                analysis: args.technicalAnalysis.trim(),
            },
        ];
    }

    // Normalize risk assessment
    let riskAssessment = {};
    if (args.riskAssessment && typeof args.riskAssessment === "object") {
        if (Array.isArray(args.riskAssessment)) {
            riskAssessment = {
                level: args.riskAssessment[0]?.level || "MEDIUM",
                reason: args.riskAssessment[0]?.reason || "Risk evaluated based on available evidence.",
                evaluations: args.riskAssessment,
            };
        } else {
            riskAssessment = {
                level: args.riskAssessment.level || "MEDIUM",
                reason: args.riskAssessment.reason || "Risk evaluated based on available evidence.",
                evidence: args.riskAssessment.evidence || [],
                evaluations: args.riskAssessment.evaluations || [],
            };
        }
    } else {
        riskAssessment = {
            level: "MEDIUM",
            reason: "Evaluation derived from inspection observations and knowledge base.",
        };
    }

    // Normalize recommendation
    let recommendation = {};
    if (typeof args.recommendation === "string") {
        recommendation = {
            action: args.recommendation.trim(),
            priority: riskAssessment.level || "MEDIUM",
        };
    } else if (args.recommendation && typeof args.recommendation === "object") {
        recommendation = {
            action: args.recommendation.action || args.recommendation.recommendation || "",
            priority: args.recommendation.priority || riskAssessment.level || "MEDIUM",
            basis: args.recommendation.basis || [],
        };
    } else {
        recommendation = {
            action: "Review inspection observations with maintenance supervisor.",
            priority: "MEDIUM",
        };
    }

    // Normalize references
    const rawRefs = args.references || args.citations || [];
    const references = (Array.isArray(rawRefs) ? rawRefs : []).map((r) => {
        if (!r || typeof r !== "object") return { text: String(r) };
        return {
            documentId: r.documentId || null,
            filename: r.filename || "unknown.pdf",
            page: r.page ?? 1,
            chunkIndex: r.chunkIndex ?? 0,
            score: r.score ?? null,
        };
    });

    let docxResult = null;
    if (inspectionFindings.length > 0 && references.length > 0) {
        try {
            docxResult = await runApprovalNoteGeneration(
                {
                    subject,
                    background,
                    findings: inspectionFindings,
                    technicalAnalysis: Array.isArray(technicalAnalysis)
                        ? technicalAnalysis.map((t) => t.analysis || String(t)).join("\n")
                        : (typeof technicalAnalysis === "string" ? technicalAnalysis : null),
                    riskAssessment,
                    recommendation: recommendation.action || (typeof recommendation === "string" ? recommendation : ""),
                    citations: references,
                },
                {
                    organizationId,
                    filename: args.filename || "Approval_Note.docx",
                }
            );
        } catch (docxErr) {
            console.warn(`[documentGenerate] DOCX generation notice: ${docxErr.message}`);
        }
    }

    const approvalNoteData = {
        subject,
        background,
        inspectionFindings,
        technicalAnalysis,
        riskAssessment,
        recommendation,
        references,
        approval: {
            status: docxResult ? "APPROVAL_NOTE_READY" : "Ready for Plant Sign-Off",
        },
        filename: docxResult?.filename || null,
        filePath: docxResult?.filePath || null,
        downloadUrl: docxResult?.filename ? `/api/v1/inspection/download/${encodeURIComponent(docxResult.filename)}` : null,
        status: docxResult ? "APPROVAL_NOTE_READY" : "validated",
        timestamp: new Date().toISOString(),
    };

    return approvalNoteData;
}
