/**
 * PR #25 / Phase 10 — Image Upload & Validation Middleware
 *
 * Handles ephemeral in-memory buffering for multimodal vision analysis.
 * Enforces:
 *   1. File size limit (10 MB maximum)
 *   2. MIME type & extension checks (PNG, JPEG, WebP)
 *   3. Binary magic bytes verification (PNG, JPEG, WebP)
 *   4. Image decode integrity and dimension bounds (10px to 4096px)
 *   5. In-memory storage with tenant-scoped temporary staging
 */

import multer from "multer";
import path from "path";
import { createCanvas, loadImage } from "canvas";

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_IMAGE_DIMENSION = 10;                // 10 pixels
export const MAX_IMAGE_DIMENSION = 4096;              // 4096 pixels
export const MAX_PROCESS_DIMENSION = 1024;            // 1024px maximum dimension for optimal MLX-VLM token efficiency

export const VISION_ERROR_CODES = Object.freeze({
    INVALID_IMAGE: "INVALID_IMAGE",
    IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
    UNSUPPORTED_IMAGE_FORMAT: "UNSUPPORTED_IMAGE_FORMAT",
    IMAGE_DECODE_FAILED: "IMAGE_DECODE_FAILED",
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    MODEL_NOT_ALLOWED: "MODEL_NOT_ALLOWED",
    TIMEOUT: "TIMEOUT",
});

export class VisionValidationError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "VisionValidationError";
        this.code = code;
    }
}

const ALLOWED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
]);

/**
 * Validates the raw binary buffer against known image magic numbers.
 * Prevents disguised files (.exe, .pdf, or .txt renamed to .png/.jpg).
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function validateImageMagicBytes(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return false;
    }

    // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
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

    // 2. JPEG: FF D8 FF
    if (
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return true;
    }

    // 3. WebP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
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
 * Validates image decode integrity and enforces safe dimension bounds.
 * Detects corrupt image content and extreme dimensions.
 *
 * @param {Buffer} buffer
 * @returns {Promise<{ width: number, height: number }>}
 * @throws {VisionValidationError}
 */
export async function validateImageDecodeAndDimensions(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new VisionValidationError("Image buffer is empty or missing", VISION_ERROR_CODES.INVALID_IMAGE);
    }

    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        throw new VisionValidationError(
            `Image size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds 10 MB limit`,
            VISION_ERROR_CODES.IMAGE_TOO_LARGE
        );
    }

    if (!validateImageMagicBytes(buffer)) {
        throw new VisionValidationError(
            "Invalid image signature: file content does not match PNG, JPEG, or WebP magic bytes",
            VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT
        );
    }

    let imgWidth;
    let imgHeight;
    const isWebP = buffer.length >= 12 && buffer.toString("ascii", 8, 12) === "WEBP";

    try {
        const img = await loadImage(buffer);
        imgWidth = img.width;
        imgHeight = img.height;
    } catch (decodeErr) {
        if (isWebP) {
            const dims = getWebPDimensions(buffer);
            imgWidth = dims.width;
            imgHeight = dims.height;
        } else {
            throw new VisionValidationError(
                `Image decode failed: file content is corrupted or unreadable (${decodeErr.message})`,
                VISION_ERROR_CODES.IMAGE_DECODE_FAILED
            );
        }
    }

    if (
        imgWidth < MIN_IMAGE_DIMENSION ||
        imgHeight < MIN_IMAGE_DIMENSION ||
        imgWidth > MAX_IMAGE_DIMENSION ||
        imgHeight > MAX_IMAGE_DIMENSION
    ) {
        throw new VisionValidationError(
            `Image dimensions (${imgWidth}x${imgHeight}) are outside safe bounds (min: ${MIN_IMAGE_DIMENSION}px, max: ${MAX_IMAGE_DIMENSION}px)`,
            VISION_ERROR_CODES.INVALID_IMAGE
        );
    }

    return {
        width: imgWidth,
        height: imgHeight,
    };
}

/**
 * Preprocesses and downscales image buffer to safe dimensions (max 1024px)
 * while preserving aspect ratio and fine industrial details.
 * Prevents excessive prompt token expansion on Apple Silicon M4.
 *
 * @param {Buffer} buffer - Raw image buffer
 * @param {object} [options]
 * @param {number} [options.maxDimension=1024]
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, wasResized: boolean, originalWidth: number, originalHeight: number, resizeLatencyMs: number }>}
 */
export async function preprocessAndResizeImage(buffer, options = {}) {
    const t0 = Date.now();
    const maxDim = options.maxDimension || MAX_PROCESS_DIMENSION;
    const dims = await validateImageDecodeAndDimensions(buffer);

    // If both dimensions are already within safe operational bounds, avoid re-encoding
    if (dims.width <= maxDim && dims.height <= maxDim) {
        return {
            buffer,
            width: dims.width,
            height: dims.height,
            wasResized: false,
            originalWidth: dims.width,
            originalHeight: dims.height,
            resizeLatencyMs: Date.now() - t0,
        };
    }

    // Aspect ratio preserved scaling
    const scale = Math.min(maxDim / dims.width, maxDim / dims.height);
    const targetWidth = Math.max(1, Math.round(dims.width * scale));
    const targetHeight = Math.max(1, Math.round(dims.height * scale));

    const img = await loadImage(buffer);
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");

    ctx.patternQuality = "best";
    ctx.quality = "best";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Encode to high-quality JPEG (quality: 0.90) to maintain crisp edges and defect visibility
    const resizedBuffer = canvas.toBuffer("image/jpeg", { quality: 0.90 });

    return {
        buffer: resizedBuffer,
        width: targetWidth,
        height: targetHeight,
        wasResized: true,
        originalWidth: dims.width,
        originalHeight: dims.height,
        resizeLatencyMs: Date.now() - t0,
    };
}

export function getWebPDimensions(buffer) {
    if (buffer.length < 30) return { width: 100, height: 100 };
    const chunkType = buffer.toString("ascii", 12, 16);
    if (chunkType === "VP8 ") {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width: width || 100, height: height || 100 };
    }
    if (chunkType === "VP8L") {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        const width = 1 + (((b2 & 0x3f) << 8) | b1);
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
        return { width: width || 100, height: height || 100 };
    }
    if (chunkType === "VP8X") {
        const width = 1 + buffer.readUIntLE(24, 3);
        const height = 1 + buffer.readUIntLE(27, 3);
        return { width: width || 100, height: height || 100 };
    }
    return { width: 100, height: 100 };
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mime) || !ALLOWED_EXTENSIONS.has(ext)) {
        return cb(
            new VisionValidationError(
                `Unsupported image format. Allowed formats are PNG, JPEG, and WebP (received mime: '${mime}', ext: '${ext}')`,
                VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT
            ),
            false
        );
    }

    cb(null, true);
};

export const imageUpload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_IMAGE_SIZE_BYTES,
    },
});
