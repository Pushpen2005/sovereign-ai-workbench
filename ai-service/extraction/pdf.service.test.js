import { extractPdfText } from "./pdf.service.js";

const pdfPath = process.argv[2];

if (!pdfPath) {
    console.error(
        "Usage: node extraction/pdf.service.test.js <pdf-path>"
    );
    process.exit(1);
}

try {
    const result = await extractPdfText(pdfPath);

    console.log("=== PDF EXTRACTION TEST ===");

    console.log("PDF extraction successful");
    console.log("Page count:", result.pageCount);
    console.log("Extracted characters:", result.text.length);

    console.log("\nPages:");

    for (const page of result.pages) {
        console.log(
            `Page ${page.page}: ${page.text.length} characters`
        );

        console.log(page.text.slice(0, 300));
        console.log("---");
    }

    if (result.pages.length !== result.pageCount) {
        throw new Error(
            `Page metadata mismatch: expected ${result.pageCount}, got ${result.pages.length}`
        );
    }

    for (const page of result.pages) {
        if (!Number.isInteger(page.page)) {
            throw new Error("Invalid page number");
        }

        if (typeof page.text !== "string") {
            throw new Error(
                `Page ${page.page} does not contain string text`
            );
        }
    }

    console.log("\n✓ Page metadata valid");
    console.log("✓ Extraction test passed");

} catch (error) {
    console.error(
        "PDF extraction failed:",
        error.message
    );

    if (error.cause) {
        console.error("Cause:", error.cause);
    }

    process.exit(1);
}