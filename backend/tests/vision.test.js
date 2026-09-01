/**
 * PR #25 — Multimodal Vision Test Suite
 *
 * Validates:
 *   1. Image Magic Bytes & Validation (PNG, JPEG, WebP, Fake/disguised files)
 *   2. Model Router Vision Modality (hasImage triggers TASK_TYPE.VISION)
 *   3. Missing Vision Model Fail-Closed Handling (RouterError with setup instruction)
 *   4. Structured Analysis Text Parser (Summary, Observations, Abnormalities, Limitations)
 *   5. Sovereignty & Dependency Audit (Zero cloud vision SDKs / APIs)
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { validateImageMagicBytes } from "../src/middleware/imageUpload.middleware.js";
import { extractStructuredVisionAnalysis } from "../src/controllers/vision.controller.js";
import { classifyTask, routeTask, TASK_TYPE, RouterError } from "../../ai-service/router/modelRouter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("==================================================");
console.log("PR #25: Local Multimodal Vision Test Suite");
console.log("==================================================\n");

let passed = 0;
let failed = 0;

function report(testName, ok, detail = "") {
    if (ok) {
        console.log(`  ✅ PASS: ${testName}${detail ? ` — ${detail}` : ""}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
        failed++;
    }
}

// ─── 1. Magic Bytes & Image Integrity ─────────────────────────────────────────
console.log("[1] Image Binary Magic Bytes & Validation");

// 1.1 Valid PNG signature
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
report("Valid PNG signature accepted", validateImageMagicBytes(pngHeader) === true);

// 1.2 Valid JPEG signature
const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
report("Valid JPEG signature accepted", validateImageMagicBytes(jpegHeader) === true);

// 1.3 Valid WebP signature
const webpHeader = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x00, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, // "WEBP"
]);
report("Valid WebP signature accepted", validateImageMagicBytes(webpHeader) === true);

// 1.4 Fake image (text file masquerading as png)
const fakeImage = Buffer.from("Hello world, this is a plain text file pretending to be image.png");
report("Disguised text file rejected", validateImageMagicBytes(fakeImage) === false);

// 1.5 Real fixture image verification
const fixturePath = path.join(__dirname, "fixtures/synthetic_pump_inspection.png");
if (fs.existsSync(fixturePath)) {
    const fixtureBuffer = fs.readFileSync(fixturePath);
    report(
        "Synthetic industrial pump PNG fixture passes validation",
        validateImageMagicBytes(fixtureBuffer) === true,
        `size=${fixtureBuffer.length} bytes`
    );
}

// ─── 2. Model Router Vision Modality ──────────────────────────────────────────
console.log("\n[2] Model Router Vision Modality Classification");

// 2.1 hasImage option sets TASK_TYPE.VISION
const taskWithImage = classifyTask("Describe this pump", { hasImage: true });
report(
    "Image input classifies as TASK_TYPE.VISION",
    taskWithImage === TASK_TYPE.VISION,
    `got ${taskWithImage}`
);

// 2.2 Text-only coding query remains CODING
const taskCoding = classifyTask("Write python code to compute average");
report(
    "Coding task remains CODING",
    taskCoding === TASK_TYPE.CODING,
    `got ${taskCoding}`
);

// 2.3 Text-only document query remains DOCUMENT
const taskDoc = classifyTask("According to the SOP, what is the pressure threshold?");
report(
    "Document task remains DOCUMENT",
    taskDoc === TASK_TYPE.DOCUMENT,
    `got ${taskDoc}`
);

// ─── 3. Missing Vision Model Handling (Fail-Closed) ───────────────────────────
console.log("\n[3] Missing Vision Model Availability & Fail-Closed Behavior");

// Test that when a vision model is not installed, routeTask throws a controlled RouterError
// rather than silently downloading or calling an external API
try {
    process.env.VISION_MODEL = "nonexistent-vision-model:1.8b";
    await routeTask("Inspect this image", { hasImage: true });
    report("Controlled RouterError thrown on unavailable vision model", false, "did not throw");
} catch (err) {
    const isRouterError = err instanceof RouterError;
    const mentionsPull = err.message.includes("ollama pull nonexistent-vision-model:1.8b");
    report(
        "Controlled RouterError thrown on unavailable vision model",
        isRouterError && mentionsPull,
        `clean error: "${err.message}"`
    );
}

// ─── 4. Structured Output Extraction ──────────────────────────────────────────
console.log("\n[4] Structured Output Extraction");

const sampleModelOutput = `
This is an industrial centrifugal pump casing inspection image.
Visible components:
- Impeller shaft and discharge flange
- Cast iron casing with structural bolts
- Equipment identification plate PUMP-P102

Abnormalities and defects:
- An apparent surface crack is visible near the lower bearing housing section
- Minor discoloration near the flange connection

Limitations:
- Resolution limits micro-crack detection
- Rear of the pump is occluded from this camera angle
`;

const structured = extractStructuredVisionAnalysis(sampleModelOutput);
report(
    "Structured extraction parses summary",
    structured.summary.includes("centrifugal pump casing"),
    structured.summary
);
report(
    "Structured extraction parses observations",
    structured.observations.length >= 2,
    `count=${structured.observations.length}`
);
report(
    "Structured extraction parses abnormalities",
    structured.abnormalities.some((a) => a.toLowerCase().includes("crack")),
    `detected crack finding`
);
report(
    "Structured extraction parses limitations",
    structured.limitations.length >= 1,
    `count=${structured.limitations.length}`
);

// ─── 5. Sovereignty & Cloud Vision Audit ───────────────────────────────────────
console.log("\n[5] Sovereignty & Cloud Vision Audit");

const visionControllerCode = fs.readFileSync(path.join(__dirname, "../src/controllers/vision.controller.js"), "utf8");
const forbiddenTerms = [
    "openai",
    "anthropic",
    "gemini",
    "azure",
    "rekognition",
    "cloud.google.com",
    "api.openai.com",
];

const foundForbidden = forbiddenTerms.filter((term) => visionControllerCode.toLowerCase().includes(term));
report(
    "Zero external cloud vision APIs in vision controller",
    foundForbidden.length === 0,
    foundForbidden.length === 0 ? "100% on-premise local Ollama" : `Found: ${foundForbidden.join(", ")}`
);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n==================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("==================================================");

if (failed > 0) {
    process.exit(1);
}
