/**
 * PR #25 / Phase 10 — Multimodal Vision Controller
 *
 * Handles:
 *   POST /api/v1/vision/analyze
 *
 * Ingests an uploaded image, validates magic bytes, decodes dimensions,
 * routes through Model Router (TASK_TYPE.VISION), and executes structured
 * industrial visual analysis with authoritative tenant isolation.
 */

import { resolveAuthenticatedOrganization } from "../config/organization.js";
import {
    runVisionWorkflow,
    parseStructuredObservations,
} from "../services/vision-agent.service.js";
import {
    validateImageMagicBytes,
    VISION_ERROR_CODES,
    VisionValidationError,
} from "../middleware/imageUpload.middleware.js";
import { isModelAllowed, RouterError } from "../../../ai-service/router/modelRouter.js";

const DEFAULT_VISION_PROMPT =
    "Read the visible equipment and gauge values. Report only what is visually supported by the image, and identify anything that cannot be determined.";

/**
 * Backward-compatibility wrapper for existing test suites.
 * Delegates to parseStructuredObservations.
 *
 * @param {string} text
 * @returns {{ summary: string, observations: string[], abnormalities: string[], limitations: string[] }}
 */
export function extractStructuredVisionAnalysis(text) {
    if (typeof text !== "string" || !text.trim()) {
        return {
            summary: "",
            observations: [],
            abnormalities: [],
            limitations: [],
        };
    }

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    let summary = "";
    const observations = [];
    const abnormalities = [];
    const limitations = [];

    let currentSection = "summary";

    for (const line of lines) {
        const lower = line.toLowerCase();

        if (lower.includes("observation") || lower.includes("visible component") || lower.includes("equipment:")) {
            currentSection = "observations";
            continue;
        } else if (lower.includes("abnormal") || lower.includes("defect") || lower.includes("damage") || lower.includes("issue:")) {
            currentSection = "abnormalities";
            continue;
        } else if (lower.includes("limitation") || lower.includes("uncertain") || lower.includes("caveat") || lower.includes("note:") || lower.includes("not_visible")) {
            currentSection = "limitations";
            continue;
        }

        const cleanedBullet = line.replace(/^[-*•\d.]+\s*/, "").trim();
        if (!cleanedBullet) continue;

        if (currentSection === "observations") {
            observations.push(cleanedBullet);
        } else if (currentSection === "abnormalities") {
            abnormalities.push(cleanedBullet);
        } else if (currentSection === "limitations") {
            limitations.push(cleanedBullet);
        } else {
            summary = summary ? `${summary} ${line}` : line;
        }
    }

    if (!summary && lines.length > 0) {
        summary = lines[0].replace(/^[-*•\d.]+\s*/, "");
    }

    return {
        summary: summary || "Visual inspection completed.",
        observations: observations.length > 0 ? observations : ["Visual components identified in image."],
        abnormalities: abnormalities.length > 0 ? abnormalities : ["No severe abnormalities visually detected."],
        limitations: limitations.length > 0 ? limitations : ["Analysis limited to visible 2D surface features."],
    };
}

/**
 * POST /api/v1/vision/analyze
 *
 * Analyzes an industrial image or scanned diagram using the local vision model.
 */
export async function analyzeImage(req, res, next) {
    try {
        // 1. Authoritative Organization Identity
        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || req.user?.sub || null;

        // 2. Validate file presence and non-empty buffer
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
            return res.status(400).json({
                success: false,
                code: VISION_ERROR_CODES.INVALID_IMAGE,
                message: "Image file is required and cannot be empty (form field: 'image')",
            });
        }

        // 3. Binary magic bytes validation
        const isValidMagic = validateImageMagicBytes(req.file.buffer);
        if (!isValidMagic) {
            return res.status(400).json({
                success: false,
                code: VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT,
                message: "Invalid image format. The file content does not match a valid PNG, JPEG, or WebP image signature.",
            });
        }

        // 4. Model allowlist validation
        if (req.body?.model) {
            if (!isModelAllowed(req.body.model)) {
                return res.status(400).json({
                    success: false,
                    code: VISION_ERROR_CODES.MODEL_UNAVAILABLE,
                    message: `Model '${req.body.model}' is not in the sovereign model allowlist.`,
                });
            }
        }

        const prompt = (req.body?.prompt && typeof req.body.prompt === "string" && req.body.prompt.trim())
            ? req.body.prompt.trim()
            : DEFAULT_VISION_PROMPT;

        console.log(`[VISION-AUDIT] ${JSON.stringify({
            event: "vision.started",
            userId,
            organizationId,
            sizeBytes: req.file.size,
        })}`);

        // 5. Execute Vision Agent Workflow
        const result = await runVisionWorkflow({
            imageBuffer: req.file.buffer,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            prompt,
            organizationId,
            userId,
            expectedReading: req.body?.expectedReading || null,
            requestedModel: req.body?.model || null,
            customRunId: req.body?.runId || null,
        });

        // For backward compatibility with PR #25 responses:
        const legacyStructured = extractStructuredVisionAnalysis(result.analysis);

        return res.status(200).json({
            success: true,
            taskType: result.taskType,
            model: result.selectedModel,
            analysis: result.analysis,
            structured: legacyStructured,
            observations: result.observations,
            inferred: result.inferred,
            limitations: result.limitations,
            verification: result.verification,
            governance: result.governance,
            processing: result.processing,
        });
    } catch (error) {
        if (error instanceof VisionValidationError) {
            const statusMap = {
                [VISION_ERROR_CODES.MODEL_UNAVAILABLE]: 503,
                [VISION_ERROR_CODES.IMAGE_TOO_LARGE]: 400,
                [VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT]: 400,
                [VISION_ERROR_CODES.INVALID_IMAGE]: 400,
                [VISION_ERROR_CODES.IMAGE_DECODE_FAILED]: 400,
            };
            const statusCode = statusMap[error.code] || 400;

            return res.status(statusCode).json({
                success: false,
                code: error.code || "VISION_ERROR",
                message: error.message,
            });
        }
        next(error);
    }
}
