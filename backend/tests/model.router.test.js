/**
 * PHASE 8 — MODEL ROUTER & MULTI-MODEL ORCHESTRATION TEST SUITE
 *
 * Verifies:
 *  1. Document query -> DOCUMENT_ANALYSIS
 *  2. Coding query -> CODING
 *  3. Image request -> VISION
 *  4. Inspection request -> INSPECTION
 *  5. Generic question -> GENERAL_CHAT
 *  6. Inspection takes precedence over generic document keywords
 *  7. Vision takes precedence when an image is attached
 *  8. Router returns an allowlisted model
 *  9. Router never accepts arbitrary model names
 * 10. Unavailable model fails gracefully
 * 11. Local execution metadata is returned (local: true)
 * 12. Tenant-scoped RAG remains tenant-scoped
 * 13. Inspection continues through existing Phase-6 graph
 * 14. Coding continues through existing sandbox
 * 15. No external API is invoked (zero cloud API keys)
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
    getRouterDiagnostic,
    getAllowedModels,
    isModelAllowed,
    TASK_TYPE,
    RouterError,
} from "../../ai-service/router/modelRouter.js";

import { answerQuestion } from "../../ai-service/rag/rag.service.js";
import {
    createInspectionGraph,
    createInspectionNodes,
} from "../src/orchestration/inspection/index.js";
import { executeInSandbox } from "../src/services/sandbox.service.js";
import { upsertChunks } from "../../ai-service/vectorstore/qdrant.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";

async function runTests() {
    console.log("==================================================");
    console.log("PHASE 8 — MODEL ROUTER & MULTI-MODEL TEST SUITE");
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
    // TEST 1: Document query -> DOCUMENT_ANALYSIS
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Task Classification & Precedence Tests");
    const t1 = classifyTask("What does the Maintenance SOP say about bearing temperature?");
    record("TEST 1: Document query -> DOCUMENT_ANALYSIS", t1 === TASK_TYPE.DOCUMENT_ANALYSIS, `got ${t1}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Coding query -> CODING
    // ─────────────────────────────────────────────────────────────
    const t2 = classifyTask("Write Python code to calculate pump efficiency.");
    record("TEST 2: Coding query -> CODING", t2 === TASK_TYPE.CODING, `got ${t2}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Image request -> VISION
    // ─────────────────────────────────────────────────────────────
    const t3 = classifyTask("Analyze this engineering drawing.");
    record("TEST 3: Image request -> VISION", t3 === TASK_TYPE.VISION, `got ${t3}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Inspection request -> INSPECTION
    // ─────────────────────────────────────────────────────────────
    const t4 = classifyTask("Analyze this inspection report and prepare an approval note.");
    record("TEST 4: Inspection request -> INSPECTION", t4 === TASK_TYPE.INSPECTION, `got ${t4}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Generic question -> GENERAL_CHAT
    // ─────────────────────────────────────────────────────────────
    const t5 = classifyTask("Explain what a centrifugal pump is.");
    record("TEST 5: Generic question -> GENERAL_CHAT", t5 === TASK_TYPE.GENERAL_CHAT, `got ${t5}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Inspection takes precedence over generic document keywords
    // ─────────────────────────────────────────────────────────────
    const t6 = classifyTask("Review the inspection report findings and draft risk assessment");
    record(
        "TEST 6: Inspection takes precedence over generic document keywords",
        t6 === TASK_TYPE.INSPECTION,
        `classified as ${t6}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Vision takes precedence when an image is attached
    // ─────────────────────────────────────────────────────────────
    const t7 = classifyTask("What does the document say?", { hasImage: true });
    record(
        "TEST 7: Vision takes precedence when image is attached",
        t7 === TASK_TYPE.VISION,
        `classified as ${t7}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Router returns an allowlisted model
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Model Routing & Allowlist Security Tests");
    const docDecision = await routeTask("What does the Maintenance SOP say about bearing temperature?");
    record(
        "TEST 8: Router returns an allowlisted model",
        isModelAllowed(docDecision.selectedModel) && Boolean(docDecision.selectedModel),
        `model=${docDecision.selectedModel}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Router never accepts arbitrary model names
    // ─────────────────────────────────────────────────────────────
    let arbitraryModelBlocked = false;
    try {
        await routeTask("What is the pump status?", { model: "gpt-4-cloud-external-model" });
    } catch (err) {
        arbitraryModelBlocked = err instanceof RouterError && err.code === "MODEL_NOT_ALLOWED";
    }
    record(
        "TEST 9: Router rejects arbitrary un-allowlisted model name",
        arbitraryModelBlocked,
        "cleanly raised RouterError(MODEL_NOT_ALLOWED)"
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Unavailable model fails gracefully
    // ─────────────────────────────────────────────────────────────
    let unavailableFailedGracefully = false;
    const originalVisionModel = process.env.MODEL_VISION;
    try {
        process.env.MODEL_VISION = "uninstalled-fake-vision:latest";
        await routeTask("Analyze this image", { hasImage: true });
    } catch (err) {
        unavailableFailedGracefully = err instanceof RouterError && err.code === "MODEL_UNAVAILABLE";
    } finally {
        if (originalVisionModel !== undefined) {
            process.env.MODEL_VISION = originalVisionModel;
        } else {
            delete process.env.MODEL_VISION;
        }
    }
    record(
        "TEST 10: Unavailable model fails gracefully with structured error",
        unavailableFailedGracefully,
        "cleanly raised RouterError(MODEL_UNAVAILABLE)"
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Local execution metadata is returned (local: true)
    // ─────────────────────────────────────────────────────────────
    record(
        "TEST 11: Local execution metadata returned",
        docDecision.local === true && typeof docDecision.reason === "string",
        `local=${docDecision.local}, reason="${docDecision.reason}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Tenant-scoped RAG remains tenant-scoped
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Tenant Isolation & Downstream Pipeline Integration");

    const tenantA = "tenant-phase8-org-a";
    const tenantB = "tenant-phase8-org-b";
    const docIdA = "doc-phase8-a";
    const docIdB = "doc-phase8-b";

    const textA = "Tenant A Confidential Bearing SOP limit is exactly 72 C.";
    const textB = "Tenant B Confidential Bearing SOP limit is exactly 99 C.";

    const embA = await generateEmbedding(textA);
    const embB = await generateEmbedding(textB);

    await upsertChunks([
        {
            id: "44444444-4444-4444-4444-444444444441",
            vector: embA,
            documentId: docIdA,
            organizationId: tenantA,
            chunkIndex: 0,
            text: textA,
            filename: "Tenant_A_SOP.pdf",
            page: 1,
            pageStartOffset: 0,
            pageEndOffset: textA.length,
            startOffset: 0,
            endOffset: textA.length,
        },
        {
            id: "44444444-4444-4444-4444-444444444442",
            vector: embB,
            documentId: docIdB,
            organizationId: tenantB,
            chunkIndex: 0,
            text: textB,
            filename: "Tenant_B_SOP.pdf",
            page: 1,
            pageStartOffset: 0,
            pageEndOffset: textB.length,
            startOffset: 0,
            endOffset: textB.length,
        }
    ]);

    const mockGenerateAnswer = async (prompt, model) => {
        return "Based on the retrieved context, the bearing SOP limit is specified.";
    };

    const ragResultA = await answerQuestion("What is the bearing SOP limit?", {
        organizationId: tenantA,
        generateAnswer: mockGenerateAnswer,
    });

    const onlyTenantASources = ragResultA.sources.every(s => s.documentId === docIdA);
    const noTenantBSources = !ragResultA.sources.some(s => s.documentId === docIdB);

    record(
        "TEST 12: Tenant-scoped RAG remains strictly isolated with routed model",
        onlyTenantASources && noTenantBSources && ragResultA.sources.length > 0,
        `Tenant A sources: ${ragResultA.sources.map(s => s.filename).join(", ")}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Inspection continues through existing Phase-6 graph
    // ─────────────────────────────────────────────────────────────
    const inspDecision = await routeTask("Analyze this inspection report and prepare an approval note.");
    
    const baseAdapters = {
        runIngestion: async (state) => ({
            documentId: state.documentId,
            filename: `${state.documentId}.pdf`,
            chunksStored: 10,
        }),
        runRetrieval: async () => [
            {
                documentId: docIdA,
                page: 1,
                chunkIndex: 0,
                score: 0.95,
                text: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
            },
        ],
        runFindingsExtraction: async () => [
            {
                id: "finding-phase8-01",
                finding: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
                evidence: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
                equipment: "Pump-03",
                observedValue: "92°C",
                limit: "80°C",
                severity: "HIGH",
                source: {
                    documentId: docIdA,
                    page: 1,
                    chunkIndex: 0,
                },
            }
        ],
        runSopRetrieval: async () => [
            {
                documentId: "sop-doc-phase8",
                filename: "Demo_Maintenance_SOP.pdf",
                documentType: "sop",
                page: 1,
                chunkIndex: 0,
                score: 0.88,
                text: "Normal bearing operating temperature is up to 80°C. If exceeded, stop and inspect.",
            }
        ],
        runRiskAssessment: async () => ({
            riskAssessment: {
                level: "HIGH",
                reason: "Bearing temperature of 92°C exceeds allowable limit of 80°C by 12°C.",
            },
            recommendation: "Immediately inspect lubrication and rotate assembly.",
            citations: [
                {
                    documentId: "sop-doc-phase8",
                    filename: "Demo_Maintenance_SOP.pdf",
                    page: 1,
                    chunkIndex: 0,
                },
            ],
        }),
        runReportGeneration: async (data, opts) => ({
            filename: `Approval_Note_${opts.documentId}.docx`,
            filePath: `backend/generated/${opts.organizationId}/Approval_Note_${opts.documentId}.docx`,
            downloadUrl: `/api/v1/inspection/download/Approval_Note_${opts.documentId}.docx`,
            reportId: "rep-uuid-phase8",
        }),
    };

    const inspectionNodes = createInspectionNodes(baseAdapters);
    const inspectionGraph = createInspectionGraph(inspectionNodes);

    const graphResult = await inspectionGraph.invoke({
        documentId: docIdA,
        task: "Analyze this inspection report and prepare an approval note.",
        organizationId: tenantA,
        model: inspDecision.selectedModel,
    });

    record(
        "TEST 13: Inspection workflow continues through existing LangGraph",
        graphResult.status === "completed" && graphResult.findings?.length === 1,
        `status=${graphResult.status}, findingsCount=${graphResult.findings?.length}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Coding continues through existing sandbox
    // ─────────────────────────────────────────────────────────────
    const sandboxResult = await executeInSandbox({ code: "result = 21 * 2\nprint(f'OUTPUT: {result}')" });
    const sandboxOutputMatches = sandboxResult.stdout && sandboxResult.stdout.includes("OUTPUT: 42");
    record(
        "TEST 14: Coding continues through existing network-disabled sandbox",
        sandboxResult.exitCode === 0 && sandboxOutputMatches && sandboxResult.sandbox?.isolated === true,
        `exitCode=${sandboxResult.exitCode}, stdout="${sandboxResult.stdout?.trim()}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 15: No external API is invoked (zero external API keys)
    // ─────────────────────────────────────────────────────────────
    const diagnostic = await getRouterDiagnostic();
    const externalKeys = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
        "COHERE_API_KEY", "REPLICATE_API_KEY", "AZURE_OPENAI_KEY"
    ].filter(k => Boolean(process.env[k]));

    record(
        "TEST 15: Sovereign diagnostic confirms 0 external cloud AI keys & 100% local execution",
        diagnostic.zeroCloudDependencies === true &&
        diagnostic.externalApiKeysCount === 0 &&
        externalKeys.length === 0,
        `externalKeysCount=${externalKeys.length}, localExecution=${diagnostic.localOllamaExecution}`
    );

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
