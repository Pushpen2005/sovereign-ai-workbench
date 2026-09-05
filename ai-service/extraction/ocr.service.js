import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Extract text from an image using local Tesseract OCR.
 *
 * @param {string} imagePath - Absolute or relative path to the image.
 * @param {object} [options] - OCR options (lang, psm)
 * @returns {Promise<string>}
 */
export function extractTextFromImage(imagePath, options = {}) {
    if (!imagePath || typeof imagePath !== "string") {
        throw new Error("A valid image path is required");
    }

    let resolvedPath = path.resolve(imagePath);
    try {
        if (fs.existsSync(resolvedPath)) {
            resolvedPath = fs.realpathSync(resolvedPath);
        }
    } catch {
        // Fall back to resolvedPath
    }

    const args = [resolvedPath, "stdout"];
    if (options.lang && typeof options.lang === "string") {
        args.push("-l", options.lang);
    }
    if (options.psm !== undefined) {
        args.push("--psm", String(options.psm));
    }

    return new Promise((resolve, reject) => {
        const tesseract = spawn("tesseract", args);

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