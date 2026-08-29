import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
    ingestInspectionFile,
    runApprovalNoteGeneration,
    runCompleteWorkflow,
    runFindingRiskAssessment,
    runInspectionAnalysis,
} from "../services/inspection.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.resolve(__dirname, "../../generated");

/**
 * Ingest an inspection PDF into Qdrant knowledge base.
 * Supports both multipart/form-data upload and JSON referencing existing documentId/filePath.
 */
export async function ingestInspection(req, res, next) {
    try {
        let target;
        let options = {};

        if (req.file) {
            const documentId = path.basename(
                req.file.filename,
                path.extname(req.file.filename)
            );
            target = req.file.path;
            options = {
                documentId,
                filename: req.file.originalname || req.file.filename,
            };
        } else if (req.body && (req.body.documentId || req.body.filePath || req.body.filename)) {
            target = {
                documentId: req.body.documentId,
                filename: req.body.filename,
                filePath: req.body.filePath,
            };
            if (req.body.documentId) {
                options.documentId = req.body.documentId;
            }
            if (req.body.filename) {
                options.filename = req.body.filename;
            }
        } else {
            return res.status(400).json({
                success: false,
                message: "Document file or documentId is required",
            });
        }

        const result = await ingestInspectionFile(target, options);

        return res.status(200).json({
            success: true,
            documentId: result.documentId,
            filename: result.filename,
            chunksStored: result.chunksStored,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Extract findings from an ingested inspection report.
 */
export async function analyzeInspection(req, res, next) {
    try {
        const { documentId, task } = req.body || {};

        if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
            return res.status(400).json({
                success: false,
                message: "documentId is required",
            });
        }

        const taskText =
            typeof task === "string" && task.trim().length > 0
                ? task.trim()
                : "Analyze this inspection report and extract all significant findings.";

        const result = await runInspectionAnalysis({
            documentId: documentId.trim(),
            task: taskText,
        });

        return res.status(200).json({
            success: true,
            documentId: documentId.trim(),
            findings: result.findings || [],
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Evaluate risk and recommendations for an inspection finding.
 */
export async function assessRisk(req, res, next) {
    try {
        const { documentId, finding } = req.body || {};

        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            return res.status(400).json({
                success: false,
                message: "Valid finding object is required",
            });
        }

        if (
            typeof finding.finding !== "string" ||
            !finding.finding.trim() ||
            typeof finding.evidence !== "string" ||
            !finding.evidence.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "finding and evidence are required fields in finding object",
            });
        }

        const result = await runFindingRiskAssessment(finding);

        return res.status(200).json({
            success: true,
            documentId: documentId || null,
            riskAssessment: result.riskAssessment,
            recommendation: result.recommendation,
            citations: result.citations || [],
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Assemble and generate an Approval Note DOCX.
 */
export async function generateApprovalNoteDocx(req, res, next) {
    try {
        const data = req.body;

        if (!data || typeof data !== "object") {
            return res.status(400).json({
                success: false,
                message: "Payload data is required",
            });
        }

        const result = await runApprovalNoteGeneration(data);

        return res.status(200).json({
            success: true,
            filename: result.filename,
            downloadUrl: `/api/v1/inspection/download/${result.filename}`,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Safe download endpoint for generated DOCX files.
 */
export async function downloadApprovalNote(req, res, next) {
    try {
        const filename = req.params.filename;
        if (!filename || typeof filename !== "string") {
            return res.status(400).json({
                success: false,
                message: "Filename parameter is required",
            });
        }

        const safeFilename = path.basename(filename);
        const filePath = path.resolve(GENERATED_DIR, safeFilename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: `File '${safeFilename}' not found`,
            });
        }

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        return res.download(filePath, safeFilename);
    } catch (error) {
        next(error);
    }
}

/**
 * Complete workflow from inspection PDF to generated Approval Note DOCX.
 */
export async function runWorkflow(req, res, next) {
    try {
        let input;
        let options = {};

        if (req.file) {
            const documentId = path.basename(
                req.file.filename,
                path.extname(req.file.filename)
            );
            input = req.file.path;
            options.ingestOptions = {
                documentId,
                filename: req.file.originalname || req.file.filename,
            };
            if (req.body && req.body.task) {
                options.task = req.body.task;
            }
        } else if (req.body && (req.body.documentId || req.body.filePath || req.body.filename)) {
            input = {
                documentId: req.body.documentId,
                filename: req.body.filename,
                filePath: req.body.filePath,
            };
            if (req.body.task) {
                options.task = req.body.task;
            }
        } else {
            return res.status(400).json({
                success: false,
                message: "Inspection document file or documentId is required to start workflow",
            });
        }

        const workflowResult = await runCompleteWorkflow(input, options);

        return res.status(200).json({
            success: true,
            data: {
                documentId: workflowResult.documentId,
                filename: workflowResult.filename,
                chunksStored: workflowResult.chunksStored,
                findings: workflowResult.findings,
                riskAssessments: workflowResult.riskAssessments,
                recommendations: workflowResult.recommendations,
                citations: workflowResult.citations,
                approvalNote: {
                    filename: workflowResult.approvalNote.filename,
                    downloadUrl: `/api/v1/inspection/download/${workflowResult.approvalNote.filename}`,
                },
            },
        });
    } catch (error) {
        next(error);
    }
}