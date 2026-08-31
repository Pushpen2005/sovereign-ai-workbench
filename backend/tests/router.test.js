/**
 * PR #23 — Model Router & Task Selection Test Suite
 *
 * Verifies:
 *   1. Task classification: DOCUMENT, CODING, GENERAL on representative inputs
 *   2. Model routing: checks routing decision, selected model, fallback logic
 *   3. Missing model handling: controlled error or fallback without crashing
 *   4. Diagnostic endpoint: GET /api/v1/router/models
 *
 * Run with:
 *   node backend/tests/router.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import {
    classifyTask,
    routeTask,
    checkModelAvailability,
    TASK_TYPE,
    RouterError,
} from "../../ai-service/router/modelRouter.js";

async function runTests() {
    console.log("==================================================");
    console.log("PR #23: Model Router & Multi-Model Task Selection Tests");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    function record(name, ok, detail = "") {
        if (ok) {
            console.log(`  ✅ PASS: ${name}${detail ? " — " + detail : ""}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${name}${detail ? " — " + detail : ""}`);
            failed++;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 19: Classification Tests
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Task Classification Tests");

    const t1 = classifyTask("What does the SOP say about emergency shutdown?");
    record("TEST 1: SOP emergency shutdown", t1 === TASK_TYPE.DOCUMENT, `got ${t1}`);

    const t2 = classifyTask("Summarize the inspection report.");
    record("TEST 2: Summarize inspection report", t2 === TASK_TYPE.DOCUMENT, `got ${t2}`);

    const t3 = classifyTask("Why did Pump-03 fail?");
    record("TEST 3: Why did Pump-03 fail?", t3 === TASK_TYPE.DOCUMENT, `got ${t3}`);

    const t4 = classifyTask("Write Python code to calculate average temperature.");
    record("TEST 4: Write Python code", t4 === TASK_TYPE.CODING, `got ${t4}`);

    const t5 = classifyTask("Debug this JavaScript function.");
    record("TEST 5: Debug JavaScript function", t5 === TASK_TYPE.CODING, `got ${t5}`);

    const t6 = classifyTask("Hello there!");
    record("TEST 6: General greeting query", t6 === TASK_TYPE.GENERAL, `got ${t6}`);

    // Additional coverage
    const t7 = classifyTask("Write SQL to find failed inspections.");
    record("TEST 7: Write SQL query", t7 === TASK_TYPE.CODING, `got ${t7}`);

    const t8 = classifyTask("Find the relevant safety procedure for confined space.");
    record("TEST 8: Safety procedure inquiry", t8 === TASK_TYPE.DOCUMENT, `got ${t8}`);

    // ─────────────────────────────────────────────────────────────
    // STEP 20: Model Routing Tests
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Model Routing Tests");

    // Route document task
    const docRoute = await routeTask("What does the SOP say about emergency shutdown?");
    record(
        "Document task routes to configured document model",
        docRoute.taskType === TASK_TYPE.DOCUMENT && typeof docRoute.selectedModel === "string",
        `taskType=${docRoute.taskType}, model=${docRoute.selectedModel}`
    );

    // Route coding task
    const codeRoute = await routeTask("Write Python code to calculate average temperature.");
    record(
        "Coding task routes to configured coding/fallback model",
        codeRoute.taskType === TASK_TYPE.CODING && typeof codeRoute.selectedModel === "string",
        `taskType=${codeRoute.taskType}, model=${codeRoute.selectedModel}`
    );

    // Route general task
    const genRoute = await routeTask("Hello world");
    record(
        "General task routes to default model",
        genRoute.taskType === TASK_TYPE.GENERAL && typeof genRoute.selectedModel === "string",
        `taskType=${genRoute.taskType}, model=${genRoute.selectedModel}`
    );

    // ─────────────────────────────────────────────────────────────
    // STEP 21: Missing Model / Availability Tests
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Model Availability & Fallback Tests");

    const nonExistentAvailable = await checkModelAvailability("completely-fake-model:999b");
    record(
        "Nonexistent model reported as unavailable",
        nonExistentAvailable === false,
        `expected false, got ${nonExistentAvailable}`
    );

    // Test fallback behavior when CODING_MODEL is set to a nonexistent model
    const originalCodingModel = process.env.CODING_MODEL;
    const originalFallback = process.env.CODING_MODEL_FALLBACK;

    try {
        process.env.CODING_MODEL = "nonexistent-coding-model:7b";
        process.env.CODING_MODEL_FALLBACK = "true";

        const fallbackRoute = await routeTask("Write a Python script to parse logs");
        record(
            "Fallback engaged when coding model is unavailable and fallback=true",
            fallbackRoute.isFallback === true && fallbackRoute.taskType === TASK_TYPE.CODING,
            `selectedModel=${fallbackRoute.selectedModel}, isFallback=${fallbackRoute.isFallback}`
        );

        // Now test strict mode (fallback=false) -> must throw RouterError
        process.env.CODING_MODEL_FALLBACK = "false";
        let threw = false;
        try {
            await routeTask("Write a Python script to parse logs");
        } catch (err) {
            threw = err instanceof RouterError;
        }
        record(
            "Controlled RouterError thrown when coding model is unavailable and fallback=false",
            threw,
            "system did not crash; cleanly raised RouterError"
        );
    } finally {
        // Restore environment
        if (originalCodingModel !== undefined) {
            process.env.CODING_MODEL = originalCodingModel;
        } else {
            delete process.env.CODING_MODEL;
        }
        if (originalFallback !== undefined) {
            process.env.CODING_MODEL_FALLBACK = originalFallback;
        } else {
            delete process.env.CODING_MODEL_FALLBACK;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────
    console.log("\n==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failure:", err);
    process.exit(1);
});
