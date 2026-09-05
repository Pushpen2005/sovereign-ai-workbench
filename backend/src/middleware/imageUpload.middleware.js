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
import { loadImage } from "canvas";

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MIN_IMAGE_DIMENSION = 10;                // 10 pixels
export const MAX_IMAGE_DIMENSION = 4096;              // 4096 pixels

export const VISION_ERROR_CODES = Object.freeze({
    INVALID_IMAGE: "INVALID_IMAGE",
    IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
    UNSUPPORTED_IMAGE_FORMAT: "UNSUPPORTED_IMAGE_FORMAT",
    IMAGE_DECODE_FAILED: "IMAGE_DECODE_FAILED",
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
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
            "Invalid image signature: file content does not match PNG or JPEG magic bytes",
            VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT
        );
    }

    let img;
    try {
        img = await loadImage(buffer);
    } catch (decodeErr) {
        throw new VisionValidationError(
            `Image decode failed: file content is corrupted or unreadable (${decodeErr.message})`,
            VISION_ERROR_CODES.IMAGE_DECODE_FAILED
        );
    }

    if (
        img.width < MIN_IMAGE_DIMENSION ||
        img.height < MIN_IMAGE_DIMENSION ||
        img.width > MAX_IMAGE_DIMENSION ||
        img.height > MAX_IMAGE_DIMENSION
    ) {
        throw new VisionValidationError(
            `Image dimensions (${img.width}x${img.height}) are outside safe bounds (min: ${MIN_IMAGE_DIMENSION}px, max: ${MAX_IMAGE_DIMENSION}px)`,
            VISION_ERROR_CODES.INVALID_IMAGE
        );
    }

    return {
        width: img.width,
        height: img.height,
    };
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
