import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    analyzeInspectionReport,
    ingestInspectionReport,
} from "../../../ai-service/inspection/inspection.service.js";
import { assessFindingRisk } from "../../../ai-service/risk/risk.service.js";
import { generateApprovalNote } from "../../../ai-service/reports/approval-note.service.js";
import { getDocumentById } from "../repositories/documents.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../uploads");
const GENERATED_DIR = path.resolve(__dirname, "../../generated");

/**
 * Resolves a file path from documentId, filename, or direct filePath.
 * Searches in backend uploads directory if a relative or basename is provided.
 */
export function resolveInspectionFilePath({ documentId, filename, filePath } = {}) {
    if (filePath && typeof filePath === "string" && fs.existsSync(filePath)) {
        return path.resolve(filePath);
    }

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

        // Also check exact documentId name without extension
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

    if (typeof target === "string") {
        if (fs.existsSync(target)) {
            targetPath = path.resolve(target);
            resolvedFilename = resolvedFilename || path.basename(targetPath);
        } else {
            targetPath = resolveInspectionFilePath({ documentId: target });
        }
    } else if (target && typeof target === "object") {
        targetPath = resolveInspectionFilePath(target);
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
    if (!fs.existsSync(GENERATED_DIR)) {
        fs.mkdirSync(GENERATED_DIR, { recursive: true });
    }

    const defaultFilename = options.filename || "Approval_Note.docx";
    const defaultOutputPath = path.resolve(GENERATED_DIR, defaultFilename);
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
 * Orchestrates the end-to-end inspection workflow from PDF to Approval Note DOCX.
 */
export async function runCompleteWorkflow(input, options = {}) {
    let documentId;
    let filename;
    let chunksStored = 0;

    // Check if input is operating on an existing documentId
    const candidateDocId =
        typeof input === "string" && !fs.existsSync(input)
            ? input.trim()
            : input && typeof input === "object" && input.documentId
            ? String(input.documentId).trim()
            : null;

    if (candidateDocId) {
        documentId = candidateDocId;
        const docRecord = await getDocumentById(documentId);
        if (!docRecord) {
            const notFoundErr = new Error(`Document '${documentId}' not found in document library`);
            notFoundErr.status = 404;
            throw notFoundErr;
        }

        if (docRecord.status === "Processing") {
            const processingErr = new Error(`Document '${documentId}' is still being indexed. Please wait until indexing completes.`);
            processingErr.status = 400;
            throw processingErr;
        }

        if (docRecord.status === "Failed") {
            const failedErr = new Error(`Document '${documentId}' failed indexing. Please re-upload the document.`);
            failedErr.status = 400;
            throw failedErr;
        }

        filename = docRecord.original_filename || docRecord.filename || options.filename || `${documentId}.pdf`;
        chunksStored = docRecord.chunks_stored || 0;
    } else {
        // Legacy / Multipart upload flow: ingest file
        const ingestionResult = await ingestInspectionFile(input, options.ingestOptions);
        documentId = ingestionResult.documentId;
        filename = ingestionResult.filename;
        chunksStored = ingestionResult.chunksStored || 0;
    }

    // 2. Inspection Analysis
    const task =
        options.task ||
        (input && typeof input === "object" ? input.task : null) ||
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
        subject: `Inspection Report Analysis and Approval Recommendation — ${filename}`,
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
        filename,
        chunksStored,
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
