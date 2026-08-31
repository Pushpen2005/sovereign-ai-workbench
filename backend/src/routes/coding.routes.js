/**
 * PR #24 — Coding Routes
 *
 * Exposes:
 *   POST /api/v1/coding/generate
 *   POST /api/v1/coding/execute
 */

import express from "express";
import { generateCode, executeCode } from "../controllers/coding.controller.js";

const router = express.Router();

router.post("/generate", generateCode);
router.post("/execute", executeCode);

export default router;
