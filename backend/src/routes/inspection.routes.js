import express from "express";
import upload from "../middleware/upload.middleware.js";
import {
    analyzeInspection,
    assessRisk,
    downloadApprovalNote,
    generateApprovalNoteDocx,
    ingestInspection,
    runWorkflow,
    streamInspectionRun,
} from "../controllers/inspection.controller.js";

const router = express.Router();

// PR #17.3 — Ingest inspection document
router.post(
    "/ingest",
    upload.single("document"),
    ingestInspection
);

// PR #17.4 — Extract findings from ingested report
router.post(
    "/analyze",
    analyzeInspection
);

// PR #17.5 — Evaluate risk and recommendations
router.post(
    "/risk",
    assessRisk
);

// PR #17.6 — Generate Approval Note DOCX and download
router.post(
    "/approval-note",
    generateApprovalNoteDocx
);

router.get(
    "/download/:filename",
    downloadApprovalNote
);

// PR #17.7 — Complete workflow orchestration
router.post(
    "/workflow",
    upload.single("document"),
    runWorkflow
);

// Phase 7 — Live SSE Event Stream for Inspection Run
router.get(
    "/runs/:runId/stream",
    streamInspectionRun
);

export default router;