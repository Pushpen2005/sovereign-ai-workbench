/**
 * Dedicated Local Vision Service
 *
 * Implements 100% on-premise local multimodal AI inference using MLX.
 * Supported image types: image/jpeg, image/png, image/webp.
 * External cloud vision APIs: 0.
 */

import { generateVisionAnswer, LLMError } from "../llm/llm.service.js";
import { isModelAllowed, routeTask, TASK_TYPE } from "../router/modelRouter.js";

export const MAX_VISION_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_VISION_MIME_TYPES = Object.freeze(new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
]));

export const VISION_ERROR_CODES = Object.freeze({
    INVALID_IMAGE: "INVALID_IMAGE",
    IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
    UNSUPPORTED_IMAGE_FORMAT: "UNSUPPORTED_IMAGE_FORMAT",
    MODEL_NOT_ALLOWED: "MODEL_NOT_ALLOWED",
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    TIMEOUT: "TIMEOUT",
});

export class VisionError extends Error {
    constructor(message, code = "VISION_ERROR", statusCode = 400) {
        super(message);
        this.name = "VisionError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * Validates image buffer magic bytes against PNG, JPEG, and WebP signatures.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function validateImageMagicBytes(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return false;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return true;
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return true;
    }

    // WebP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return true;
    }

    return false;
}

/**
 * Validates image input buffer, size, MIME type, and magic bytes.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 */
export function validateVisionImage(imageBuffer, mimeType) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        throw new VisionError(
            "Image buffer is required and cannot be empty",
            VISION_ERROR_CODES.INVALID_IMAGE,
            400
        );
    }

    if (imageBuffer.length > MAX_VISION_IMAGE_SIZE_BYTES) {
        throw new VisionError(
            `Image size (${(imageBuffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 10 MB limit`,
            VISION_ERROR_CODES.IMAGE_TOO_LARGE,
            400
        );
    }

    const normMime = String(mimeType || "").trim().toLowerCase();
    if (normMime && !SUPPORTED_VISION_MIME_TYPES.has(normMime)) {
        throw new VisionError(
            `Unsupported MIME type '${mimeType}'. Supported: image/jpeg, image/png, image/webp`,
            VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT,
            400
        );
    }

    if (!validateImageMagicBytes(imageBuffer)) {
        throw new VisionError(
            "Invalid image signature: content does not match JPEG, PNG, or WebP magic bytes",
            VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT,
            400
        );
    }

    return true;
}

/**
 * Resolves the configured local vision model using the Phase 9 Model Router.
 *
 * @param {string} [requestedModel]
 * @returns {Promise<{ selectedModel: string, taskType: string, local: boolean }>}
 */
export async function resolveVisionModel(requestedModel = null) {
    if (requestedModel) {
        if (!isModelAllowed(requestedModel)) {
            throw new VisionError(
                `Model '${requestedModel}' is not in the sovereign model allowlist`,
                VISION_ERROR_CODES.MODEL_NOT_ALLOWED,
                400
            );
        }
    }

    const routing = await routeTask("Analyze this visual image", {
        hasImage: true,
        model: requestedModel,
    });

    return {
        selectedModel: routing.selectedModel,
        taskType: routing.taskType || TASK_TYPE.VISION,
        local: routing.local !== false,
    };
}

/**
 * Parses raw vision model text into structured observations and limitations.
 *
 * @param {string} rawAnalysis
 * @returns {{ observations: string[], limitations: string[] }}
 */
export function extractVisionObservations(rawAnalysis) {
    if (typeof rawAnalysis !== "string" || !rawAnalysis.trim()) {
        return {
            observations: [],
            limitations: ["Model produced empty analysis"],
        };
    }

    const lines = rawAnalysis.split("\n").map((l) => l.trim()).filter(Boolean);
    const observations = [];
    const limitations = [];

    let currentSection = "observed";

    for (const line of lines) {
        const lower = line.toLowerCase();
        if (lower.startsWith("observed:") || lower === "observed" || lower.startsWith("observations:")) {
            currentSection = "observed";
            continue;
        } else if (
            lower.startsWith("not_visible:") ||
            lower.startsWith("not visible:") ||
            lower.startsWith("limitations:") ||
            lower === "not_visible" ||
            lower === "limitations"
        ) {
            currentSection = "not_visible";
            continue;
        }

        const bullet = line.replace(/^[-*•\d.]+\s*/, "").trim();
        if (!bullet) continue;

        if (currentSection === "observed") {
            observations.push(bullet);
        } else {
            limitations.push(bullet);
        }
    }

    if (observations.length === 0 && lines.length > 0) {
        observations.push(lines[0].replace(/^[-*•\d.]+\s*/, "").trim());
    }

    return {
        observations,
        limitations,
    };
}

/**
 * Executes local multimodal vision analysis.
 *
 * @param {object} params
 * @param {Buffer|string} params.image - Image Buffer or base64 string
 * @param {string} [params.mimeType="image/png"] - MIME type
 * @param {string} [params.prompt] - User prompt
 * @param {string} [params.model] - Optional model override
 * @param {object} [params.options] - Inference options
 * @returns {Promise<object>} Structured vision result
 */
export async function analyzeImage({
    image,
    mimeType = "image/png",
    prompt = "Analyze this industrial image. Describe visible equipment, components, and conditions.",
    model = null,
    options = {},
}) {
    // 1. Normalize imageBuffer
    let imageBuffer;
    if (Buffer.isBuffer(image)) {
        imageBuffer = image;
    } else if (typeof image === "string") {
        imageBuffer = Buffer.from(image, "base64");
    } else {
        throw new VisionError("Image must be a Buffer or base64 string", VISION_ERROR_CODES.INVALID_IMAGE, 400);
    }

    // 2. Validate image input, MIME, size, magic bytes
    validateVisionImage(imageBuffer, mimeType);

    // 3. Resolve local vision model
    const routing = await resolveVisionModel(model);

    // 4. Prepare base64 image string for MLX vision model
    const base64Image = imageBuffer.toString("base64");

    const tStart = Date.now();
    let rawAnalysis;

    try {
        rawAnalysis = await generateVisionAnswer(
            prompt.trim(),
            base64Image,
            routing.selectedModel,
            {
                maxTokens: options.maxTokens || 512,
                timeoutMs: options.timeoutMs || 45000,
            }
        );
    } catch (err) {
        if (err instanceof LLMError) {
            const errCode = err.code === "TIMEOUT"
                ? VISION_ERROR_CODES.TIMEOUT
                : VISION_ERROR_CODES.MODEL_UNAVAILABLE;
            const statusCode = err.code === "TIMEOUT" ? 408 : 503;
            throw new VisionError(
                `Local vision model '${routing.selectedModel}' failed during inference: ${err.message}`,
                errCode,
                statusCode
            );
        }
        throw new VisionError(err.message, "INFERENCE_ERROR", 500);
    }

    const durationMs = Date.now() - tStart;
    const { observations, limitations } = extractVisionObservations(rawAnalysis);

    return {
        success: true,
        taskType: TASK_TYPE.VISION,
        model: routing.selectedModel,
        local: true,
        analysis: rawAnalysis,
        observations,
        limitations,
        latencyMs: durationMs,
    };
}
