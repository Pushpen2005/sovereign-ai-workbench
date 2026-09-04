import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    analyzeInspectionReport,
    ingestInspectionReport,
} from "../../../ai-service/inspection/inspection.service.js";
import { assessFindingRisk } from "../../../ai-service/risk/risk.service.js";
import { generateApprovalNote } from "../../../ai-service/reports/approval-note.service.js";
import { runInspectionWorkflow } from "./inspection-orchestrator.service.js";

import {
    getOrganizationUploadDir,
    getDocumentStoragePath,
    getReportStoragePath,
    validateFilename,
    UPLOADS_ROOT,
} from "../utils/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const GENERATED_DIR = path.resolve(__dirname, "../../generated");

/**
 * Resolves a file path from documentId, filename, or direct filePath.
 * Enforces organization-scoped upload directory search with safe fallback.
 */
export function resolveInspectionFilePath({ documentId, filename, filePath, organizationId } = {}) {
    if (filePath && typeof filePath === "string") {
        const resolved = path.resolve(filePath);
        if (organizationId) {
            const orgUploadDir = getOrganizationUploadDir(organizationId, { create: false });
            if (resolved.startsWith(UPLOADS_ROOT) && !resolved.startsWith(orgUploadDir)) {
                throw new Error("Access Denied: File path belongs to another tenant or outside organization storage.");
            }
        }
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    if (organizationId && typeof organizationId === "string" && organizationId.trim()) {
        const cleanOrgId = organizationId.trim();
        if (filename && typeof filename === "string") {
            try {
                const targetFile = getDocumentStoragePath(cleanOrgId, filename);
                if (fs.existsSync(targetFile)) {
                    return targetFile;
                }
            } catch {
                // Ignore path validation errors on lookup attempt
            }
        }

        if (documentId && typeof documentId === "string") {
            try {
                const candidatePdf = getDocumentStoragePath(cleanOrgId, `${documentId}.pdf`);
                if (fs.existsSync(candidatePdf)) {
                    return candidatePdf;
                }
                const directCandidate = getDocumentStoragePath(cleanOrgId, documentId);
                if (fs.existsSync(directCandidate)) {
                    return directCandidate;
                }
            } catch {
                // Ignore path validation errors on lookup attempt
            }
        }
    }

    // Fallback search in legacy root uploads for pre-existing fixtures/tests
    if (filename && typeof filename === "string") {
        const directPath = path.resolve(UPLOADS_DIR, filename);
        if (fs.existsSync(directPath)) {
            return directPath;
        }
    }

    if (documentId && typeof documentId === "string") {
        const candidatePdf = path.resolve(UPLOADS_DIR, `${documentId}.pdf`);
        if (fs.existsSync(candidatePdf)) {
            return candidatePdf;
        }

        const directCandidate = path.resolve(UPLOADS_DIR, documentId);
        if (fs.existsSync(directCandidate)) {
            return directCandidate;
        }
    }

    throw new Error(
        `Inspection file could not be found for documentId='${documentId || ""}', filename='${filename || ""}', filePath='${filePath || ""}'`
    );
}

/**
 * Ingests an inspection report into Qdrant using the existing AI pipeline.
 */
export async function ingestInspectionFile(target, options = {}) {
    let targetPath;
    let resolvedDocumentId = options.documentId;
    let resolvedFilename = options.filename;
    const organizationId = options.organizationId;

    if (typeof target === "string") {
        if (fs.existsSync(target)) {
            targetPath = path.resolve(target);
            resolvedFilename = resolvedFilename || path.basename(targetPath);
        } else {
            targetPath = resolveInspectionFilePath({ documentId: target, organizationId });
        }
    } else if (target && typeof target === "object") {
        targetPath = resolveInspectionFilePath({ ...target, organizationId });
        resolvedDocumentId = resolvedDocumentId || target.documentId;
        resolvedFilename = resolvedFilename || target.filename;
    } else {
        throw new TypeError("Target inspection file must be a file path, documentId, or descriptor object");
    }

    const result = await ingestInspectionReport(targetPath, {
        ...options,
        documentId: resolvedDocumentId,
        filename: resolvedFilename,
    });

    return result;
}

/**
 * Analyzes an inspection report to extract significant findings.
 */
export async function runInspectionAnalysis({ documentId, task }, options = {}) {
    if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
        throw new TypeError("documentId must be a non-empty string");
    }

    if (!task || typeof task !== "string" || !task.trim()) {
        throw new TypeError("task must be a non-empty string");
    }

    const result = await analyzeInspectionReport(
        {
            documentId: documentId.trim(),
            task: task.trim(),
        },
        options
    );

    return result;
}

