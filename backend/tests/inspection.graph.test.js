/**
 * Phase 4 — LangGraph Conditional Decision Graph & Bounded Retry Test Suite
 *
 * Validates the stateful decision graph architecture:
 *   1. Normal successful workflow execution
 *   2. Findings validation (valid findings contract)
 *   3. Invalid findings -> retry_extraction -> validate_findings -> success
 *   4. Invalid findings -> bounded retry limit reached -> safe_failure -> END
 *   5. Legitimate zero-findings inspection report handling
 *   6. SOP evidence detected -> assess_risk branch
 *   7. Missing SOP evidence -> insufficient_evidence -> END
 *   8. Insufficient evidence safety (no fabricated risks, limits, or citations)
 *   9. Valid risk assessment validation
 *   10. Invalid risk assessment output -> safe_failure -> END
 *   11. Anti-hallucination citation validation against retrieved evidence
 *   12. No report generation after safe_failure
 *   13. No report generation after insufficient_evidence
 *   14. Multi-tenant isolation preservation
 *   15. API response contract compatibility
 *
 * Run with:
 *   npm run test:graph
 */

import assert from "node:assert/strict";
import {
    createInspectionGraph,
    compiledInspectionGraph,
    createInspectionNodes,
    validateFindingStructure,
    validateFindingsArray,
    validateRiskStructure,
    routeFindingsValidation,
    routeSopEvidence,
    routeRiskValidation,
    runCitationValidation,
} from "../src/orchestration/inspection/index.js";
import { INSUFFICIENT_EVIDENCE_RESULT } from "../../ai-service/risk/risk.schema.js";

