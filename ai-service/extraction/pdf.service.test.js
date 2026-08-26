import { extractPdfText } from "./pdf.service.js";

const pdfPath = process.argv[2];

if (!pdfPath) {
    console.error("Usage: node extraction/pdf.service.test.js <pdf-path>");
    process.exit(1);
}

try {
    const result = await extractPdfText(pdfPath);

    console.log("PDF extraction successful");
    console.log("Page count:", result.pageCount);
    console.log("Extracted characters:", result.text.length);

    console.log("\nFirst 1000 characters:\n");
    console.log(result.text.slice(0, 1000));
} catch (error) {
    console.error("PDF extraction failed:", error.message);
    process.exit(1);
}