/**
 * Assesses risk and produces recommendations for an inspection finding using SOP retrieval and LLM.
 */
export async function runFindingRiskAssessment(finding, options = {}) {
    return assessFindingRisk(finding, options);
}

/**
 * Generates an Approval Note DOCX from trusted findings and risk assessment.
 */
export async function runApprovalNoteGeneration(data, options = {}) {
    const defaultFilename = options.filename ? validateFilename(options.filename) : "Approval_Note.docx";
    let defaultOutputPath;

    if (options.organizationId && typeof options.organizationId === "string" && options.organizationId.trim()) {
        defaultOutputPath = getReportStoragePath(options.organizationId.trim(), defaultFilename);
    } else {
        if (!fs.existsSync(GENERATED_DIR)) {
            fs.mkdirSync(GENERATED_DIR, { recursive: true });
        }
        defaultOutputPath = path.resolve(GENERATED_DIR, defaultFilename);
    }

    const outputPath = options.outputPath || defaultOutputPath;

    const generatedPath = await generateApprovalNote(data, {
        ...options,
        outputPath,
    });

    return {
        filePath: generatedPath,
        filename: path.basename(generatedPath),
    };
}

/**
 * Legacy imperative inspection workflow implementation (maintained for rollback & equivalence testing).
 */
export async function runLegacyCompleteWorkflow(input, options = {}) {
    // 1. Ingestion
    const ingestionResult = await ingestInspectionFile(input, options.ingestOptions);
    const documentId = ingestionResult.documentId;

    // 2. Inspection Analysis
    const task =
        options.task ||
        input.task ||
        "Analyze this inspection report and extract all significant findings.";

    const analysisResult = await runInspectionAnalysis(
        { documentId, task },
        options.analysisOptions
    );

    const findings = analysisResult.findings || [];

    // 3. Risk Assessment for findings
    const riskAssessments = [];
    const recommendations = [];
    let combinedCitations = [];

    if (findings.length > 0) {
        for (const finding of findings) {
            const riskResult = await runFindingRiskAssessment(
                finding,
                options.riskOptions
            );

            if (riskResult.riskAssessment) {
                riskAssessments.push(riskResult.riskAssessment);
            }

            if (riskResult.recommendation) {
                recommendations.push(riskResult.recommendation);
            }

            if (Array.isArray(riskResult.citations)) {
                combinedCitations.push(...riskResult.citations);
            }
        }
    } else {
        // Safe default if 0 findings extracted
        riskAssessments.push({
            level: null,
            reason: "No significant inspection findings were detected in the report.",
        });
        recommendations.push("Continue standard operating and inspection schedule.");
    }

    // Deduplicate citations
    const seenCitations = new Set();
    const uniqueCitations = combinedCitations.filter((c) => {
        const key = `${c.documentId}:${c.filename}:${c.page}:${c.chunkIndex}`;
        if (seenCitations.has(key)) return false;
        seenCitations.add(key);
        return true;
    });

    // Primary risk assessment & recommendation for Approval Note
    const primaryRisk = riskAssessments[0] || {
        level: null,
        reason: "No risk assessment available.",
    };
    const primaryRecommendation =
        recommendations.join(" ") || "No specific recommendation generated.";

    // 4. Generate Approval Note DOCX
    const docxData = {
        subject: `Inspection Report Analysis and Approval Recommendation — ${documentId}`,
        findings,
        riskAssessment: primaryRisk,
        recommendation: primaryRecommendation,
        citations: uniqueCitations,
    };

    const docxResult = await runApprovalNoteGeneration(
        docxData,
        options.approvalNoteOptions
    );

    return {
        documentId,
        filename: ingestionResult.filename,
        chunksStored: ingestionResult.chunksStored,
        findings,
        riskAssessments,
        recommendations,
        citations: uniqueCitations,
        approvalNote: {
            filename: docxResult.filename,
            filePath: docxResult.filePath,
        },
    };
}

/**
 * Orchestrates the end-to-end inspection workflow from PDF to Approval Note DOCX.
 *
 * Supports feature flag switching via INSPECTION_ORCHESTRATOR environment variable:
 * - "langgraph" (Default): Production LangGraph StateGraph orchestration
 * - "legacy": Imperative promise chain fallback
 */
export async function runCompleteWorkflow(input, options = {}) {
    const orchestratorMode = (
        process.env.INSPECTION_ORCHESTRATOR || "langgraph"
    ).trim().toLowerCase();

    if (orchestratorMode === "legacy") {
        return runLegacyCompleteWorkflow(input, options);
    }

    return runInspectionWorkflow(input, options);
}
