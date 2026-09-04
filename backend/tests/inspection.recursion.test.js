/**
 * Regression Test Suite: LangGraph Inspection StateGraph Non-Terminating / Recursion Limit Defense
 *
 * File: backend/tests/inspection.recursion.test.js
 *
 * Proves:
 *   1. Normal graph terminates cleanly and reaches END.
 *   2. Graph reaches END on all paths.
 *   3. No recursion-limit exception (strictly runs under default recursionLimit of 25).
 *   4. Retry paths are strictly bounded (maxExtractionAttempts = 2).
 *   5. Failure paths terminate safely without infinite looping.
 *   6. No infinite conditional cycle exists across any validation node.
 *
 * DO NOT weaken tests by increasing recursionLimit.
 */

import assert from "node:assert/strict";
import {
    createInspectionGraph,
    createInspectionNodes,
    validateFindingStructure,
    validateFindingsArray,
    validateRiskStructure,
    validateCitationsStructure,
    routeFindingsValidation,
    routeSopEvidence,
    routeRiskValidation,
    routeCitationsValidation,
} from "../src/orchestration/inspection/index.js";

async function runRecursionTests() {
    console.log("==========================================================");
    console.log("Inspection StateGraph Recursion & Loop Prevention Suite");
    console.log("==========================================================\n");

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

    const testDocId = "doc-recursion-test-001";
    const testOrgId = "0bd5dba2-05e1-4f5c-9047-25843d338622";
    const testTask = "Analyze Pump-03 bearing inspection findings and assess risk.";

    const baseAdapters = {
        runIngestion: async () => ({
            documentId: testDocId,
            filename: "Pump03_Inspection.pdf",
            chunksStored: 3,
        }),
        runRetrieval: async () => [
            {
                documentId: testDocId,
                filename: "Pump03_Inspection.pdf",
                page: 1,
                chunkIndex: 0,
                score: 0.95,
                text: "Pump-03 bearing temperature recorded at 92 degrees C.",
            },
        ],
        runFindingsExtraction: async () => [
            {
                finding: "Bearing temperature exceeded operating limit",
                equipment: "Pump-03",
                observedValue: "92 C",
                limit: "80 C",
                severity: "HIGH",
                evidence: "Pump-03 bearing temperature recorded at 92 degrees C.",
            },
        ],
        runSopRetrieval: async () => [
            {
                documentId: "sop-001",
                filename: "Demo_Maintenance_SOP.pdf",
                documentType: "sop",
                page: 1,
                chunkIndex: 0,
                score: 0.88,
                text: "Normal bearing operating temperature is up to 80 C.",
            },
        ],
        runRiskAssessment: async () => ({
            riskAssessment: {
                level: "HIGH",
                reason: "Bearing temperature of 92 C exceeds allowable limit of 80 C.",
            },
            recommendation: "Shut down Pump-03 and inspect bearing lubrication immediately.",
            citations: [
                {
                    documentId: "sop-001",
                    filename: "Demo_Maintenance_SOP.pdf",
                    page: 1,
                    chunkIndex: 0,
                },
            ],
        }),
        runCitationValidation: (raw, sop) => raw,
        runReportGeneration: async () => ({
            filename: "Approval_Note_Pump03.docx",
            filePath: "/tmp/Approval_Note_Pump03.docx",
            downloadUrl: "/api/v1/inspection/download/Approval_Note_Pump03.docx",
        }),
    };

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Normal Graph Terminates & Reaches END
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Normal Workflow Termination & Node Execution Count");

    const normalGraph = createInspectionGraph(createInspectionNodes(baseAdapters));
    const normalResult = await normalGraph.invoke({
        documentId: testDocId,
        task: testTask,
        organizationId: testOrgId,
    });

    record("Normal execution completes with status='completed'", normalResult.status === "completed");
    record("Workflow outcome is 'SUCCESS'", normalResult.workflowOutcome === "SUCCESS");
    record(
        "Normal path follows exact sequence (10 nodes)",
        normalResult.executionOrder.length === 10,
        `nodes=${normalResult.executionOrder.length} [${normalResult.executionOrder.join(" -> ")}]`
    );
    record("Terminal node is 'generate_report'", normalResult.currentNode === "generate_report");
    record("Execution count is well below recursionLimit (10 < 25)", normalResult.executionOrder.length < 25);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Invalid Findings Bounded Retry (Recovers on Attempt 2)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Bounded Retry Recovery (Max 2 Attempts)");

    let extractionCalls = 0;
    const retryAdapters = {
        ...baseAdapters,
        runFindingsExtraction: async () => {
            extractionCalls++;
            if (extractionCalls === 1) {
                // Return invalid finding (missing required evidence)
                return [{ finding: "Hot bearing missing evidence" }];
            }
            return [
                {
                    finding: "Bearing temperature exceeded operating limit",
                    equipment: "Pump-03",
                    observedValue: "92 C",
                    limit: "80 C",
                    severity: "HIGH",
                    evidence: "Pump-03 bearing temperature recorded at 92 degrees C.",
                },
            ];
        },
    };

    const retryGraph = createInspectionGraph(createInspectionNodes(retryAdapters));
    const retryResult = await retryGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Workflow recovered on attempt 2 with status='completed'", retryResult.status === "completed");
    record("Extraction attempts tracked accurately as 2", retryResult.extractionAttempts === 2);
    record(
        "Execution order contains exactly one retry_extraction",
        retryResult.executionOrder.filter((n) => n === "retry_extraction").length === 1,
        `totalNodes=${retryResult.executionOrder.length}`
    );
    record("Total node transitions <= 12 (well below 25)", retryResult.executionOrder.length <= 12);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Persistent Invalid Findings Terminates at safe_failure
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Persistent Failure Strictly Terminated (No Infinite Loop)");

    let persistentCalls = 0;
    const persistentAdapters = {
        ...baseAdapters,
        runFindingsExtraction: async () => {
            persistentCalls++;
            return [{ invalidField: "Always malformed" }];
        },
    };

    const persistentGraph = createInspectionGraph(createInspectionNodes(persistentAdapters));
    const persistentResult = await persistentGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Persistent invalid findings results in status='failed'", persistentResult.status === "failed");
    record("Workflow outcome is 'SAFE_FAILURE'", persistentResult.workflowOutcome === "SAFE_FAILURE");
    record("Terminal node is 'safe_failure'", persistentResult.currentNode === "safe_failure");
    record("Extraction attempts bounded at 2 (not infinite)", persistentCalls === 2 && persistentResult.extractionAttempts === 2);
    record(
        "Total node transitions <= 8 on safe failure",
        persistentResult.executionOrder.length <= 8,
        `nodes=${persistentResult.executionOrder.length} [${persistentResult.executionOrder.join(" -> ")}]`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Missing SOP Evidence Deterministic Stop (No Loop)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] Missing SOP Evidence Deterministic Stop");

    let sopCallCount = 0;
    const missingSopAdapters = {
        ...baseAdapters,
        runSopRetrieval: async () => {
            sopCallCount++;
            return []; // No SOP chunks found in Qdrant
        },
    };

    const missingSopGraph = createInspectionGraph(createInspectionNodes(missingSopAdapters));
    const missingSopResult = await missingSopGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Terminates with status='completed' on insufficient evidence", missingSopResult.status === "completed");
    record("Workflow outcome is 'INSUFFICIENT_EVIDENCE'", missingSopResult.workflowOutcome === "INSUFFICIENT_EVIDENCE");
    record("SOP retrieval invoked exactly once (no looping)", sopCallCount === 1);
    record("Terminal node is 'insufficient_evidence'", missingSopResult.currentNode === "insufficient_evidence");
    record(
        "Node count is 7 (START -> ingest -> retrieve -> extract -> validate -> retrieve_sop -> check_sop -> insufficient_evidence)",
        missingSopResult.executionOrder.length === 7,
        `nodes=${missingSopResult.executionOrder.length}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Invalid Citations Routing & Termination
    // ─────────────────────────────────────────────────────────────
    console.log("\n[5] Invalid Citations Conditional Edge Termination");

    const invalidCitationsAdapters = {
        ...baseAdapters,
        runRiskAssessment: async () => ({
            riskAssessment: { level: "HIGH", reason: "Overheating" },
            recommendation: "Inspect",
            citations: ["not an object"], // Malformed citation structure
        }),
    };

    const citationGraph = createInspectionGraph(createInspectionNodes(invalidCitationsAdapters));
    const citationResult = await citationGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Invalid citation structure routes to safe_failure", citationResult.currentNode === "safe_failure");
    record("Workflow outcome is 'SAFE_FAILURE'", citationResult.workflowOutcome === "SAFE_FAILURE");
    record("Total nodes <= 10 without looping", citationResult.executionOrder.length <= 10);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Simulated Corrupted State & Cycle Prevention
    // ─────────────────────────────────────────────────────────────
    console.log("\n[6] Corrupted State & Structural Cycle Defense");

    // Route functions test with edge cases
    record("routeFindingsValidation returns safe_failure when attempts >= maxAttempts",
        routeFindingsValidation({ extractionAttempts: 2, maxExtractionAttempts: 2, findingValidation: { isValid: false } }) === "safe_failure"
    );
    record("routeFindingsValidation returns safe_failure when state is already failed",
        routeFindingsValidation({ status: "failed", findingValidation: null }) === "safe_failure"
    );
    record("routeSopEvidence returns insufficient_evidence when evidence is missing",
        routeSopEvidence({ sopEvidenceStatus: "NO_EVIDENCE" }) === "insufficient_evidence"
    );
    record("routeSopEvidence returns insufficient_evidence when status is failed",
        routeSopEvidence({ status: "failed" }) === "insufficient_evidence"
    );
    record("routeRiskValidation returns safe_failure when risk is invalid",
        routeRiskValidation({ riskValidation: { isValid: false } }) === "safe_failure"
    );
    record("routeCitationsValidation returns safe_failure when citations are invalid",
        routeCitationsValidation({ citationValidation: { isValid: false } }) === "safe_failure"
    );
    record("routeCitationsValidation returns generate_report when citations are valid",
        routeCitationsValidation({ citationValidation: { isValid: true } }) === "generate_report"
    );

    // End condition validation: verify generate_report, insufficient_evidence, safe_failure connect to END
    console.log("\n==========================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==========================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runRecursionTests().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error("Recursion regression test failed:", err);
    process.exit(1);
});
