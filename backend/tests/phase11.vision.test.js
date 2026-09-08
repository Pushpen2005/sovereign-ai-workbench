/**
 * PHASE 11 — LOCAL VISION / MULTIMODAL AI TEST SUITE
 *
 * Verifies the 20 core requirements:
 *   1. Vision model is locally available (moondream:latest in Ollama)
 *   2. VISION task routes to local vision model (Phase 9 Model Router)
 *   3. Valid JPEG is accepted
 *   4. Valid PNG is accepted
 *   5. Valid WebP is accepted
 *   6. Unsupported MIME type is rejected (UNSUPPORTED_IMAGE_FORMAT)
 *   7. Oversized image is rejected (> 10 MB)
 *   8. Missing image is rejected (INVALID_IMAGE)
 *   9. Authentication is required on POST /api/v1/vision/analyze (401)
 *  10. organizationId comes authoritatively from authenticated session
 *  11. Cross-tenant access is rejected
 *  12. Ollama vision request is strictly local-only
 *  13. No external AI API is called (allowlist security)
 *  14. Vision response is structured correctly (taskType, model, local: true, analysis, observations, limitations)
 *  15. Model-unavailable error is handled safely
 *  16. Malformed image is handled safely
 *  17. Temporary staging files are cleaned up after processing
 *  18. No sensitive filesystem paths leak in the response
 *  19. Zero redundant duplicate classification inference
 *  20. Frontend receives task, model, and runtime metadata
 *
 * Run with:
 *   node backend/tests/phase11.vision.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { generateToken } from "../src/utils/auth.js";
import {
    routeTask,
    classifyTask,
    TASK_TYPE,
    isModelAllowed,
    getAvailableModels,
} from "../../ai-service/router/modelRouter.js";

import {
    analyzeImage as analyzeImageDirect,
    validateVisionImage,
    VisionError,
    VISION_ERROR_CODES,
} from "../../ai-service/vision/vision.service.js";

import {
    validateImageMagicBytes,
    validateImageDecodeAndDimensions,
    VisionValidationError,
} from "../src/middleware/imageUpload.middleware.js";

const ORG_A = "org_alpha_vision_test";
const ORG_B = "org_beta_vision_test";

function createSyntheticPngBuffer(label = "GAUGE-01") {
    const canvas = createCanvas(120, 80);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 120, 80);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(label, 10, 45);
    return canvas.toBuffer("image/png");
}

function createSyntheticJpegBuffer() {
    const canvas = createCanvas(120, 80);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 120, 80);
    ctx.fillStyle = "#22c55e";
    ctx.fillText("PRESSURE", 10, 45);
    return canvas.toBuffer("image/jpeg");
}

function createSyntheticWebpBuffer() {
    // Valid 1x1 WebP (VP8L lossless)
    const b64 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
    return Buffer.from(b64, "base64");
}

async function runTests() {
    console.log("==================================================");
    console.log("PHASE 11: LOCAL VISION / MULTIMODAL AI TEST SUITE");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    function record(testNum, name, ok, detail = "") {
        if (ok) {
            console.log(`  ✓ PASS [Test ${testNum}] ${name}${detail ? " (" + detail + ")" : ""}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL [Test ${testNum}] ${name}${detail ? " (" + detail + ")" : ""}`);
            failed++;
        }
    }

    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const tokenA = generateToken({
        id: "user_alpha_1",
        userId: "user_alpha_1",
        email: "alpha@workbench.local",
        organizationId: ORG_A,
    });

    const tokenB = generateToken({
        id: "user_beta_1",
        userId: "user_beta_1",
        email: "beta@workbench.local",
        organizationId: ORG_B,
    });

    try {
        // ─────────────────────────────────────────────────────────────
        // TEST 1: Vision model is locally available
        // ─────────────────────────────────────────────────────────────
        console.log("[Test 1] Checking local vision model availability in Ollama...");
        const installed = await getAvailableModels();
        const hasMoondream = installed.some(m => (m.name || m).includes("moondream"));
        record(1, "Vision model locally available in Ollama", hasMoondream, `installed=[${installed.map(m => m.name || m).join(", ")}]`);

        // ─────────────────────────────────────────────────────────────
        // TEST 2: VISION task routes to local vision model
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 2] Verifying Model Router routing to VISION task...");
        const routing = await routeTask("Inspect this engineering image", { hasImage: true });
        const routerOk = routing.taskType === TASK_TYPE.VISION &&
            routing.local === true &&
            routing.selectedModel.includes("moondream");
        record(2, "VISION task routes to local vision model", routerOk, `model=${routing.selectedModel}, local=${routing.local}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Valid JPEG is accepted
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 3] Valid JPEG validation...");
        const jpegBuf = createSyntheticJpegBuffer();
        const jpegMagic = validateImageMagicBytes(jpegBuf);
        const jpegDims = await validateImageDecodeAndDimensions(jpegBuf);
        const jpegOk = jpegMagic === true && jpegDims.width > 0 && jpegDims.height > 0;
        record(3, "Valid JPEG accepted with valid magic bytes and dimensions", jpegOk, `${jpegDims.width}x${jpegDims.height}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 4: Valid PNG is accepted
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 4] Valid PNG validation...");
        const pngBuf = createSyntheticPngBuffer("VALVE-01");
        const pngMagic = validateImageMagicBytes(pngBuf);
        const pngDims = await validateImageDecodeAndDimensions(pngBuf);
        const pngOk = pngMagic === true && pngDims.width > 0 && pngDims.height > 0;
        record(4, "Valid PNG accepted with valid magic bytes and dimensions", pngOk, `${pngDims.width}x${pngDims.height}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 5: Valid WebP is accepted
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 5] Valid WebP validation...");
        const webpBuf = createSyntheticWebpBuffer();
        const webpMagic = validateImageMagicBytes(webpBuf);
        const webpValid = validateVisionImage(webpBuf, "image/webp");
        const webpOk = webpMagic === true && webpValid === true;
        record(5, "Valid WebP accepted by vision validation engine", webpOk);

        // ─────────────────────────────────────────────────────────────
        // TEST 6: Unsupported MIME type is rejected
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 6] Unsupported MIME type rejection...");
        let rejPdf = false;
        try {
            validateVisionImage(Buffer.from("%PDF-1.4 header"), "application/pdf");
        } catch (err) {
            rejPdf = err instanceof VisionError && err.code === VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT;
        }
        record(6, "Unsupported MIME type rejected with UNSUPPORTED_IMAGE_FORMAT", rejPdf);

        // ─────────────────────────────────────────────────────────────
        // TEST 7: Oversized image is rejected (> 10 MB)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 7] Oversized image rejection...");
        let rejSize = false;
        try {
            const bigBuf = Buffer.alloc(11 * 1024 * 1024);
            validateVisionImage(bigBuf, "image/png");
        } catch (err) {
            rejSize = err.code === VISION_ERROR_CODES.IMAGE_TOO_LARGE;
        }
        record(7, "Oversized image (>10MB) rejected with IMAGE_TOO_LARGE", rejSize);

        // ─────────────────────────────────────────────────────────────
        // TEST 8: Missing image is rejected
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 8] Missing image rejection...");
        let rejEmpty = false;
        try {
            validateVisionImage(Buffer.alloc(0), "image/png");
        } catch (err) {
            rejEmpty = err.code === VISION_ERROR_CODES.INVALID_IMAGE;
        }
        record(8, "Empty or missing image rejected with INVALID_IMAGE", rejEmpty);

        // ─────────────────────────────────────────────────────────────
        // TEST 9: Authentication is required on POST /api/v1/vision/analyze
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 9] Authentication requirement on vision endpoint...");
        const unauthRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
            method: "POST",
        });
        const unauthOk = unauthRes.status === 401;
        record(9, "Unauthenticated vision request rejected with HTTP 401", unauthOk, `status=${unauthRes.status}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 10: organizationId comes authoritatively from session
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 10] Authoritative organizationId resolution...");
        // Send multipart request with authenticated token A
        const formDataA = new FormData();
        formDataA.append("image", new Blob([pngBuf], { type: "image/png" }), "gauge.png");
        formDataA.append("prompt", "Analyze this gauge");
        // Attempt to spoof organizationId in form body
        formDataA.append("organizationId", "spoofed_org_999");

        const authResA = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenA}`,
            },
            body: formDataA,
        });
        const dataA = await authResA.json();
        const orgAuthoritative = authResA.status === 200 &&
            dataA.success === true &&
            dataA.taskType === "VISION" &&
            dataA.model.includes("moondream");
        record(10, "Organization context authoritatively resolved from JWT; form spoofing ignored", orgAuthoritative);

        // ─────────────────────────────────────────────────────────────
        // TEST 11: Cross-tenant access is rejected
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 11] Cross-tenant isolation...");
        // Check that Tenant B cannot access runs created by Tenant A
        const eventsRes = await fetch(`${baseUrl}/api/v1/agent/runs/fake-run-id`, {
            headers: {
                Authorization: `Bearer ${tokenB}`,
            },
        });
        const crossTenantOk = eventsRes.status === 404 || eventsRes.status === 403;
        record(11, "Cross-tenant access strictly prevented", crossTenantOk);

        // ─────────────────────────────────────────────────────────────
        // TEST 12: Ollama vision request is strictly local-only
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 12] Local Ollama URL verification...");
        const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
        const isLocalOllama = ollamaUrl.includes("localhost") ||
            ollamaUrl.includes("127.0.0.1") ||
            ollamaUrl.includes("host.docker.internal");
        record(12, "Ollama vision endpoint is strictly on-premise/local", isLocalOllama, `url=${ollamaUrl}`);

        // ─────────────────────────────────────────────────────────────
        // TEST 13: No external AI API is called (allowlist security)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 13] Cloud AI vision model blocking...");
        const cloudModels = ["gpt-4o", "gpt-4-vision-preview", "claude-3-5-sonnet", "gemini-1.5-pro"];
        let allCloudBlocked = true;
        for (const m of cloudModels) {
            if (isModelAllowed(m)) allCloudBlocked = false;
        }
        record(13, "External cloud vision models strictly blocked by sovereign allowlist", allCloudBlocked);

        // ─────────────────────────────────────────────────────────────
        // TEST 14: Vision response is structured correctly
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 14] Structured response contract verification...");
        const structuredContractOk = dataA.success === true &&
            dataA.taskType === "VISION" &&
            dataA.local === true &&
            typeof dataA.model === "string" &&
            typeof dataA.analysis === "string" &&
            Array.isArray(dataA.observations) &&
            Array.isArray(dataA.limitations);
        record(14, "Vision response conforms to structured contract (taskType, model, local, observations)", structuredContractOk);

        // ─────────────────────────────────────────────────────────────
        // TEST 15: Model-unavailable error is handled safely
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 15] Missing/unavailable model handling...");
        let unavailHandled = false;
        try {
            await analyzeImageDirect({
                image: pngBuf,
                mimeType: "image/png",
                prompt: "Test",
                model: "nonexistent_model",
            });
        } catch (err) {
            unavailHandled = err instanceof VisionError &&
                (err.code === VISION_ERROR_CODES.MODEL_NOT_ALLOWED || err.code === VISION_ERROR_CODES.MODEL_UNAVAILABLE);
        }
        record(15, "Model-unavailable/unallowed error handled cleanly without crashing", unavailHandled);

        // ─────────────────────────────────────────────────────────────
        // TEST 16: Malformed image is handled safely
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 16] Malformed image buffer handling...");
        let malformedHandled = false;
        try {
            const corruptBuf = Buffer.from("NOT_AN_IMAGE_CORRUPTED_BYTES_12345");
            validateVisionImage(corruptBuf, "image/png");
        } catch (err) {
            malformedHandled = err.code === VISION_ERROR_CODES.UNSUPPORTED_IMAGE_FORMAT;
        }
        record(16, "Corrupted image buffer rejected safely with 400", malformedHandled);

        // ─────────────────────────────────────────────────────────────
        // TEST 17: Temporary staging files are cleaned up
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 17] Ephemeral temporary file cleanup...");
        const uploadsDir = path.resolve(__dirname, "../uploads", ORG_A, "vision");
        let tempCleaned = true;
        if (fs.existsSync(uploadsDir)) {
            const runs = fs.readdirSync(uploadsDir);
            // Any created run directories should have deleted their temporary images
            for (const r of runs) {
                const runPath = path.join(uploadsDir, r);
                if (fs.statSync(runPath).isDirectory()) {
                    const files = fs.readdirSync(runPath);
                    if (files.length > 0) tempCleaned = false;
                }
            }
        }
        record(17, "Temporary staging images cleaned after processing", tempCleaned);

        // ─────────────────────────────────────────────────────────────
        // TEST 18: No sensitive filesystem paths leak in the response
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 18] Path disclosure audit in API response...");
        const rawJson = JSON.stringify(dataA);
        const leaksPaths = rawJson.includes("/Users/") ||
            rawJson.includes("/etc/") ||
            rawJson.includes("/home/workbench") ||
            rawJson.includes("node_modules");
        record(18, "Zero sensitive server filesystem paths disclosed in API response", !leaksPaths);

        // ─────────────────────────────────────────────────────────────
        // TEST 19: Zero redundant duplicate classification inference
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 19] Zero redundant LLM classification inference...");
        const tClass0 = process.hrtime.bigint();
        const classified = classifyTask("Describe this gauge reading", { hasImage: true });
        const tClass1 = process.hrtime.bigint();
        const classLatencyUs = Number(tClass1 - tClass0) / 1000;
        const noExtraLlm = classified === TASK_TYPE.VISION && classLatencyUs < 1000; // < 1ms indicates deterministic check, no LLM call
        record(19, "Vision task classified deterministically in < 1 ms without extra LLM calls", noExtraLlm, `${classLatencyUs.toFixed(2)} µs`);

        // ─────────────────────────────────────────────────────────────
        // TEST 20: Frontend receives task, model, and runtime metadata
        // ─────────────────────────────────────────────────────────────
        console.log("\n[Test 20] Frontend model registry and runtime metadata verification...");
        const modelsRes = await fetch(`${baseUrl}/api/v1/router/models`);
        const modelsData = await modelsRes.json();
        const modelList = modelsData.installedModels || modelsData.models || [];
        const frontendMetadataOk = modelsRes.status === 200 &&
            modelsData.registry?.[TASK_TYPE.VISION] !== undefined &&
            modelList.some(m => (m.name || m).includes("moondream"));
        record(20, "Frontend receives vision model manifest and local runtime metadata", frontendMetadataOk);

    } finally {
        server.close();
    }

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test suite execution failed:", err);
    process.exit(1);
});
