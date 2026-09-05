/**
 * Phase 5: Multimodal Vision + Model Router End-to-End Verification Suite
 *
 * Validates:
 *   1. Model Router task classification (DOCUMENT, CODING, VISION, GENERAL)
 *   2. Model Router evaluation & accuracy measurement on deterministic dataset
 *   3. Sovereign model allowlisting & blocking arbitrary/external models
 *   4. Fail-closed behavior on unavailable vision models
 *   5. Multimodal image validation (magic bytes, disguised files, empty files)
 *   6. Vision API authentication (401 without JWT) & tenant isolation (403 on spoofing)
 *   7. Live local vision inference with synthetic industrial gauge image (moondream)
 *   8. Human governance boundary & advisory disclaimer
 *   9. Vision latency profiling (inference latency, total latency)
 *  10. Zero external cloud AI API dependency audit
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";

import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import {
  classifyTask,
  routeTask,
  TASK_TYPE,
  RouterError,
  isModelAllowed,
  getAllowedModels,
} from "../../ai-service/router/modelRouter.js";
import { validateImageMagicBytes } from "../src/middleware/imageUpload.middleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runPhase5Tests() {
  console.log("==================================================");
  console.log("Phase 5: Local Multimodal Vision + Model Router Suite");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];

  try {
    // ----------------------------------------------------
    // [1] Model Router Task Classification & Evaluation
    // ----------------------------------------------------
    console.log("\n[1] Auditing Model Router Task Classification & Accuracy");

    const evaluationDataset = [
      { input: "What does the Maintenance SOP say about bearing temperature?", expected: TASK_TYPE.DOCUMENT },
      { input: "Write Python code to calculate pump efficiency.", expected: TASK_TYPE.CODING },
      { input: "Generate Python to calculate efficiency", expected: TASK_TYPE.CODING },
      { input: "Analyze this gauge image", expected: TASK_TYPE.VISION },
      { input: "Inspect this photo of the pump casing", expected: TASK_TYPE.VISION },
      { input: "Summarize this retrieved context", expected: TASK_TYPE.DOCUMENT },
      { input: "According to the equipment manual, what was the observed vibration?", expected: TASK_TYPE.DOCUMENT },
      { input: "Debug this function that connects to the database", expected: TASK_TYPE.CODING },
    ];

    let correctClassifications = 0;
    const tRouterStart = Date.now();

    for (const testCase of evaluationDataset) {
      const predicted = classifyTask(testCase.input);
      const isCorrect = predicted === testCase.expected;
      if (isCorrect) correctClassifications++;
      console.log(`  • "${testCase.input.slice(0, 48)}..." -> Got: ${predicted} | Expected: ${testCase.expected} [${isCorrect ? "✅" : "❌"}]`);
      assert.equal(predicted, testCase.expected, `Classification mismatch for: "${testCase.input}"`);
    }

    const routerAccuracy = (correctClassifications / evaluationDataset.length) * 100;
    const avgClassificationLatency = (Date.now() - tRouterStart) / evaluationDataset.length;

    console.log(`  Router Evaluation Summary:`);
    console.log(`    Total Test Items: ${evaluationDataset.length}`);
    console.log(`    Correct: ${correctClassifications}`);
    console.log(`    Accuracy: ${routerAccuracy.toFixed(1)}%`);
    console.log(`    Avg Classification Latency: ${avgClassificationLatency.toFixed(2)} ms`);
    assert.equal(routerAccuracy, 100, "Router accuracy must be 100% on benchmark dataset");

    // ----------------------------------------------------
    // [2] Model Router Vision Modality Precedence
    // ----------------------------------------------------
    console.log("\n[2] Verifying Vision Modality Precedence when Image is Attached");
    const taskWithImage = classifyTask("Describe the equipment in this picture", { hasImage: true });
    assert.equal(taskWithImage, TASK_TYPE.VISION, "hasImage must strictly route to TASK_TYPE.VISION");

    const taskDocWithImage = classifyTask("According to the SOP, what is the temperature limit?", { hasImage: true });
    assert.equal(taskDocWithImage, TASK_TYPE.VISION, "Image presence must take precedence over document keywords");
    console.log("  ✅ PASS: Image presence takes absolute routing precedence (TASK_TYPE.VISION)");

    // ----------------------------------------------------
    // [3] Sovereign Model Allowlisting & Security Matrix
    // ----------------------------------------------------
    console.log("\n[3] Testing Sovereign Model Allowlisting & External Model Blocking");
    const allowed = getAllowedModels();
    console.log("  Allowed Models Set:", Array.from(allowed));

    assert.equal(isModelAllowed("llama3.2:3b"), true);
    assert.equal(isModelAllowed("llama3.2"), true);
    assert.equal(isModelAllowed("moondream"), true);
    assert.equal(isModelAllowed("moondream:latest"), true);

    // Reject unauthorized/external models
    assert.equal(isModelAllowed("gpt-4o"), false);
    assert.equal(isModelAllowed("claude-3-5-sonnet"), false);
    assert.equal(isModelAllowed("external-cloud-vision"), false);
    assert.equal(isModelAllowed("gemini-1.5-pro"), false);
    assert.equal(isModelAllowed(""), false);

    // Test rejection in routeTask
    let blockedInRouter = false;
    try {
      await routeTask("Write a poem", { model: "gpt-4o" });
    } catch (err) {
      blockedInRouter = err.message.includes("not in the sovereign model allowlist");
    }
    assert.equal(blockedInRouter, true, "routeTask must reject unallowed models");
    console.log("  ✅ PASS: Arbitrary external models strictly blocked by server-side allowlist");

    // ----------------------------------------------------
    // [4] Fail-Closed Behavior on Unavailable Models
    // ----------------------------------------------------
    console.log("\n[4] Verifying Fail-Closed Behavior on Unavailable Vision Models");
    let failedClosed = false;
    try {
      process.env.VISION_MODEL = "nonexistent-vision-model:99b";
      await routeTask("Inspect this image", { hasImage: true });
    } catch (err) {
      failedClosed = err instanceof RouterError && err.message.includes("ollama pull nonexistent-vision-model:99b");
    } finally {
      process.env.VISION_MODEL = "moondream";
    }
    assert.equal(failedClosed, true, "Must fail closed with actionable setup guidance when vision model is missing");
    console.log("  ✅ PASS: Controlled fail-closed RouterError thrown for uninstalled vision model");

    // ----------------------------------------------------
    // [5] Image Validation (Magic Bytes & Fake Files)
    // ----------------------------------------------------
    console.log("\n[5] Verifying Binary Magic Bytes & Image Integrity");
    const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    assert.equal(validateImageMagicBytes(validPngHeader), true, "PNG header must be accepted");

    const validJpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    assert.equal(validateImageMagicBytes(validJpgHeader), true, "JPEG header must be accepted");

    const fakeImageBuffer = Buffer.from("Disguised executable or script content pretending to be image.png");
    assert.equal(validateImageMagicBytes(fakeImageBuffer), false, "Disguised file must be rejected");

    const emptyBuffer = Buffer.alloc(0);
    assert.equal(validateImageMagicBytes(emptyBuffer), false, "Empty buffer must be rejected");
    console.log("  ✅ PASS: Magic bytes validation accepts valid PNG/JPEG and rejects disguised files");

    // ----------------------------------------------------
    // [6] Multi-Tenant Authentication & Authorization on Vision API
    // ----------------------------------------------------
    console.log("\n[6] Testing Vision API Authentication & Multi-Tenant Authorization");

    // Set up test organization and user
    const testOrgId = randomUUID();
    cleanupOrgIds.push(testOrgId);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [testOrgId, `Vision Test Org ${testOrgId.slice(0, 8)}`]);

    const testUserId = randomUUID();
    cleanupUserIds.push(testUserId);
    await query(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [testUserId, testOrgId, "Vision Engineer", `vis_eng_${testOrgId.slice(0, 6)}@vision.local`, "mock_hash", "engineer"]
    );

    const validToken = generateToken({
      userId: testUserId,
      organizationId: testOrgId,
      email: `vis_eng_${testOrgId.slice(0, 6)}@vision.local`,
      role: "engineer",
    });

    // 6a. Missing JWT -> 401 Unauthorized
    const noAuthRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
    });
    assert.equal(noAuthRes.status, 401, "Vision API without JWT must return HTTP 401");
    console.log("  ✅ PASS: Unauthenticated Vision API request rejected with HTTP 401 Unauthorized");

    // 6b. Header spoofing (x-organization-id mismatch with JWT) -> 403 Forbidden
    const spoofRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "x-organization-id": randomUUID(),
      },
    });
    assert.equal(spoofRes.status, 403, "Mismatched x-organization-id header must return HTTP 403");
    console.log("  ✅ PASS: Cross-organization header spoofing blocked (HTTP 403 Forbidden)");

    // 6c. Missing image file in multipart form -> 400 Bad Request
    const formDataNoFile = new FormData();
    formDataNoFile.append("prompt", "What do you see?");
    const noFileRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
      body: formDataNoFile,
    });
    assert.equal(noFileRes.status, 400, "Missing image file must return HTTP 400");
    console.log("  ✅ PASS: Missing image file rejected with HTTP 400 Bad Request");

    // 6d. Disguised / fake file upload -> 400 Bad Request
    const fakeBlob = new Blob(["malicious payload pretending to be an image"], { type: "image/png" });
    const formDataFake = new FormData();
    formDataFake.append("image", fakeBlob, "fake_gauge.png");
    formDataFake.append("prompt", "Analyze this image");

    const fakeUploadRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
      body: formDataFake,
    });
    assert.equal(fakeUploadRes.status, 400, "Disguised file must return HTTP 400");
    const fakeData = await fakeUploadRes.json();
    assert.ok(fakeData.message.includes("Invalid image format"));
    console.log("  ✅ PASS: Disguised image file rejected by magic bytes middleware (HTTP 400)");

    // 6e. Arbitrary unallowed model in form -> 400 Bad Request
    const validCanvas = createCanvas(200, 100);
    const vctx = validCanvas.getContext("2d");
    vctx.fillStyle = "white";
    vctx.fillRect(0, 0, 200, 100);
    const validImageBlob = new Blob([validCanvas.toBuffer("image/png")], { type: "image/png" });

    const formDataBadModel = new FormData();
    formDataBadModel.append("image", validImageBlob, "test.png");
    formDataBadModel.append("model", "external-cloud-vision-model");

    const badModelRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
      body: formDataBadModel,
    });
    assert.equal(badModelRes.status, 400, "Unallowed model must return HTTP 400");
    console.log("  ✅ PASS: Request specifying unallowed model rejected with HTTP 400 Bad Request");

    // ----------------------------------------------------
    // [7] Live Local Multimodal Vision Inference (moondream)
    // ----------------------------------------------------
    console.log("\n[7] Executing Live Local Vision Inference on Synthetic Industrial Gauge");

    // Synthesize non-confidential industrial gauge image
    const gaugeCanvas = createCanvas(400, 200);
    const gctx = gaugeCanvas.getContext("2d");
    gctx.fillStyle = "#F8FAFC";
    gctx.fillRect(0, 0, 400, 200);
    gctx.strokeStyle = "#475569";
    gctx.lineWidth = 4;
    gctx.strokeRect(10, 10, 380, 180);

    gctx.fillStyle = "#0F172A";
    gctx.font = "bold 22px sans-serif";
    gctx.fillText("SENSOR CALIBRATION", 65, 55);

    gctx.fillStyle = "#1E293B";
    gctx.font = "bold 38px sans-serif";
    gctx.fillText("42 PSI", 140, 125);

    gctx.fillStyle = "#64748B";
    gctx.font = "14px sans-serif";
    gctx.fillText("Unit: Compressor C-01 Discharge", 90, 165);

    const gaugeBuffer = gaugeCanvas.toBuffer("image/png");
    const gaugeBlob = new Blob([gaugeBuffer], { type: "image/png" });

    const liveFormData = new FormData();
    liveFormData.append("image", gaugeBlob, "industrial_pressure_gauge.png");
    liveFormData.append("prompt", "What pressure reading and label are visible on this gauge image?");

    const tVisionStart = Date.now();
    const liveVisionRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
      },
      body: liveFormData,
    });

    const totalVisionLatencyMs = Date.now() - tVisionStart;
    assert.equal(liveVisionRes.status, 200, "Live vision analysis must succeed with HTTP 200");

    const visionResult = await liveVisionRes.json();
    assert.equal(visionResult.success, true);
    assert.equal(visionResult.taskType, "VISION");
    assert.equal(visionResult.model, "moondream");
    assert.equal(visionResult.processing.local, true);
    assert.equal(visionResult.processing.provider, "ollama");

    console.log(`  Vision Model Output (${totalVisionLatencyMs} ms total, ${visionResult.processing.durationMs} ms model):`);
    console.log(`    Raw Analysis: "${visionResult.analysis.slice(0, 95)}..."`);
    console.log(`    Structured Summary: "${visionResult.structured.summary.slice(0, 60)}..."`);
    console.log(`    Observations: ${visionResult.structured.observations.length}`);
    console.log(`    Abnormalities: ${visionResult.structured.abnormalities.length}`);
    console.log(`    Limitations: ${visionResult.structured.limitations.length}`);
    console.log(`    Governance Notice: "${visionResult.governance}"`);

    // Verify factual detection of 42 PSI or sensor text
    const textCombined = (visionResult.analysis + " " + visionResult.structured.summary + " " + visionResult.structured.observations.join(" ")).toUpperCase();
    const detectedPressure = textCombined.includes("42") || textCombined.includes("PSI") || textCombined.includes("SENSOR");
    assert.equal(detectedPressure, true, "Local vision model must perceive the visible gauge text/number");

    // Verify human governance statement is present
    assert.ok(visionResult.governance.includes("advisory decision support"), "Governance advisory statement must be present");
    console.log("  ✅ PASS: Live local multimodal vision inference passed with zero cloud dependencies");

    // ----------------------------------------------------
    // [8] Sovereignty & Diagnostics Verification
    // ----------------------------------------------------
    console.log("\n[8] Auditing Real-Time Sovereignty Endpoint (/api/v1/sovereignty)");
    const sovRes = await fetch(`${baseUrl}/api/v1/sovereignty`);
    assert.equal(sovRes.status, 200);
    const sovData = await sovRes.json();

    assert.equal(sovData.components.llm.cloudDependency, false);
    assert.equal(sovData.components.embeddings.cloudDependency, false);
    assert.equal(sovData.components.ocr.cloudDependency, false);
    assert.equal(sovData.components.vision.cloudDependency, false);
    assert.equal(sovData.components.vision.reachable, true);
    assert.equal(sovData.components.vision.modelLoaded, true);
    assert.equal(sovData.components.vision.model, "moondream");
    assert.equal(sovData.sovereignty.noExternalAiApis, true);
    assert.equal(sovData.sovereignty.allVisionLocal, true);
    console.log("  ✅ PASS: Real-time sovereignty manifest verified (100% local LLM, Vision, OCR, Embeddings)");

    console.log("\n==================================================");
    console.log("✅ ALL PHASE 5 MULTIMODAL VISION & ROUTER TESTS PASSED");
    console.log("==================================================");
    console.log("Performance Profile:", {
      routerAccuracy: `${routerAccuracy.toFixed(1)}%`,
      avgClassificationLatencyMs: avgClassificationLatency,
      visionInferenceDurationMs: visionResult.processing.durationMs,
      totalVisionLatencyMs: totalVisionLatencyMs,
    });
  } finally {
    server.close();

    // Clean up test data
    for (const oId of cleanupOrgIds) {
      try {
        await query("DELETE FROM agent_runs WHERE organization_id = $1", [oId]);
      } catch {}
    }
    for (const uId of cleanupUserIds) {
      try {
        await query("DELETE FROM users WHERE id = $1", [uId]);
      } catch {}
    }
    for (const oId of cleanupOrgIds) {
      try {
        await query("DELETE FROM organizations WHERE id = $1", [oId]);
      } catch {}
    }
  }
}

runPhase5Tests().catch((err) => {
  console.error("Phase 5 tests failed:", err);
  process.exit(1);
});