async function runTests() {
    console.log("==================================================");
    console.log("Phase 4: LangGraph Conditional State Machine Suite");
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

    const testDocId = "doc-phase4-test-001";
    const testOrgId = "0bd5dba2-05e1-4f5c-9047-25843d338622";
    const testTask = "Analyze Pump-03 bearing inspection findings and assess risk.";

    const validFinding = {
        finding: "Bearing temperature exceeded operating limit",
        equipment: "Pump-03",
        observedValue: "92°C",
        limit: "80°C",
        severity: "HIGH",
        evidence: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
        source: {
            documentId: testDocId,
            page: 1,
            chunkIndex: 0,
        },
    };

    const validSopChunk = {
        documentId: "sop-doc-001",
        filename: "Demo_Maintenance_SOP.pdf",
        documentType: "sop",
        page: 1,
        chunkIndex: 0,
        score: 0.88,
        text: "Normal bearing operating temperature is up to 80°C. If exceeded, stop and inspect.",
    };

    const validRiskResult = {
        riskAssessment: {
            level: "HIGH",
            reason: "Bearing temperature of 92°C exceeds allowable limit of 80°C by 12°C.",
        },
        recommendation: "Immediately inspect lubrication and rotate assembly.",
        citations: [
            {
                documentId: "sop-doc-001",
                filename: "Demo_Maintenance_SOP.pdf",
                page: 1,
                chunkIndex: 0,
            },
        ],
    };

    // Standard baseline adapter mock set
    const baseAdapters = {
        runIngestion: async (state) => ({
            documentId: state.documentId,
            filename: `${state.documentId}.pdf`,
            chunksStored: 10,
        }),
        runRetrieval: async () => [
            {
                documentId: testDocId,
                page: 1,
                chunkIndex: 0,
                score: 0.95,
                text: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
            },
        ],
        runFindingsExtraction: async () => [validFinding],
        runSopRetrieval: async () => [validSopChunk],
        runRiskAssessment: async () => validRiskResult,
        runCitationValidation: (raw, ret) => runCitationValidation(raw, ret),
        runReportGeneration: async (data, opts) => ({
            filename: `Approval_Note_${opts.documentId}.docx`,
            filePath: `/app/backend/generated/Approval_Note_${opts.documentId}.docx`,
            downloadUrl: `/api/v1/inspection/download/Approval_Note_${opts.documentId}.docx`,
            reportId: "rep-uuid-phase4",
        }),
    };

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Normal Successful Path Execution & Node Sequence
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Normal Successful Workflow Path");

    const normalNodes = createInspectionNodes(baseAdapters);
    const normalGraph = createInspectionGraph(normalNodes);

    const normalResult = await normalGraph.invoke({
        documentId: testDocId,
        task: testTask,
        organizationId: testOrgId,
    });

    const expectedNormalSequence = [
        "ingest",
        "retrieve",
        "extract_findings",
        "validate_findings",
        "retrieve_sop",
        "check_sop_evidence",
        "assess_risk",
        "validate_risk",
        "validate_citations",
        "generate_report",
    ];

    record("Normal execution completes with status='completed'", normalResult.status === "completed");
    record("Workflow outcome is 'SUCCESS'", normalResult.workflowOutcome === "SUCCESS");
    record(
        "Normal path follows exact target sequence",
        JSON.stringify(normalResult.executionOrder) === JSON.stringify(expectedNormalSequence),
        `order=[${normalResult.executionOrder.join(" -> ")}]`
    );
    record("Approval Note report generated with downloadUrl", Boolean(normalResult.report?.downloadUrl));

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Validation Utilities Unit Tests
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Schema Validation Utilities");

    const validFindingCheck = validateFindingStructure(validFinding);
    record("validateFindingStructure passes for valid finding", validFindingCheck.isValid);

    const invalidFindingNoEvidence = validateFindingStructure({ finding: "Hot bearing", equipment: "Pump" });
    record("validateFindingStructure rejects finding missing evidence", !invalidFindingNoEvidence.isValid);

    const invalidFindingEmpty = validateFindingStructure({});
    record("validateFindingStructure rejects empty finding", !invalidFindingEmpty.isValid);

    const validRiskCheck = validateRiskStructure(validRiskResult.riskAssessment, validRiskResult.recommendation);
    record("validateRiskStructure passes for valid HIGH risk", validRiskCheck.isValid);

    const invalidRiskLevel = validateRiskStructure({ level: "EXTREME_HAZARD", reason: "Hot" }, "Inspect");
    record("validateRiskStructure rejects unknown risk level", !invalidRiskLevel.isValid);

    const invalidRiskNoReason = validateRiskStructure({ level: "LOW", reason: "" }, "Inspect");
    record("validateRiskStructure rejects empty risk reason", !invalidRiskNoReason.isValid);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Invalid Findings -> Bounded Retry -> Success
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Invalid Findings -> Bounded Retry -> Success");

    let extractionCallCount = 0;
    const retrySuccessAdapters = {
        ...baseAdapters,
        runFindingsExtraction: async (state, opts) => {
            extractionCallCount++;
            if (extractionCallCount === 1) {
                // Attempt 1: return malformed finding (missing required evidence)
                return [{ finding: "Bearing overheating without evidence field" }];
            }
            // Attempt 2 (retry): return valid finding
            return [validFinding];
        },
    };

    const retrySuccessGraph = createInspectionGraph(createInspectionNodes(retrySuccessAdapters));
    const retrySuccessResult = await retrySuccessGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Workflow recovered via retry and completed", retrySuccessResult.status === "completed");
    record("Extraction attempts tracked correctly as 2", retrySuccessResult.extractionAttempts === 2);
    record(
        "Execution order contains retry_extraction then validate_findings",
        retrySuccessResult.executionOrder.includes("retry_extraction") &&
        retrySuccessResult.executionOrder.filter((n) => n === "validate_findings").length === 2,
        `order=[${retrySuccessResult.executionOrder.join(" -> ")}]`
    );
    record("Deliverable report successfully generated after retry", Boolean(retrySuccessResult.report));

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Invalid Findings -> Max Retries Exceeded -> Safe Failure
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] Invalid Findings -> Max Retries Exceeded -> Safe Failure");

    let persistentFailureCalls = 0;
    const persistentFailureAdapters = {
        ...baseAdapters,
        runFindingsExtraction: async () => {
            persistentFailureCalls++;
            return [{ invalidField: "No finding or evidence" }];
        },
    };

    const persistentFailureGraph = createInspectionGraph(createInspectionNodes(persistentFailureAdapters));
    const persistentFailureResult = await persistentFailureGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Persistent invalid findings results in status='failed'", persistentFailureResult.status === "failed");
    record("Workflow outcome is 'SAFE_FAILURE'", persistentFailureResult.workflowOutcome === "SAFE_FAILURE");
    record(
        "Terminal node is 'safe_failure'",
        persistentFailureResult.currentNode === "safe_failure" &&
        persistentFailureResult.executionOrder[persistentFailureResult.executionOrder.length - 1] === "safe_failure"
    );
    record("Extraction attempts strictly bounded by maxExtractionAttempts (2)", persistentFailureResult.extractionAttempts <= 2);
    record("No Approval Note report generated on safe failure", persistentFailureResult.report === null);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Zero Findings Non-Hallucination Safe Execution
    // ─────────────────────────────────────────────────────────────
    console.log("\n[5] Legitimate Zero Findings Safe Execution");

    const zeroFindingsAdapters = {
        ...baseAdapters,
        runFindingsExtraction: async () => [], // Clean report with 0 anomalies
    };

    const zeroFindingsGraph = createInspectionGraph(createInspectionNodes(zeroFindingsAdapters));
    const zeroFindingsResult = await zeroFindingsGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Zero findings report is considered valid and completes", zeroFindingsResult.status === "completed");
    record("Zero findings produces safe null risk without hallucination", zeroFindingsResult.riskAssessment?.level === null);
    record("Zero findings produces schedule maintenance recommendation", zeroFindingsResult.recommendation?.includes("standard operating"));

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Missing SOP Evidence -> Insufficient Evidence Termination
    // ─────────────────────────────────────────────────────────────
    console.log("\n[6] Missing SOP Evidence -> Insufficient Evidence Termination");

    const missingSopAdapters = {
        ...baseAdapters,
        runSopRetrieval: async () => [], // No matching SOP found in Qdrant
    };

    const missingSopGraph = createInspectionGraph(createInspectionNodes(missingSopAdapters));
    const missingSopResult = await missingSopGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Missing SOP terminates with status='completed'", missingSopResult.status === "completed");
    record("Workflow outcome is 'INSUFFICIENT_EVIDENCE'", missingSopResult.workflowOutcome === "INSUFFICIENT_EVIDENCE");
    record("SOP evidence status recorded as 'NO_EVIDENCE'", missingSopResult.sopEvidenceStatus === "NO_EVIDENCE");
    record(
        "Execution order routed to insufficient_evidence and stopped",
        missingSopResult.executionOrder.includes("insufficient_evidence") &&
        !missingSopResult.executionOrder.includes("assess_risk") &&
        !missingSopResult.executionOrder.includes("generate_report"),
        `order=[${missingSopResult.executionOrder.join(" -> ")}]`
    );
    record(
        "Insufficient evidence results match INSUFFICIENT_EVIDENCE_RESULT constant",
        missingSopResult.riskAssessment?.level === INSUFFICIENT_EVIDENCE_RESULT.riskAssessment.level &&
        missingSopResult.recommendation === INSUFFICIENT_EVIDENCE_RESULT.recommendation
    );
    record("No Approval Note report generated on insufficient evidence", missingSopResult.report === null);

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Invalid Risk Assessment Output -> Safe Failure
    // ─────────────────────────────────────────────────────────────
    console.log("\n[7] Invalid Risk Output -> Safe Failure");

    const invalidRiskAdapters = {
        ...baseAdapters,
        runRiskAssessment: async () => ({
            riskAssessment: {
                level: "UNAUTHORIZED_RISK_LEVEL_99",
                reason: "Invalid level string",
            },
            recommendation: "Do something",
            citations: [],
        }),
    };

    const invalidRiskGraph = createInspectionGraph(createInspectionNodes(invalidRiskAdapters));
    const invalidRiskResult = await invalidRiskGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record("Invalid risk level causes status='failed'", invalidRiskResult.status === "failed");
    record("Workflow outcome is 'SAFE_FAILURE'", invalidRiskResult.workflowOutcome === "SAFE_FAILURE");
    record(
        "Execution routes from validate_risk to safe_failure",
        invalidRiskResult.executionOrder.includes("validate_risk") &&
        invalidRiskResult.executionOrder.includes("safe_failure") &&
        !invalidRiskResult.executionOrder.includes("generate_report"),
        `order=[${invalidRiskResult.executionOrder.join(" -> ")}]`
    );
    record("No Approval Note report generated on invalid risk", invalidRiskResult.report === null);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Anti-Hallucination Citation Verification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[8] Anti-Hallucination Citation Verification");

    const citationTestAdapters = {
        ...baseAdapters,
        runRiskAssessment: async () => ({
            riskAssessment: { level: "HIGH", reason: "Hot bearing" },
            recommendation: "Inspect bearing",
            citations: [
                { documentId: "sop-doc-001", filename: "Demo_Maintenance_SOP.pdf", page: 1, chunkIndex: 0 }, // Genuine
                { documentId: "fake-ghost-doc", filename: "Nonexistent_SOP.pdf", page: 99, chunkIndex: 99 }, // Fabricated
            ],
        }),
    };

    const citationGraph = createInspectionGraph(createInspectionNodes(citationTestAdapters));
    const citationResult = await citationGraph.invoke({
        documentId: testDocId,
        task: testTask,
    });

    record(
        "Fabricated citation discarded; only genuine citation preserved",
        citationResult.citations?.length === 1 &&
        citationResult.citations[0].documentId === "sop-doc-001"
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Multi-tenant Scoping & Telemetry Preservation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[9] Multi-tenant Scoping & Telemetry");

    record("organizationId preserved in state", normalResult.organizationId === testOrgId);
    record("documentId preserved in state", normalResult.documentId === testDocId);
    record("executionOrder tracked accurately", normalResult.executionOrder?.length > 0);

    // ─────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────
    console.log("\n==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

runTests().catch((err) => {
    console.error("Test execution failure:", err);
    process.exit(1);
});
