import fs from "fs/promises";
import os from "os";
import path from "path";
import { createCanvas } from "canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

import { extractTextFromImage } from "./ocr.service.js";

function isUsableText(text) {
    return typeof text === "string" && text.trim().length > 0;
}

async function renderPageToImage(page, outputPath) {
    const scale = 2;

    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
    );

    const context = canvas.getContext("2d");

    await page.render({
        canvasContext: context,
        viewport,
    }).promise;

    const imageBuffer = canvas.toBuffer("image/png");

    await fs.writeFile(outputPath, imageBuffer);

    return outputPath;
}

/**
 * Extract text from a PDF file.
 *
 * Uses PDF.js for normal text extraction and falls back
 * to local Tesseract OCR for pages with no usable text.
 *
 * @param {string} filePath - Absolute path to the PDF file.
 * @returns {Promise<{
 *   text: string,
 *   pageCount: number,
 *   pages: Array<{page: number, text: string}>
 * }>}
 */
export async function extractPdfText(filePath) {
    if (!filePath || typeof filePath !== "string") {
        throw new Error("A valid PDF file path is required");
    }

    try {
        await fs.access(filePath);
    } catch {
        throw new Error("File does not exist");
    }

    let pdf;

    try {
        const loadingTask = pdfjsLib.getDocument({
            url: filePath,
        });

        pdf = await loadingTask.promise;
    } catch (error) {
        throw new Error("Unable to parse PDF", {
            cause: error,
        });
    }

    const pages = [];
    const pageTexts = [];

    for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
    ) {
        const page = await pdf.getPage(pageNumber);

        const textContent = await page.getTextContent();

        const pageText = textContent.items
            .map((item) => item.str)
            .join(" ")
            .trim();

        let finalText = pageText;

        /*
         * If PDF.js could not extract usable text,
         * render this page and run local Tesseract OCR.
         */
        if (!isUsableText(pageText)) {
            const tempDirectory = await fs.mkdtemp(
                path.join(os.tmpdir(), "pdf-ocr-")
            );

            const imagePath = path.join(
                tempDirectory,
                `page-${pageNumber}.png`
            );

            try {
                await renderPageToImage(page, imagePath);

                finalText = await extractTextFromImage(imagePath);

                if (!isUsableText(finalText)) {
                    throw new Error(
                        `OCR returned empty text for PDF page ${pageNumber}`
                    );
                }
            } catch (error) {
                throw new Error(
                    `OCR failed for PDF page ${pageNumber}`,
                    {
                        cause: error,
                    }
                );
            } finally {
                await fs.rm(tempDirectory, {
                    recursive: true,
                    force: true,
                });
            }
        }

        pages.push({
            page: pageNumber,
            text: finalText,
        });

        pageTexts.push(finalText);
    }

    return {
        text: pageTexts.join("\n\n"),
        pageCount: pdf.numPages,
        pages,
    };
}