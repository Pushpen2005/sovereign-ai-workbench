import { extractTextFromImage } from "./ocr.service.js";

const imagePath = process.argv[2];

if (!imagePath) {
    console.error(
        "Usage: node extraction/ocr.service.test.js <image-path>"
    );
    process.exit(1);
}

try {
    const text = await extractTextFromImage(imagePath);

    console.log("OCR successful");
    console.log("Extracted characters:", text.length);
    console.log("\nExtracted text:\n");
    console.log(text);
} catch (error) {
    console.error("OCR failed:", error.message);
    process.exit(1);
}