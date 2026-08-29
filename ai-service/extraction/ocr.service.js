import { spawn } from "child_process";

/**
 * Extract text from an image using local Tesseract OCR.
 *
 * @param {string} imagePath - Absolute path to the image.
 * @returns {Promise<string>}
 */
export function extractTextFromImage(imagePath) {
    if (!imagePath || typeof imagePath !== "string") {
        throw new Error("A valid image path is required");
    }

    return new Promise((resolve, reject) => {
        const tesseract = spawn("tesseract", [
            imagePath,
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