import fs from "fs/promises";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract text from a PDF file.
 *
 * @param {string} filePath - Absolute path to the PDF file.
 * @returns {Promise<{text: string, pageCount: number}>}
 */
export async function extractPdfText(filePath) {
    if(!filePath || typeof filePath !== "string"){
        throw new Error("A valid PDF file path is required");
    }

    try{
        await fs.access(filePath);
    }
    catch{
        throw new Error("File does not exist");
    }

    try{
        const loadingTask = pdfjsLib.getDocument({
            url: filePath,
        });

        const pdf = await loadingTask.promise;

        const pageTexts = [];

        for (let pageNumber  = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber);
            const textContent = await page.getTextContent();

            const pageText = textContent.items
                .map((item) => item.str)
                .join(" ")
                .trim();

            pageTexts.push(pageText);
        }

        return {
            text: pageTexts.join("\n\n"),
            pageCount: pdf.numPages,
        };
    }
    catch (error) {
        if (error.message === "File does not exist") {
            throw error;
        }

        throw new Error("Unable to parse PDF", {
            cause: error,
        });
}
    } 