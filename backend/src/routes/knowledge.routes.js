import express from "express";
import { searchKnowledge } from "../controllers/knowledge.controller.js";

const router = express.Router();

/**
 * POST /api/v1/knowledge/search
 * Interactive semantic search simulator for knowledge base SOPs.
 * Strictly tenant-isolated and scoped to canonical documentType="sop".
 */
router.post("/search", searchKnowledge);

export default router;
