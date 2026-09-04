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
import { processAndIngestDocument } from "../services/documents.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";
import { createReportRecord } from "../services/reports.service.js";
import { createDocument } from "../repositories/documents.repository.js";
import { query } from "../config/db.js";
import { executionEvents } from "../services/execution-events.service.js";

import {
    validateFilename,
    getReportStoragePath,
    assertPathContained,
} from "../utils/storage.js";

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
            options.ingestOptions = {
                documentId,
                filename: req.file.originalname || req.file.filename,
                organizationId: req.user?.organizationId,
            };
        } else if (req.body && (req.body.documentId || req.body.filePath || req.body.filename)) {
            target = req.body;
            options.ingestOptions = {
                documentId: req.body.documentId,
                filename: req.body.filename,
                organizationId: req.user?.organizationId,
            };
        } else {
            return res.status(400).json({
                success: false,
                message: "Inspection document file or document reference is required",
            });
        }

        const organizationId = resolveAuthenticatedOrganization(req);
        options.organizationId = organizationId;

        const result = await ingestInspectionFile(target, {
            ...options.ingestOptions,
            organizationId,
        });

        // Ensure document row exists in documents table for referential integrity
        const docCheck = await query(
            "SELECT id FROM documents WHERE id = $1",
            [result.documentId]
        );
        if (docCheck.rows.length === 0) {
            await createDocument({
                id: result.documentId,
                organizationId,
                filename: result.filename || `${result.documentId}.pdf`,
                originalFilename: req.file?.originalname || result.filename || "Inspection Report",
                status: "Indexed",
                chunksStored: result.chunksStored || 0,
            });
        }

        return res.status(200).json({
            success: true,
            documentId: result.documentId,
            organizationId,
            filename: result.filename,
            chunksStored: result.chunksStored,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Execute automated analysis on an ingested inspection report.
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

        const organizationId = resolveAuthenticatedOrganization(req);

        // Enforce document ownership
        const docCheck = await query(
            "SELECT id, organization_id FROM documents WHERE id = $1",
            [documentId.trim()]
        );
        if (docCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Document not found",
            });
        }
        if (docCheck.rows[0].organization_id !== organizationId) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: document belongs to another organization.",
            });
        }

        const taskText =
            typeof task === "string" && task.trim().length > 0
                ? task.trim()
                : "Analyze this inspection report and extract all significant findings.";

        const result = await runInspectionAnalysis({
            documentId: documentId.trim(),
            task: taskText,
        }, { organizationId });

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
        const organizationId = resolveAuthenticatedOrganization(req);
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

        const result = await runFindingRiskAssessment(finding, { organizationId });

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
        const organizationId = resolveAuthenticatedOrganization(req);
        const data = req.body;

        if (!data || typeof data !== "object") {
            return res.status(400).json({
                success: false,
                message: "Payload data is required",
            });
        }

        const result = await runApprovalNoteGeneration(data, {
            organizationId,
            filename: data.filename,
        });

        // Bind generated report to authenticated organization in reports repository
        try {
            await createReportRecord({
                organizationId,
                title: data.subject || "Approval Note",
                filename: result.filename,
                status: "GENERATED",
            });
        } catch (repErr) {
            console.warn("[InspectionController] Warning: Could not persist report record:", repErr.message);
        }

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
        const organizationId = resolveAuthenticatedOrganization(req);
        const filename = req.params.filename;
        if (!filename || typeof filename !== "string") {
            return res.status(400).json({
                success: false,
                message: "Filename parameter is required",
            });
        }

        let safeFilename;
        try {
            safeFilename = validateFilename(filename);
        } catch (valErr) {
            return res.status(400).json({
                success: false,
                message: valErr.message,
            });
        }

        // 1. Enforce strict tenant authorization against reports database
        const reportCheck = await query(
            "SELECT id, organization_id, filename FROM reports WHERE filename = $1 AND organization_id = $2",
            [safeFilename, organizationId]
        );

        if (reportCheck.rows.length === 0) {
            // Defensive: check if file belongs to a foreign organization
            const foreignCheck = await query(
                "SELECT id, organization_id FROM reports WHERE filename = $1",
                [safeFilename]
            );
            if (foreignCheck.rows.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: report file belongs to another organization",
                });
            }
            return res.status(404).json({
                success: false,
                message: `Report file '${safeFilename}' not found for authenticated organization`,
            });
        }

        // 2. Resolve file path inside tenant's generated directory
        const tenantFilePath = getReportStoragePath(organizationId, safeFilename);
        let finalFilePath = tenantFilePath;

        if (!fs.existsSync(finalFilePath)) {
            // Safe fallback for pre-migration demo reports
            const legacyPath = path.resolve(GENERATED_DIR, safeFilename);
            if (fs.existsSync(legacyPath)) {
                assertPathContained(legacyPath, GENERATED_DIR);
                finalFilePath = legacyPath;
            } else {
                return res.status(404).json({
                    success: false,
                    message: `Report file '${safeFilename}' not found on storage`,
                });
            }
        }

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        return res.download(finalFilePath, safeFilename);
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

        const organizationId = resolveAuthenticatedOrganization(req);
        if (!options.ingestOptions) {
            options.ingestOptions = {};
        }
        options.ingestOptions.organizationId = organizationId;
        options.organizationId = organizationId;
        options.userId = req.user?.id || null;

        // Step 5: Document Authorization & Organization Validation
        if (req.body && req.body.documentId) {
            const docCheck = await query(
                "SELECT id, organization_id FROM documents WHERE id = $1",
                [req.body.documentId.trim()]
            );
            if (docCheck.rows.length > 0 && docCheck.rows[0].organization_id !== organizationId) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: document belongs to another organization.",
                });
            }
        }

        const runId = req.headers["x-run-id"] || req.body?.runId || req.query?.runId;
        if (runId) {
            options.runId = runId;
        }

        const workflowResult = await runCompleteWorkflow(input, options);

        // Ensure document row exists in documents table for referential integrity
        if (workflowResult.documentId) {
            const docCheck = await query(
                "SELECT id FROM documents WHERE id = $1",
                [workflowResult.documentId]
            );
            if (docCheck.rows.length === 0) {
                await createDocument({
                    id: workflowResult.documentId,
                    organizationId,
                    filename: workflowResult.filename || `${workflowResult.documentId}.pdf`,
                    originalFilename: workflowResult.filename || "Inspection Report",
                    status: "Indexed",
                    chunksStored: workflowResult.chunksStored || 0,
                });
            }
        }

        const primaryRisk =
            Array.isArray(workflowResult.riskAssessments) && workflowResult.riskAssessments.length > 0
                ? workflowResult.riskAssessments[0]?.level || null
                : null;

        const reportTitle = `Approval Note — ${workflowResult.filename || workflowResult.documentId}`;

        let savedReport = null;
        if (workflowResult.approvalNote?.filename) {
            savedReport = await createReportRecord({
                documentId: workflowResult.documentId || null,
                organizationId,
                title: reportTitle,
                filename: workflowResult.approvalNote.filename,
                riskLevel: primaryRisk,
                status: "GENERATED",
                task: options.task || "Analyze this inspection report and extract all significant findings.",
            });
        }

        const approvalNoteData = workflowResult.approvalNote?.filename
            ? {
                filename: workflowResult.approvalNote.filename,
                downloadUrl: `/api/v1/inspection/download/${workflowResult.approvalNote.filename}`,
            }
            : null;

        return res.status(200).json({
            success: true,
            data: {
                reportId: savedReport?.id || null,
                documentId: workflowResult.documentId,
                filename: workflowResult.filename,
                chunksStored: workflowResult.chunksStored,
                findings: workflowResult.findings,
                riskAssessments: workflowResult.riskAssessments,
                recommendations: workflowResult.recommendations,
                citations: workflowResult.citations,
                approvalNote: approvalNoteData,
                report: savedReport,
                orchestration: workflowResult.orchestration,
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Streams real-time Server-Sent Events (SSE) for an active or completed inspection run.
 */
export async function streamInspectionRun(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const { runId } = req.params;

        // Verify organization authorization with PostgreSQL hydration fallback
        const authCheck = await executionEvents.verifyOrHydrateRunOwner(runId, organizationId);
        if (authCheck.forbidden) {
            return res.status(403).json({
                success: false,
                message: authCheck.message || "Forbidden: Inspection run belongs to another organization.",
            });
        }
        if (authCheck.notFound) {
            return res.status(404).json({
                success: false,
                message: authCheck.message || `Inspection run '${runId}' not found.`,
            });
        }

        executionEvents.subscribe(runId, req, res, { organizationId });
    } catch (error) {
        next(error);
    }
}