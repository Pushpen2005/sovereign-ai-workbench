import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createCanvas } from "canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdf as renderPdfToImages } from "pdf-to-img";

import { extractTextFromImage } from "./ocr.service.js";

export const MIN_CHARS_PER_PAGE = Number(process.env.OCR_MIN_CHARS_PER_PAGE || 30);
export const MIN_WORDS_PER_PAGE = Number(process.env.OCR_MIN_WORDS_PER_PAGE || 5);
export const MIN_TOTAL_CHARS = Number(process.env.OCR_MIN_TOTAL_CHARS || 50);

/**
 * Deterministically evaluates whether text for a single page meets quality/quantity threshold.
 * Rejects empty, whitespace-only, or stray artifact text.
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {boolean}
 */
export function isPageTextSufficient(text, options = {}) {
    if (typeof text !== "string") return false;
    const clean = text.trim();
    if (clean.length === 0) return false;

    const minChars = options.minCharsPerPage ?? MIN_CHARS_PER_PAGE;
    const minWords = options.minWordsPerPage ?? MIN_WORDS_PER_PAGE;

    if (clean.length < minChars) return false;

    // Word count check (alphanumeric words)
    const words = clean.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
    if (words.length < minWords) return false;

    return true;
}

/**
 * Deterministically evaluates whether a document's extracted text is sufficient.
 *
 * @param {object} input - { text, pageCount, pageTexts }
 * @param {object} [options]
 * @returns {boolean}
 */
export function isTextSufficient({ text, pageCount, pageTexts } = {}, options = {}) {
    if (typeof text !== "string") return false;
    const clean = text.trim();
    if (clean.length === 0) return false;

    const count = Number(pageCount) || 1;
    const minTotal = options.minTotalChars ?? MIN_TOTAL_CHARS;
    const minCharsPerPage = options.minCharsPerPage ?? MIN_CHARS_PER_PAGE;

    if (clean.length < minTotal) return false;

    const avgChars = clean.length / Math.max(1, count);
    if (avgChars < minCharsPerPage) return false;

    if (Array.isArray(pageTexts) && pageTexts.length > 0) {
        const sufficientPages = pageTexts.filter((pt) => isPageTextSufficient(pt, options));
        if (sufficientPages.length < pageTexts.length * 0.5) return false;
    }

    return true;
}

/**
 * Fallback canvas rendering of a single PDF page to PNG.
 */
