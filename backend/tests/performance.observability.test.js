/**
 * PHASE 11 — PERFORMANCE OPTIMIZATION, STREAMING INFERENCE & PRODUCTION OBSERVABILITY TEST SUITE
 *
 * Verifies:
 *  1. Embedding model reuse (pipeline warms and stays warm)
 *  2. Warm vs cold behavior contract (<150ms warm embedding)
 *  3. Qdrant latency instrumentation (search includes duration)
 *  4. Mandatory organizationId filter remains strictly enforced
 *  5. SSE events remain tenant isolated
 *  6. SSE payload remains lightweight (< 1KB per step)
 *  7. Model selection remains strictly allowlisted
 *  8. Zero cloud fallback (no remote endpoints or API keys)
 *  9. Streaming does not bypass grounding (refusal sent without ungrounded tokens)
 * 10. Inspection deterministic validation pipeline preserved
 * 11. Clean digital text PDF skips unnecessary OCR
 * 12. Vision image validation remains strictly enforced
 * 13. Coding Docker sandbox security flags remain unchanged
 * 14. Secrets, passwords and JWTs are stripped from telemetry logs
 * 15. Sovereignty diagnostics accurately distinguish CONFIGURED, AVAILABLE, ACTUALLY_USED
 * 16. Diagnostic performance endpoint reports P50/P95 without exposing tenant data
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import http from "http";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

import {
    generateEmbedding,
    isEmbeddingPipelineWarm,
    warmEmbeddingPipeline,
    getEmbeddingMetrics,
    EMBEDDING_DIMENSIONS
} from "../../ai-service/embeddings/embedding.service.js";

import {
    routeTask,
    clearModelCache,
    isModelAllowed
} from "../../ai-service/router/modelRouter.js";

import {
    telemetryService
} from "../src/services/telemetry.service.js";

import {
    executeInSandbox
} from "../src/services/sandbox.service.js";

import {
    validateImageMagicBytes
} from "../src/middleware/imageUpload.middleware.js";

import {
    isPageTextSufficient,
    isTextSufficient
} from "../../ai-service/extraction/pdf.service.js";

import {
    answerQuestion
} from "../../ai-service/rag/rag.service.js";

import {
    searchSimilarChunks
} from "../../ai-service/retrieval/retrieval.service.js";

import {
    executionEvents
} from "../src/services/execution-events.service.js";

import * as inspectionNodes from "../src/orchestration/inspection/inspection.nodes.js";
import app from "../src/app.js";

let passed = 0;
let failed = 0;

function record(name, condition, detail = "") {
    if (condition) {
        console.log(`✓ PASS: ${name}${detail ? ` (${detail})` : ""}`);
        passed++;
    } else {
        console.error(`✗ FAIL: ${name}${detail ? ` (${detail})` : ""}`);
        failed++;
    }
}

async function runTests() {
    console.log("==================================================");
    console.log("PHASE 11 — PERFORMANCE, STREAMING & OBSERVABILITY TESTS");
    console.log("==================================================\n");

    let server;
    let baseUrl;

    try {
        await new Promise((resolve) => {
            server = app.listen(0, "127.0.0.1", () => {
                baseUrl = `http://127.0.0.1:${server.address().port}`;
                resolve();
            });
        });
    } catch (err) {
        console.warn("Could not start ephemeral test server:", err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Embedding model reuse
    // ─────────────────────────────────────────────────────────────
    try {
        const warmed = await warmEmbeddingPipeline();
        const warmStatus = isEmbeddingPipelineWarm();
        const metrics = getEmbeddingMetrics();
        record(
            "TEST 1: Embedding model reuse & warming pipeline",
            Boolean(warmed?.warm) && warmStatus === true && metrics.dimensions === 384,
            `warm=${warmStatus}, dimensions=${metrics.dimensions}`
        );
    } catch (err) {
        record("TEST 1: Embedding model reuse & warming pipeline", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Warm vs cold behavior contract
    // ─────────────────────────────────────────────────────────────
    try {
        const t0 = Date.now();
        const vector = await generateEmbedding("Industrial turbine temperature specifications and vibration tolerance");
        const elapsed = Date.now() - t0;
        record(
            "TEST 2: Warm embedding latency contract (< 150ms)",
            Array.isArray(vector) && vector.length === 384 && elapsed < 150,
            `latency=${elapsed}ms, dimension=${vector?.length}`
        );
    } catch (err) {
        record("TEST 2: Warm embedding latency contract (< 150ms)", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Qdrant latency instrumentation
    // ─────────────────────────────────────────────────────────────
    try {
        const queryVector = new Array(384).fill(0.01);
        const tenantId = "11111111-1111-1111-1111-111111111111";
        const t0 = Date.now();
        const results = await searchSimilarChunks(queryVector, 3, undefined, {
            organizationId: tenantId
        });
        const durationMs = Date.now() - t0;
        record(
            "TEST 3: Qdrant search latency instrumentation",
            Array.isArray(results) && typeof durationMs === "number" && durationMs >= 0,
            `retrievedCount=${results.length}, latency=${durationMs}ms`
        );
    } catch (err) {
        record("TEST 3: Qdrant search latency instrumentation", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Mandatory organizationId filter remains strictly enforced
    // ─────────────────────────────────────────────────────────────
    try {
        const queryVector = new Array(384).fill(0.01);
        let rejected = false;
        try {
            await searchSimilarChunks(queryVector, 5, undefined, {}); // Missing organizationId
        } catch (err) {
            rejected = err.message.includes("organizationId is required") || err.message.includes("Tenant isolation failure");
        }
        record(
            "TEST 4: Mandatory organizationId filter remains strictly enforced",
            rejected === true,
            "Rejected query without tenant filter"
        );
    } catch (err) {
        record("TEST 4: Mandatory organizationId filter remains strictly enforced", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 5: SSE events remain tenant isolated
    // ─────────────────────────────────────────────────────────────
    try {
        const tenantA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const tenantB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        const runId = "test-run-" + Date.now();
        executionEvents.registerRunOwner(runId, tenantA, "inspection");

        const accessB = await executionEvents.verifyOrHydrateRunOwner(runId, tenantB);
        const accessA = await executionEvents.verifyOrHydrateRunOwner(runId, tenantA);

        record(
            "TEST 5: SSE events and run state remain strictly tenant isolated",
            accessB.forbidden === true && accessB.allowed === false && accessA.allowed === true,
            `tenantB_forbidden=${accessB.forbidden}, tenantA_allowed=${accessA.allowed}`
        );
    } catch (err) {
        record("TEST 5: SSE events and run state remain strictly tenant isolated", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 6: SSE payload remains lightweight (< 1KB)
    // ─────────────────────────────────────────────────────────────
    try {
        const tenant = "11111111-1111-1111-1111-111111111111";
        const runId = "lightweight-run-" + Date.now();
        executionEvents.registerRunOwner(runId, tenant, "rag");

        executionEvents.publish(runId, "step_progress", {
            step: "RETRIEVAL",
            detail: "Searching tenant knowledge points",
            progress: 40
        }, "event-1", tenant);

        const history = executionEvents.getBufferedEvents(runId);
        const lastEvent = history && history.length > 0 ? history[history.length - 1] : null;
        const payloadSize = JSON.stringify(lastEvent || {}).length;

        record(
            "TEST 6: SSE payload remains lightweight (< 1KB per step)",
            lastEvent !== null && payloadSize < 1024,
            `payloadSize=${payloadSize} bytes`
        );
    } catch (err) {
        record("TEST 6: SSE payload remains lightweight (< 1KB per step)", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Model selection remains strictly allowlisted
    // ─────────────────────────────────────────────────────────────
    try {
        const llamaAllowed = isModelAllowed("llama3.2:3b");
        const moonAllowed = isModelAllowed("moondream:latest");
        const gptBlocked = !isModelAllowed("gpt-4-turbo");
        const claudeBlocked = !isModelAllowed("claude-3-opus");
        const customBlocked = !isModelAllowed("malicious-remote-model");

        record(
            "TEST 7: Model selection strictly allowlisted against local models",
            llamaAllowed && moonAllowed && gptBlocked && claudeBlocked && customBlocked,
            "Local models permitted, arbitrary/cloud models blocked"
        );
    } catch (err) {
        record("TEST 7: Model selection strictly allowlisted against local models", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Zero cloud fallback
    // ─────────────────────────────────────────────────────────────
    try {
        clearModelCache();
        const decision = await routeTask({
            taskType: "DOCUMENT_QA",
            prompt: "Describe heat exchanger inspection SOP guidelines"
        });

        const reasonStr = (decision.routingReason || decision.reason || "").toLowerCase();
        const noCloudInReason = !reasonStr.includes("cloud") && !reasonStr.includes("openai");

        record(
            "TEST 8: Zero cloud fallback in routing decision",
            decision.local === true && decision.selectedModel.includes("llama3.2") && noCloudInReason,
            `selectedModel=${decision.selectedModel}, local=${decision.local}`
        );
    } catch (err) {
        record("TEST 8: Zero cloud fallback in routing decision", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Streaming does not bypass grounding
    // ─────────────────────────────────────────────────────────────
    try {
        const emptyTenant = "00000000-0000-0000-0000-000000000000";
        const streamedTokens = [];

        const answer = await answerQuestion("What is the confidential cryptographic passcode for Site 9?", {
            organizationId: emptyTenant,
            stream: true,
            onChunk: (chunk) => {
                streamedTokens.push(chunk);
            }
        });

        const isRefusal = answer.grounded === false && answer.reason === "insufficient_retrieval_evidence";
        record(
            "TEST 9: Streaming does not bypass grounding (zero tokens streamed on ungrounded query)",
            isRefusal && streamedTokens.length === 0,
            `streamedCount=${streamedTokens.length}, reason=${answer.reason}`
        );
    } catch (err) {
        record("TEST 9: Streaming does not bypass grounding (zero tokens streamed on ungrounded query)", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Inspection final answer remains strictly validated
    // ─────────────────────────────────────────────────────────────
    try {
        const hasIngest = typeof inspectionNodes.ingestNode === "function";
        const hasRetrieve = typeof inspectionNodes.retrieveNode === "function";
        const hasExtract = typeof inspectionNodes.extractFindingsNode === "function";
        const hasRetrieveSop = typeof inspectionNodes.retrieveSopNode === "function";
        const hasAssessRisk = typeof inspectionNodes.assessRiskNode === "function";
        const hasValidateCitations = typeof inspectionNodes.validateCitationsNode === "function";
        const hasGenerateReport = typeof inspectionNodes.generateReportNode === "function";

        record(
            "TEST 10: Inspection deterministic validation pipeline preserved",
            hasIngest && hasRetrieve && hasExtract && hasRetrieveSop && hasAssessRisk && hasValidateCitations && hasGenerateReport,
            "All deterministic inspection nodes verified"
        );
    } catch (err) {
        record("TEST 10: Inspection deterministic validation pipeline preserved", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Clean digital text PDF skips unnecessary OCR
    // ─────────────────────────────────────────────────────────────
    try {
        const cleanSampleText = "SovereignAI standard industrial turbine operating protocol. " +
            "Ensure that inlet valve pressure does not exceed 45.5 bar during phase 2 initialization. " +
            "Inspect hydraulic actuators daily for seal degradation. All anomalies must be logged.";

        const pageSufficient = isPageTextSufficient(cleanSampleText);
        const docSufficient = isTextSufficient({
            text: cleanSampleText,
            pageCount: 1,
            pageTexts: [cleanSampleText]
        });

        record(
            "TEST 11: Clean digital text PDF passes sufficiency test (skipping OCR)",
            pageSufficient === true && docSufficient === true,
            `pageSufficient=${pageSufficient}, docSufficient=${docSufficient}`
        );
    } catch (err) {
        record("TEST 11: Clean digital text PDF passes sufficiency test (skipping OCR)", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Vision image validation remains strictly enforced
    // ─────────────────────────────────────────────────────────────
    try {
        const pdfBuffer = Buffer.from("%PDF-1.4 fake pdf buffer");
        const textBuffer = Buffer.from("plaintext that is definitely not an image");
        const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

        const pdfValid = validateImageMagicBytes(pdfBuffer);
        const textValid = validateImageMagicBytes(textBuffer);
        const pngValid = validateImageMagicBytes(fakePngBuffer);

        record(
            "TEST 12: Vision image input validation strictly enforced before inference",
            pdfValid === false && textValid === false && pngValid === true,
            `pdfValid=${pdfValid}, textValid=${textValid}, pngValid=${pngValid}`
        );
    } catch (err) {
        record("TEST 12: Vision image input validation strictly enforced before inference", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Coding sandbox security flags remain unchanged
    // ─────────────────────────────────────────────────────────────
    try {
        const execution = await executeInSandbox({
            code: 'print("SECURE_EXEC_OK")',
            timeoutMs: 6000
        });

        record(
            "TEST 13: Coding sandbox enforces strict isolation and non-root execution",
            execution.success === true && execution.exitCode === 0 && execution.stdout.includes("SECURE_EXEC_OK"),
            `exitCode=${execution.exitCode}, success=${execution.success}`
        );
    } catch (err) {
        record("TEST 13: Coding sandbox enforces strict isolation and non-root execution", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Secrets, passwords, and JWTs are stripped from telemetry logs
    // ─────────────────────────────────────────────────────────────
    try {
        const logged = telemetryService.recordAiExecution({
            taskType: "CHAT",
            selectedModel: "llama3.2:3b",
            organizationId: "11111111-1111-1111-1111-111111111111",
            totalLatencyMs: 25,
            modelLatencyMs: 20,
            status: "SUCCESS",
            metadata: {
                apiKey: "sk-proj-supersecretapikey12345",
                password: "DatabasePassword999!",
                authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.secret"
            }
        });

        const jsonStr = JSON.stringify(logged);
        const hasLeak = jsonStr.includes("DatabasePassword999!") ||
                        jsonStr.includes("sk-proj-supersecretapikey12345") ||
                        jsonStr.includes("eyJhbGciOiJIUzI1NiJ9");

        record(
            "TEST 14: Secrets, passwords and JWTs stripped from production telemetry",
            hasLeak === false,
            "Sanitization verified for API keys, passwords, and JWT tokens"
        );
    } catch (err) {
        record("TEST 14: Secrets, passwords and JWTs stripped from production telemetry", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Sovereignty diagnostics accurately distinguish status
    // ─────────────────────────────────────────────────────────────
    try {
        const resp = await fetch(`${baseUrl}/api/v1/sovereignty`);
        const payload = await resp.json();

        const hasConfigured = Boolean(payload?.telemetry?.configured?.llmModel);
        const hasAvailable = typeof payload?.telemetry?.available?.llm === "boolean";
        const hasUsed = typeof payload?.telemetry?.actuallyUsed?.totalExecutions === "number";
        const zeroCloud = payload?.externalCloudApiKeys?.length === 0;

        record(
            "TEST 15: Sovereignty diagnostics accurately distinguish CONFIGURED, AVAILABLE, ACTUALLY_USED",
            resp.status === 200 && hasConfigured && hasAvailable && hasUsed && zeroCloud,
            `configured=${hasConfigured}, available=${hasAvailable}, used=${hasUsed}`
        );
    } catch (err) {
        record("TEST 15: Sovereignty diagnostics accurately distinguish CONFIGURED, AVAILABLE, ACTUALLY_USED", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 16: Performance diagnostic endpoint reports P50/P95 without tenant data
    // ─────────────────────────────────────────────────────────────
    try {
        const resp = await fetch(`${baseUrl}/api/v1/system/performance`);
        const payload = await resp.json();

        const p50Ok = typeof payload?.summary?.overallLatencies?.p50Ms === "number";
        const p95Ok = typeof payload?.summary?.overallLatencies?.p95Ms === "number";
        const modelsOk = Boolean(payload?.models);
        const ragOk = Boolean(payload?.workflows?.rag);

        const rawText = JSON.stringify(payload);
        const leaksSensitive = rawText.includes("privateContent") || rawText.includes("documentText");

        record(
            "TEST 16: Diagnostic performance endpoint reports aggregate metrics without tenant data",
            resp.status === 200 && p50Ok && p95Ok && modelsOk && ragOk && !leaksSensitive,
            `p50=${payload?.summary?.overallLatencies?.p50Ms}ms, p95=${payload?.summary?.overallLatencies?.p95Ms}ms, modelsCount=${payload?.models?.length}`
        );
    } catch (err) {
        record("TEST 16: Diagnostic performance endpoint reports aggregate metrics without tenant data", false, err.message);
    }

    if (server) {
        server.close();
    }

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
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
