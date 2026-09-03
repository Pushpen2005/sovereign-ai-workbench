/**
 * PR #26 / Phase 6 — Agent Routes
 *
 * Exposes:
 *   POST /api/v1/agent/run
 *   GET  /api/v1/agent/runs
 *   GET  /api/v1/agent/runs/:runId
 *   GET  /api/v1/agent/runs/:runId/steps
 */

import express from "express";
import {
    runAgent,
    getAgentRuns,
    getAgentRun,
    getAgentRunSteps,
    streamAgentRun,
} from "../controllers/agent.controller.js";

const router = express.Router();

router.post("/run", runAgent);
router.get("/runs", getAgentRuns);
router.get("/runs/:runId", getAgentRun);
router.get("/runs/:runId/steps", getAgentRunSteps);
router.get("/runs/:runId/stream", streamAgentRun);

export default router;
