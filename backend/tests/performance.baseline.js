/**
 * PHASE 11 — BASELINE LOCAL PERFORMANCE BENCHMARK
 *
 * Measures un-mocked, real local execution timing across all 5 core SovereignAI workflows:
 *   A. RAG Question Pipeline
 *   B. Inspection Workflow & Approval Note
 *   C. Coding Agent & Docker Sandbox Execution
 *   D. Vision Agent & Multimodal Inference
 *   E. OCR & Scanned Document Ingestion
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import { query } from "../src/config/db.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { answerQuestion } from "../../ai-service/rag/rag.service.js";
import { routeTask, TASK_TYPE } from "../../ai-service/router/modelRouter.js";
import { generateAnswer } from "../../ai-service/llm/llm.service.js";
import { executeInSandbox } from "../src/services/sandbox.service.js";
import { runVisionWorkflow } from "../src/services/vision-agent.service.js";
import { runCodingWorkflow } from "../src/services/coding-agent.service.js";
import { runInspectionWorkflow } from "../src/services/inspection-orchestrator.service.js";
import { extractPdfText } from "../../ai-service/extraction/pdf.service.js";
import { extractTextFromImage } from "../../ai-service/extraction/ocr.service.js";
import { buildContext, buildPrompt } from "../../ai-service/rag/rag.service.js";

async function measure(name, fn) {
    const t0 = performance.now();
    const result = await fn();
    const durationMs = Math.round(performance.now() - t0);
    return { name, durationMs, result };
}

export async function runBaselineBenchmark() {
    console.log("==================================================");
    console.log("PHASE 11 — REAL LOCAL PERFORMANCE BASELINE BENCHMARK");
    console.log("==================================================\n");

    const benchmarkResults = {};
    const testOrgId = "ad51f0f1-bca5-4076-8b8f-a8a64faecd76"; // Demo organization
    const testUserId = "491e7dc7-68b7-4119-8fb0-6f4a89d8b8b0"; // Demo user

    // ─────────────────────────────────────────────────────────────
    // [A] RAG Question Pipeline Breakdown
    // ─────────────────────────────────────────────────────────────
    console.log("[A] Benchmarking RAG Question Pipeline");
    const sampleQuery = "What is the maximum allowable bearing temperature for centrifugal pumps?";

    // 1. Model Router Decision
    const mRouter = await measure("Router Decision", () => routeTask(sampleQuery));

    // 2. Embedding Generation
    const mEmbed = await measure("Embedding Generation", () => generateEmbedding(sampleQuery));

    // 3. Qdrant Retrieval
    const mQdrant = await measure("Qdrant Search", () =>
        searchSimilarChunks(mEmbed.result, 5, undefined, { organizationId: testOrgId })
    );

    // 4. Context & Prompt Construction
    const mPrompt = await measure("Context & Prompt Construction", async () => {
        const ctx = buildContext(mQdrant.result.slice(0, 3));
        return buildPrompt(sampleQuery, ctx);
    });

    // 5. LLM Generation
    const mGen = await measure("Ollama Inference", () =>
        generateAnswer(mPrompt.result, mRouter.result.selectedModel)
    );

    // 6. Total End-to-End RAG
    const mTotalRag = await measure("End-to-End RAG", () =>
        answerQuestion(sampleQuery, { organizationId: testOrgId })
    );

    benchmarkResults.rag = {
        routerMs: mRouter.durationMs,
        embeddingMs: mEmbed.durationMs,
        qdrantMs: mQdrant.durationMs,
        contextConstructionMs: mPrompt.durationMs,
        llmInferenceMs: mGen.durationMs,
        totalEndToEndMs: mTotalRag.durationMs,
    };
    console.log("  ✓ RAG Breakdown:", benchmarkResults.rag);

    // ─────────────────────────────────────────────────────────────
    // [B] Inspection Workflow Breakdown
    // ─────────────────────────────────────────────────────────────
    console.log("\n[B] Benchmarking Full Inspection Workflow");
    const fixturesDir = path.resolve(__dirname, "fixtures");
    const inspectionPdf = path.join(fixturesDir, "Inspection_Report_Pump03.pdf");

    if (fs.existsSync(inspectionPdf)) {
        const mInspection = await measure("Inspection Workflow", () =>
            runInspectionWorkflow(inspectionPdf, {
                organizationId: testOrgId,
                userId: testUserId,
                task: "Analyze this inspection report and generate approval note.",
            })
        );
        benchmarkResults.inspection = {
            totalWorkflowMs: mInspection.durationMs,
            status: mInspection.result.status,
            findingsCount: mInspection.result.findings?.length || 0,
            hasApprovalNote: Boolean(mInspection.result.approvalNote),
        };
        console.log("  ✓ Inspection Breakdown:", benchmarkResults.inspection);
    } else {
        benchmarkResults.inspection = { skipped: true, reason: "Fixture not found" };
    }

    // ─────────────────────────────────────────────────────────────
    // [C] Coding Agent & Docker Sandbox Breakdown
    // ─────────────────────────────────────────────────────────────
    console.log("\n[C] Benchmarking Coding Agent & Docker Sandbox Pipeline");
    const codingPrompt = "Write Python code to calculate centrifugal pump hydraulic power (P = Q * H * rho * g / 3.6e6) with Q=100, H=50, rho=1000, g=9.81. Print the power in kW.";

    const mCoding = await measure("Coding Agent Workflow", () =>
        runCodingWorkflow({
            request: codingPrompt,
            organizationId: testOrgId,
            userId: testUserId,
            timeoutMs: 10000,
        })
    );

    // Separate Sandbox direct execution
    const mSandboxDirect = await measure("Direct Sandbox Run", () =>
        executeInSandbox({
            code: "print(100 * 50 * 1000 * 9.81 / 3.6e6)",
            timeoutMs: 10000,
        })
    );

    benchmarkResults.coding = {
        workflowTotalMs: mCoding.durationMs,
        sandboxDirectMs: mSandboxDirect.durationMs,
        dockerExitCode: mSandboxDirect.result.exitCode,
        verified: mCoding.result.verificationResult?.verified ?? true,
    };
    console.log("  ✓ Coding Breakdown:", benchmarkResults.coding);

    // ─────────────────────────────────────────────────────────────
    // [D] Vision Agent Breakdown
    // ─────────────────────────────────────────────────────────────
    console.log("\n[D] Benchmarking Vision Agent Pipeline");
    const canvas = createCanvas(300, 150);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 300, 150);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("Pressure: 42 PSI", 40, 80);
    const gaugeBuffer = canvas.toBuffer("image/png");

    const mVision = await measure("Vision Agent Workflow", () =>
        runVisionWorkflow({
            imageBuffer: gaugeBuffer,
            prompt: "Read the visible pressure gauge value.",
            organizationId: testOrgId,
            userId: testUserId,
            expectedReading: "42 PSI",
        })
    );

    benchmarkResults.vision = {
        totalWorkflowMs: mVision.durationMs,
        validationMs: mVision.result.timings?.validationMs ?? 0,
        routerMs: mVision.result.timings?.routerMs ?? 0,
        modelInferenceMs: mVision.result.timings?.inferenceMs ?? 0,
        parsingMs: mVision.result.timings?.parsingMs ?? 0,
        result: mVision.result.verification?.result ?? "N/A",
    };
    console.log("  ✓ Vision Breakdown:", benchmarkResults.vision);

    // ─────────────────────────────────────────────────────────────
    // [E] OCR & Document Ingestion Breakdown
    // ─────────────────────────────────────────────────────────────
    console.log("\n[E] Benchmarking Document Ingestion & OCR");

    // E1. Text PDF Extraction (Fast path - no OCR)
    let cleanPdfMs = 0;
    if (fs.existsSync(inspectionPdf)) {
        const mCleanPdf = await measure("Clean Text PDF Extraction", () =>
            extractPdfText(inspectionPdf, { organizationId: testOrgId })
        );
        cleanPdfMs = mCleanPdf.durationMs;
    }

    // E2. Tesseract OCR Direct on Raster Image
    const ocrCanvas = createCanvas(400, 100);
    const ocrCtx = ocrCanvas.getContext("2d");
    ocrCtx.fillStyle = "#ffffff";
    ocrCtx.fillRect(0, 0, 400, 100);
    ocrCtx.fillStyle = "#000000";
    ocrCtx.font = "bold 28px sans-serif";
    ocrCtx.fillText("BEARING TEMP 82 C", 30, 60);
    const tempOcrImgPath = path.join(__dirname, `temp_ocr_bench_${Date.now()}.png`);
    fs.writeFileSync(tempOcrImgPath, ocrCanvas.toBuffer("image/png"));

    const mOcrDirect = await measure("Local Tesseract OCR", () =>
        extractTextFromImage(tempOcrImgPath)
    );
    try { fs.unlinkSync(tempOcrImgPath); } catch {}

    benchmarkResults.ocr = {
        cleanPdfExtractMs: cleanPdfMs,
        directTesseractOcrMs: mOcrDirect.durationMs,
        extractedSample: mOcrDirect.result.slice(0, 30),
    };
    console.log("  ✓ OCR Breakdown:", benchmarkResults.ocr);

    console.log("\n==================================================");
    console.log("BASELINE MEASUREMENTS COMPLETE");
    console.log("==================================================");
    console.dir(benchmarkResults, { depth: null });

    return benchmarkResults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runBaselineBenchmark()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("Baseline benchmark failed:", err);
            process.exit(1);
        });
}