async function renderPageToImageCanvas(page, outputPath) {
    const scale = 2;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
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
 * Extract text from a PDF file with deterministic text quality checks and local Tesseract OCR fallback.
 *
 * @param {string} filePath - Absolute path to the PDF file.
 * @param {object} [options] - Options (organizationId, minCharsPerPage, minWordsPerPage, forceOcr, onProgress)
 * @returns {Promise<{
 *   text: string,
 *   pageCount: number,
 *   pages: Array<{page: number, text: string, source: string, extractionMethod: string, error?: string}>,
 *   extractionMethod: "pdf-text" | "ocr"
 * }>}
 */
export async function extractPdfText(filePath, options = {}) {
    if (!filePath || typeof filePath !== "string") {
        throw new Error("A valid PDF file path is required");
    }

    try {
        await fs.access(filePath);
    } catch {
        throw new Error("File does not exist");
    }

    if (typeof options.onProgress === "function") {
        options.onProgress({ stage: "reading_pdf", filePath });
    }

    let pdf;
    try {
        const loadingTask = pdfjsLib.getDocument({ url: filePath });
        pdf = await loadingTask.promise;
    } catch (error) {
        throw new Error("Unable to parse PDF", { cause: error });
    }

    if (typeof options.onProgress === "function") {
        options.onProgress({ stage: "checking_text_quality", pageCount: pdf.numPages });
    }

    // Step 1: Initial PDF.js text extraction per page
    const rawPageTexts = [];
    const pdfJsPages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        pdfJsPages.push(page);

        const textContent = await page.getTextContent();
        const pageText = textContent.items
            .map((item) => item.str)
            .join(" ")
            .trim();
        rawPageTexts.push(pageText);
    }

    // Step 2: Evaluate text quality per page and for document
    const pagesNeedingOcr = [];
    for (let i = 0; i < rawPageTexts.length; i++) {
        const pageNum = i + 1;
        const text = rawPageTexts[i];
        if (options.forceOcr || !isPageTextSufficient(text, options)) {
            pagesNeedingOcr.push(pageNum);
        }
    }

    // If no pages need OCR, return pure pdf-text result directly
    if (pagesNeedingOcr.length === 0) {
        const finalPages = rawPageTexts.map((text, i) => ({
            page: i + 1,
            text,
            source: "pdf-text",
            extractionMethod: "pdf-text",
        }));

        return {
            text: rawPageTexts.join("\n\n"),
            pageCount: pdf.numPages,
            pages: finalPages,
            extractionMethod: "pdf-text",
        };
    }

    // Step 3: OCR fallback required for one or more pages
    if (typeof options.onProgress === "function") {
        options.onProgress({
            stage: "ocr_required",
            pagesNeedingOcr,
            totalPages: pdf.numPages,
        });
    }

    // Setup tenant-safe temporary workspace
    const tempDirBase = os.tmpdir();
    const cleanOrgSuffix = options.organizationId ? `-${String(options.organizationId).slice(0, 8)}` : "";
    const tempDirectory = await fs.mkdtemp(path.join(tempDirBase, `ocr${cleanOrgSuffix}-${crypto.randomUUID().slice(0, 8)}-`));

    // Render pages using pdf-to-img or canvas fallback
    let renderedImagesMap = new Map();
    try {
        if (typeof options.onProgress === "function") {
            options.onProgress({ stage: "running_ocr", pages: pagesNeedingOcr });
        }

        try {
            const documentImages = await renderPdfToImages(filePath, { scale: 2 });
            let pIdx = 1;
            for await (const imgBuffer of documentImages) {
                if (pagesNeedingOcr.includes(pIdx)) {
                    renderedImagesMap.set(pIdx, imgBuffer);
                }
                pIdx++;
            }
        } catch (rasterErr) {
            // If pdf-to-img throws, fallback to canvas page rendering
            console.warn(`[PDF OCR] Primary rasterizer warning: ${rasterErr?.message}. Falling back to canvas.`);
            for (const pageNum of pagesNeedingOcr) {
                const page = pdfJsPages[pageNum - 1];
                const tmpImg = path.join(tempDirectory, `fallback-page-${pageNum}.png`);
                await renderPageToImageCanvas(page, tmpImg);
                const buf = await fs.readFile(tmpImg);
                renderedImagesMap.set(pageNum, buf);
            }
        }

        const pages = [];
        const pageTexts = [];
        let anyOcrSucceeded = false;
        let anyPageFailed = false;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const needsOcr = pagesNeedingOcr.includes(pageNumber);
            const initialText = rawPageTexts[pageNumber - 1];

            if (!needsOcr) {
                pages.push({
                    page: pageNumber,
                    text: initialText,
                    source: "pdf-text",
                    extractionMethod: "pdf-text",
                });
                pageTexts.push(initialText);
                continue;
            }

            // Execute local Tesseract OCR on rendered page
            const imgBuffer = renderedImagesMap.get(pageNumber);
            if (!imgBuffer) {
                anyPageFailed = true;
                pages.push({
                    page: pageNumber,
                    text: "",
                    source: "ocr-failed",
                    extractionMethod: "ocr",
                    error: `Failed to rasterize page ${pageNumber} for OCR`,
                });
                continue;
            }

            const imgPath = path.join(tempDirectory, `page-${pageNumber}-${crypto.randomUUID().slice(0, 6)}.png`);
            await fs.writeFile(imgPath, imgBuffer);

            try {
                const ocrText = await extractTextFromImage(imgPath, options.ocrOptions || {});
                const cleanOcrText = typeof ocrText === "string" ? ocrText.trim() : "";

                if (cleanOcrText.length === 0) {
                    throw new Error(`OCR returned empty text for PDF page ${pageNumber}`);
                }

                pages.push({
                    page: pageNumber,
                    text: cleanOcrText,
                    source: "ocr",
                    extractionMethod: "ocr",
                });
                pageTexts.push(cleanOcrText);
                anyOcrSucceeded = true;
            } catch (pageOcrErr) {
                anyPageFailed = true;
                console.warn(`[PDF OCR] Page ${pageNumber} OCR warning: ${pageOcrErr?.message}`);
                pages.push({
                    page: pageNumber,
                    text: "",
                    source: "ocr-failed",
                    extractionMethod: "ocr",
                    error: pageOcrErr.message,
                });
            } finally {
                // Ensure individual page raster is securely cleaned up
                await fs.unlink(imgPath).catch(() => {});
            }
        }

        // Failure handling checks
        const usablePages = pages.filter((p) => p.text && p.text.trim().length > 0);
        if (usablePages.length === 0) {
            throw new Error(
                `OCR processing failed to extract usable text from document: ${path.basename(filePath)}`
            );
        }

        if (typeof options.onProgress === "function") {
            options.onProgress({
                stage: "processing_ocr_pages",
                successfulPages: usablePages.length,
                totalPages: pdf.numPages,
            });
        }

        return {
            text: pageTexts.filter(Boolean).join("\n\n"),
            pageCount: pdf.numPages,
            pages,
            extractionMethod: anyOcrSucceeded ? "ocr" : "pdf-text",
            hasPageFailures: anyPageFailed,
        };
    } finally {
        // Enforce strict temporary directory cleanup
        await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
}