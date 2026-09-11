/**
 * PR #26 / Phase 7 — Agent Routes
 *
 * Exposes:
 *   POST /api/v1/agent/run
 *   POST /api/v1/agent/inspection
 *   POST /api/v1/agents/inspection/analyze
 *   GET  /api/v1/agents/inspection/runs/:runId
 *   GET  /api/v1/agent/runs
 *   GET  /api/v1/agent/runs/:runId
 *   GET  /api/v1/agent/runs/:runId/steps
 *   GET  /api/v1/agent/runs/:runId/stream
 */

import express from "express";
import {
    runAgent,
    runInspectionAgentController,
    analyzeInspectionController,
    getInspectionRunController,
    getAgentRuns,
    getAgentRun,
    getAgentRunSteps,
    streamAgentRun,
} from "../controllers/agent.controller.js";

const router = express.Router();

router.post("/run", runAgent);
router.post("/inspection", runInspectionAgentController);
router.post("/inspection/analyze", analyzeInspectionController);
router.get("/inspection/runs/:runId", getInspectionRunController);
router.get("/runs", getAgentRuns);
router.get("/runs/:runId", getAgentRun);
router.get("/runs/:runId/steps", getAgentRunSteps);
router.get("/runs/:runId/stream", streamAgentRun);
router.get("/runs/:runId/events", streamAgentRun);

export default router;
