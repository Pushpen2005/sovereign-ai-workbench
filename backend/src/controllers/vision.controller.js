/**
 * PR #25 — Multimodal Vision Controller
 *
 * Handles:
 *   POST /api/v1/vision/analyze
 *
 * Ingests an uploaded image in-memory, validates magic bytes, routes through
 * Model Router (TASK_TYPE.VISION), and invokes the local Ollama vision model.
 */

import { generateVisionAnswer, LLMError } from "../../../ai-service/llm/llm.service.js";
import { routeTask, RouterError, isModelAllowed } from "../../../ai-service/router/modelRouter.js";
import { validateImageMagicBytes } from "../middleware/imageUpload.middleware.js";

const DEFAULT_VISION_PROMPT =
    "Analyze this industrial image. Describe visible equipment, components, physical conditions, and identify any obvious abnormalities or defects. Only report observations supported by the image.";

/**
 * Extracts structured sections (summary, observations, abnormalities, limitations)
 * from the vision model's response text.
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
        } else if (lower.includes("limitation") || lower.includes("uncertain") || lower.includes("caveat") || lower.includes("note:")) {
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

    // If summary is empty, use first observation or first line
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
        // 1. Validate file presence and non-empty buffer
        if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Image file is required and cannot be empty (form field: 'image')",
            });
        }

        // 2. Binary magic bytes validation
        const isValidMagic = validateImageMagicBytes(req.file.buffer);
        if (!isValidMagic) {
            return res.status(400).json({
                success: false,
                message: "Invalid image format. The file content does not match a valid PNG, JPEG, or WebP image signature.",
            });
        }

        // 3. Model allowlist validation
        if (req.body?.model) {
            if (!isModelAllowed(req.body.model)) {
                return res.status(400).json({
                    success: false,
                    message: `Model '${req.body.model}' is not in the sovereign model allowlist.`,
                });
            }
        }

        const prompt = (req.body?.prompt && typeof req.body.prompt === "string" && req.body.prompt.trim())
            ? req.body.prompt.trim()
            : DEFAULT_VISION_PROMPT;

        // 4. Route through Model Router
        let routing;
        try {
            routing = await routeTask(prompt, { hasImage: true, model: req.body?.model });
        } catch (routerErr) {
            if (routerErr instanceof RouterError) {
                return res.status(503).json({
                    success: false,
                    message: routerErr.message,
                    code: "MODEL_UNAVAILABLE",
                });
            }
            throw routerErr;
        }

        console.log(`[VISION-AUDIT] ${JSON.stringify({
            event: "vision.started",
            userId: req.user?.id || null,
            organizationId: req.user?.organizationId || null,
            model: routing.selectedModel,
            sizeBytes: req.file.size,
        })}`);

        // 5. Prepare base64 representation
        const base64Image = req.file.buffer.toString("base64");

        const systemVisionPrompt = `You are an expert industrial visual inspection AI.
Analyze the provided image thoroughly and objectively.

Follow these critical grounding rules:
1. ONLY describe what is visibly evident in the image. Do not invent or assume unseen components.
2. Distinguish clearly between direct visual observations and interpretations.
3. Identify visible equipment, components, tags/labels, and physical condition.
4. Note any visible abnormalities (cracks, corrosion, leaks, wear, misalignment, deformation).
5. Explicitly state limitations (e.g. angle, lighting, resolution, occluded parts).
6. Do not fabricate safety certifications or engineering approvals.

User Inquiry:
${prompt}`;

        const startTime = Date.now();

        // 6. Invoke local Ollama vision endpoint
        let rawAnswer;
        try {
            rawAnswer = await generateVisionAnswer(
                systemVisionPrompt,
                base64Image,
                routing.selectedModel
            );
        } catch (err) {
            console.warn(`[VISION-AUDIT] ${JSON.stringify({
                event: "vision.failed",
                userId: req.user?.id || null,
                organizationId: req.user?.organizationId || null,
                model: routing.selectedModel,
                error: err.message,
            })}`);

            if (err instanceof LLMError) {
                if (err.message.includes("Model unavailable") || err.message.includes("does not support multimodal")) {
                    return res.status(503).json({
                        success: false,
                        message: `Local vision model '${routing.selectedModel}' is not installed or does not support multimodal vision. Run: ollama pull ${routing.selectedModel}`,
                        code: "MODEL_UNAVAILABLE",
                    });
                }
                return res.status(502).json({
                    success: false,
                    message: `Local Ollama vision inference failed: ${err.message}`,
                });
            }
            throw err;
        }

        const durationMs = Date.now() - startTime;
        const structured = extractStructuredVisionAnalysis(rawAnswer);

        console.log(`[VISION-AUDIT] ${JSON.stringify({
            event: "vision.completed",
            userId: req.user?.id || null,
            organizationId: req.user?.organizationId || null,
            model: routing.selectedModel,
            durationMs,
        })}`);

        return res.status(200).json({
            success: true,
            taskType: routing.taskType,
            model: routing.selectedModel,
            analysis: rawAnswer,
            structured,
            governance: "Visual AI analysis is advisory decision support. It does not replace certified engineer inspection or statutory sign-off.",
            processing: {
                local: true,
                provider: "ollama",
                durationMs,
                image: {
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    sizeBytes: req.file.size,
                },
            },
        });
    } catch (error) {
        next(error);
    }
}
