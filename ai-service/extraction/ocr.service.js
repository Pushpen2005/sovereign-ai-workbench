import { spawn } from "child_process";
import path from "path";

/**
 * Extract text from an image using local Tesseract OCR.
 *
 * @param {string} imagePath - Absolute or relative path to the image.
 * @returns {Promise<string>}
 */
export function extractTextFromImage(imagePath) {
    if (!imagePath || typeof imagePath !== "string") {
        throw new Error("A valid image path is required");
    }

    const resolvedPath = path.resolve(imagePath);

    return new Promise((resolve, reject) => {
        const tesseract = spawn("tesseract", [
            resolvedPath,
            "stdout",
        ]);

        let stdout = "";
        let stderr = "";

        tesseract.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        tesseract.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        tesseract.on("error", (error) => {
            reject(
                new Error("Unable to start Tesseract", {
                    cause: error,
                })
            );
        });

        tesseract.on("close", (code) => {
            if (code !== 0) {
                reject(
                    new Error("OCR failed", {
                        cause: new Error(stderr.trim()),
                    })
                );
                return;
            }

            resolve(stdout.trim());
        });
    });
}