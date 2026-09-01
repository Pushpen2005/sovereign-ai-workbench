/**
 * PR #25 — Image Upload Middleware
 *
 * Handles ephemeral in-memory buffering for multimodal vision analysis.
 * Enforces:
 *   1. File size limit (10 MB maximum)
 *   2. MIME type & extension checks
 *   3. Binary magic bytes verification (PNG, JPEG, WebP)
 *   4. In-memory storage (zero disk writes, zero persistent files)
 */

import multer from "multer";
import path from "path";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

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
 * Prevents disguised files (.exe or .txt renamed to .png).
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

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mime) || !ALLOWED_EXTENSIONS.has(ext)) {
        return cb(
            new Error(
                `Unsupported image format. Allowed formats are PNG, JPEG, and WebP (received mime: '${mime}', ext: '${ext}')`
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
