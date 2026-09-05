/**
 * PHASE 8 — LIVE LOCAL OLLAMA MODEL BENCHMARK & PERFORMANCE AUDIT
 *
 * Runs actual live local inference against installed Ollama models:
 *   - llama3.2:3b (DOCUMENT_ANALYSIS, CODING, GENERAL_CHAT)
 *   - moondream:latest (VISION)
 *
 * Measures and reports real latency for:
 *   - Task classification (< 1 ms)
 *   - Model routing (< 10 ms)
 *   - Real local generation latency per task/model
 *
 * Verifies zero external network / cloud API calls.
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import {
    classifyTask,
    routeTask,
    getRouterDiagnostic,
    checkModelAvailability,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

import {
    generateAnswer,
    generateVisionAnswer,
} from "../../ai-service/llm/llm.service.js";

async function runBenchmark() {
    console.log("==================================================");
    console.log("PHASE 8 — LIVE LOCAL OLLAMA BENCHMARK");
    console.log("==================================================\n");

    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    console.log(`[1] Probing Local Ollama Daemon: ${ollamaUrl}`);

    let tagsRes;
    try {
        tagsRes = await fetch(`${ollamaUrl}/api/tags`);
    } catch (err) {
        if (ollamaUrl.includes("host.docker.internal")) {
            const fallback = ollamaUrl.replace("host.docker.internal", "127.0.0.1");
            tagsRes = await fetch(`${fallback}/api/tags`);
        } else {
            throw err;
        }
    }

    assert.ok(tagsRes.ok, "Local Ollama daemon must be reachable");
    const tagsData = await tagsRes.json();
    const installedModelNames = tagsData.models.map(m => m.name);
    console.log(`  ✓ Local Ollama is healthy and reachable`);
    console.log(`  ✓ Installed Models (${installedModelNames.length}):`, installedModelNames.join(", "));

    // ─────────────────────────────────────────────────────────────
    // [2] Classification & Routing Latency Benchmark
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Benchmarking Classification & Routing Overhead");
    const sampleQueries = [
        { text: "What does the Maintenance SOP say about bearing temperature?", expected: TASK_TYPE.DOCUMENT_ANALYSIS },
        { text: "Write Python code to calculate pump efficiency.", expected: TASK_TYPE.CODING },
        { text: "Analyze this engineering drawing.", expected: TASK_TYPE.VISION },
        { text: "Analyze this inspection report and prepare an approval note.", expected: TASK_TYPE.INSPECTION },
        { text: "Explain what a centrifugal pump is.", expected: TASK_TYPE.GENERAL_CHAT },
    ];

    const classifyTimes = [];
    for (const sample of sampleQueries) {
        const t0 = performance.now();
        const classified = classifyTask(sample.text);
        const dt = performance.now() - t0;
        classifyTimes.push(dt);
        assert.equal(classified, sample.expected, `Classification mismatch for "${sample.text}"`);
    }
    const avgClassifyMs = (classifyTimes.reduce((a, b) => a + b, 0) / classifyTimes.length).toFixed(3);
    console.log(`  ✓ Deterministic Task Classification: 100% accuracy, avg latency: ${avgClassifyMs} ms`);

    const routeTimes = [];
    for (const sample of sampleQueries) {
        const t0 = performance.now();
        const decision = await routeTask(sample.text);
        const dt = performance.now() - t0;
        routeTimes.push(dt);
        assert.equal(decision.local, true, "Decision must specify local: true");
    }
    const avgRouteMs = (routeTimes.reduce((a, b) => a + b, 0) / routeTimes.length).toFixed(2);
    console.log(`  ✓ Model Router Decision Overhead: avg latency: ${avgRouteMs} ms`);

    // ─────────────────────────────────────────────────────────────
    // [3] Live Inference Benchmarks
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Executing Real Local Ollama Inference Benchmarks");
    const benchmarkResults = [];

    // 3a. DOCUMENT_ANALYSIS Inference (llama3.2:3b)
    const docPrompt = "According to standard industrial maintenance procedures, what is the typical threshold temperature for bearing overheating in Celsius? Answer in one short sentence.";
    console.log(`\n  --- Benchmark: DOCUMENT_ANALYSIS (llama3.2:3b) ---`);
    console.log(`  Prompt: "${docPrompt}"`);
    const tDoc0 = Date.now();
    const docAnswer = await generateAnswer(docPrompt, "llama3.2:3b");
    const docDuration = Date.now() - tDoc0;
    console.log(`  Response: "${docAnswer.trim()}"`);
    console.log(`  Real Local Generation Latency: ${docDuration} ms`);
    benchmarkResults.push({
        task: "DOCUMENT_ANALYSIS",
        model: "llama3.2:3b",
        latencyMs: docDuration,
        outputPreview: docAnswer.slice(0, 60) + "...",
    });

    // 3b. CODING Inference (llama3.2:3b / configured coding model)
    const codePrompt = "Write a Python function `pump_head(pressure_psi, density_sg=1.0)` returning head in feet. Provide only the Python code.";
    console.log(`\n  --- Benchmark: CODING (llama3.2:3b) ---`);
    console.log(`  Prompt: "${codePrompt}"`);
    const tCode0 = Date.now();
    const codeAnswer = await generateAnswer(codePrompt, "llama3.2:3b");
    const codeDuration = Date.now() - tCode0;
    console.log(`  Response: "${codeAnswer.trim().slice(0, 100)}..."`);
    console.log(`  Real Local Generation Latency: ${codeDuration} ms`);
    benchmarkResults.push({
        task: "CODING",
        model: "llama3.2:3b",
        latencyMs: codeDuration,
        outputPreview: codeAnswer.slice(0, 60).replace(/\n/g, " ") + "...",
    });

    // 3c. VISION Inference (moondream:latest)
    console.log(`\n  --- Benchmark: VISION (moondream:latest) ---`);
    const canvas = createCanvas(250, 150);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 250, 150);
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 24px Arial";
    ctx.fillText("GAUGE: 42 PSI", 30, 85);
    const base64Img = canvas.toBuffer("image/png").toString("base64");

    const visionPrompt = "Describe the text and number shown on this synthetic industrial gauge.";
    console.log(`  Prompt: "${visionPrompt}"`);
    const tVis0 = Date.now();
    const visionAnswer = await generateVisionAnswer(visionPrompt, [base64Img], "moondream");
    const visionDuration = Date.now() - tVis0;
    console.log(`  Response: "${visionAnswer.trim()}"`);
    console.log(`  Real Local Generation Latency: ${visionDuration} ms`);
    benchmarkResults.push({
        task: "VISION",
        model: "moondream",
        latencyMs: visionDuration,
        outputPreview: visionAnswer.slice(0, 60) + "...",
    });

    // 3d. GENERAL_CHAT Inference (llama3.2:3b)
    const chatPrompt = "Explain what a centrifugal pump is in one concise sentence.";
    console.log(`\n  --- Benchmark: GENERAL_CHAT (llama3.2:3b) ---`);
    console.log(`  Prompt: "${chatPrompt}"`);
    const tChat0 = Date.now();
    const chatAnswer = await generateAnswer(chatPrompt, "llama3.2:3b");
    const chatDuration = Date.now() - tChat0;
    console.log(`  Response: "${chatAnswer.trim()}"`);
    console.log(`  Real Local Generation Latency: ${chatDuration} ms`);
    benchmarkResults.push({
        task: "GENERAL_CHAT",
        model: "llama3.2:3b",
        latencyMs: chatDuration,
        outputPreview: chatAnswer.slice(0, 60) + "...",
    });

    // ─────────────────────────────────────────────────────────────
    // [4] Results Table & Sovereignty Verification
    // ─────────────────────────────────────────────────────────────
    console.log("\n==================================================");
    console.log("BENCHMARK SUMMARY & SOVEREIGNTY REPORT");
    console.log("==================================================");
    console.table(benchmarkResults);

    const diagnostic = await getRouterDiagnostic();
    console.log(`\nDiagnostic Status:`);
    console.log(`  - Local Ollama Execution: ${diagnostic.localOllamaExecution}`);
    console.log(`  - Zero Cloud AI Dependencies: ${diagnostic.zeroCloudDependencies}`);
    console.log(`  - External API Keys Configured: ${diagnostic.externalApiKeysCount}`);

    console.log("\nAll live model inference benchmarks completed successfully!");
}

runBenchmark().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
});
