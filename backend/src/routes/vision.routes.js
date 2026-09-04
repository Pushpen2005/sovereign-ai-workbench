/**
 * PR #25 — Vision Routes
 *
 * Exposes:
 *   POST /api/v1/vision/analyze
 */

import express from "express";
import multer from "multer";
import { imageUpload } from "../middleware/imageUpload.middleware.js";
import { analyzeImage } from "../controllers/vision.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * Middleware wrapper to catch Multer file validation or size limit errors
 * and return HTTP 400 with a clean message.
 */
function handleImageUpload(req, res, next) {
    const uploadSingle = imageUpload.single("image");

    uploadSingle(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({
                        success: false,
                        message: "Image exceeds maximum allowed size of 10 MB.",
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: `Image upload error: ${err.message}`,
                });
            }
            return res.status(400).json({
                success: false,
                message: err.message,
            });
        }
        next();
    });
}

router.post("/analyze", requireAuth, handleImageUpload, analyzeImage);

export default router;
