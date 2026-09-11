/**
 * PR #24 / PR #25 — Coding Routes
 *
 * Exposes:
 *   POST /api/v1/coding/generate (supports JSON or multipart CSV)
 *   POST /api/v1/coding/execute  (supports JSON or multipart CSV)
 *   POST /api/v1/coding/workflow (supports JSON or multipart CSV)
 */

import express from "express";
import multer from "multer";
import {
    generateCode,
    executeCode,
    runCodingWorkflowHandler,
} from "../controllers/coding.controller.js";

const router = express.Router();

const uploadCsv = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single("csv");

const optionalCsvUpload = (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
        uploadCsv(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                return res.status(400).json({
                    success: false,
                    stage: "csv_validation",
                    error: `CSV upload error: ${err.message}`,
                });
            }
            if (err) {
                return res.status(400).json({
                    success: false,
                    stage: "csv_validation",
                    error: err.message,
                });
            }
            next();
        });
    } else {
        next();
    }
};

router.post("/generate", optionalCsvUpload, generateCode);
router.post("/execute", optionalCsvUpload, executeCode);
router.post("/workflow", optionalCsvUpload, runCodingWorkflowHandler);

export default router;
