/**
 * AI System & Health Routes
 *
 * Exposes:
 *   GET /api/v1/ai/health — Unified health check for local Vision, Coding, and Inspection runtimes
 */

import { Router } from "express";
import { checkAllAiHealth } from "../services/ai-health.service.js";

const aiRouter = Router();

aiRouter.get("/health", async (req, res, next) => {
    try {
        const health = await checkAllAiHealth();
        res.status(200).json(health);
    } catch (err) {
        next(err);
    }
});

export default aiRouter;
