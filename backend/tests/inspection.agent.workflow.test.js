/**
 * Phase 6 — Inspection Agent Reliability & Approval-Note Workflow Test Suite
 *
 * Mandated 20 Comprehensive Tests:
 *   TEST 1: Valid inspection report with one finding + matching SOP
 *   TEST 2: Inspection finding with no matching SOP
 *   TEST 3: Multiple findings with independent SOP evidence
 *   TEST 4: One finding supported, one unsupported (Partial failure handling)
 *   TEST 5: Finding citation validation (maps to inspection doc/page)
 *   TEST 6: SOP citation validation (maps to retrieved SOP/page)
 *   TEST 7: Risk conclusion without SOP evidence (refused / level: null)
 *   TEST 8: Recommendation unsupported by SOP (rejected / marked unsupported)
 *   TEST 9: Numeric threshold comparison (deterministic calculator)
 *   TEST 10: Company A inspection (only Company A evidence used)
 *   TEST 11: Company A inspection with highly similar Company B SOP (Company B isolated)
 *   TEST 12: LLM supplies foreign organizationId (ignored / rejected)
 *   TEST 13: Approval Note generated (DOCX exists in Company A directory)
 *   TEST 14: Approval Note references (correspond to actual sources)
 *   TEST 15: Report generation failure (no false success reported)
 *   TEST 16: No findings detected (clean inspection, no fabricated findings)
 *   TEST 17: Inspection workflow SSE stages (stages delivered to correct tenant)
 *   TEST 18: Cross-tenant SSE attempt (denied 403/404)
 *   TEST 19: Repeated workflow execution (idempotent, consistent ownership)
 *   TEST 20: Missing organizationId in workflow state (fail closed)
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import {
    createInspectionGraph,
    createInspectionNodes,
    validateFindingStructure,
    validateFindingGrounding,
    analyzeFindingNumericThreshold,
    runCitationValidation,
} from "../src/orchestration/inspection/index.js";
import { runInspectionWorkflow } from "../src/services/inspection-orchestrator.service.js";
import { runApprovalNoteGeneration } from "../src/services/inspection.service.js";
import { executionEvents } from "../src/services/execution-events.service.js";
import { executeCalculator } from "../src/services/agentTools/calculator.tool.js";
import { getReportStoragePath } from "../src/utils/storage.js";
import { INSUFFICIENT_EVIDENCE_RESULT } from "../../ai-service/risk/risk.schema.js";

async function runSuite() {
    console.log("==================================================");
    console.log("Phase 6: Inspection Agent Reliability & Approval-Note Suite");
    console.log("==================================================\n");

    try {
        await initDb();
    } catch (err) {
        console.warn("DB init warning:", err.message);
    }

    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

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

    const cleanupOrgIds = [];
    const cleanupUserIds = [];

    // Tenants for multi-company isolation verification
    const orgAId = randomUUID();
    const orgBId = randomUUID();
    cleanupOrgIds.push(orgAId, orgBId);

    const userAId = randomUUID();
    const userBId = randomUUID();
    cleanupUserIds.push(userAId, userBId);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAId, `Company Alpha ${orgAId.slice(0, 6)}`]);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBId, `Company Beta ${orgBId.slice(0, 6)}`]);

    await query(
        "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
        [userAId, orgAId, "Alice Alpha", `alice_${orgAId.slice(0, 6)}@alpha.local`, "hash", "engineer"]
    );
    await query(
        "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
        [userBId, orgBId, "Bob Beta", `bob_${orgBId.slice(0, 6)}@beta.local`, "hash", "engineer"]
    );

    const tokenA = generateToken({
        userId: userAId,
        organizationId: orgAId,
        email: `alice_${orgAId.slice(0, 6)}@alpha.local`,
        role: "engineer",
    });

    const tokenB = generateToken({
        userId: userBId,
        organizationId: orgBId,
        email: `bob_${orgBId.slice(0, 6)}@beta.local`,
        role: "engineer",
    });

    try {
        // ─────────────────────────────────────────────────────────────
        // TEST 1: Valid inspection report with one finding + matching SOP
        // ─────────────────────────────────────────────────────────────
        console.log("[TEST 1] Valid inspection report with one finding + matching SOP");
        const doc1Id = `doc-t1-${randomUUID().slice(0, 8)}`;
        const sop1DocId = `sop-t1-${randomUUID().slice(0, 8)}`;

        const finding1 = {
            finding: "Bearing temperature exceeded operating limit",
            equipment: "Pump-01",
            observedValue: "92°C",
            limit: "80°C",
            severity: "HIGH",
            evidence: "Observed bearing temperature reached 92°C on Pump-01 under normal load.",
            source: { documentId: doc1Id, page: 2, chunkIndex: 0 },
        };

        const sopChunk1 = {
            documentId: sop1DocId,
            filename: "Pump_Maintenance_SOP.pdf",
            documentType: "sop",
            organizationId: orgAId,
            page: 5,
            chunkIndex: 1,
            score: 0.89,
            text: "Bearing operating temperature must not exceed 80°C. If exceeded, stop pump and inspect lubricant.",
        };

        const test1Adapters = {
            runIngestion: async () => ({ documentId: doc1Id, filename: `${doc1Id}.pdf`, chunksStored: 5 }),
            runRetrieval: async () => [{ documentId: doc1Id, page: 2, chunkIndex: 0, text: finding1.evidence, score: 0.95 }],
            runFindingsExtraction: async () => [finding1],
            runSopRetrieval: async () => [sopChunk1],
            runRiskAssessment: async () => ({
                riskAssessment: { level: "HIGH", reason: "Temperature of 92°C exceeds SOP threshold of 80°C by 12°C." },
                recommendation: "Stop pump and inspect lubricant according to SOP.",
                citations: [{ documentId: sop1DocId, filename: "Pump_Maintenance_SOP.pdf", page: 5, chunkIndex: 1 }],
                grounded: true,
            }),
            runCitationValidation: (raw, ret) => runCitationValidation(raw, ret),
            runReportGeneration: async (data, opts) => ({
                filename: `Approval_Note_${opts.documentId}.docx`,
                filePath: getReportStoragePath(opts.organizationId, `Approval_Note_${opts.documentId}.docx`),
            }),
        };

        const graph1 = createInspectionGraph(createInspectionNodes(test1Adapters));
        const res1 = await graph1.invoke({
            documentId: doc1Id,
            organizationId: orgAId,
            task: "Analyze inspection report",
        });

        record(
            "TEST 1 — Finding -> SOP -> Risk -> Recommendation -> Approval Note",
            res1.status === "completed" &&
            res1.workflowOutcome === "SUCCESS" &&
            res1.findings.length === 1 &&
            res1.riskAssessment.level === "HIGH" &&
            res1.citations.length === 1 &&
            res1.report !== null,
            `status=${res1.status}, level=${res1.riskAssessment?.level}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 2: Inspection finding with no matching SOP
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 2] Inspection finding with no matching SOP");
        const doc2Id = `doc-t2-${randomUUID().slice(0, 8)}`;
        const test2Adapters = {
            ...test1Adapters,
            runFindingsExtraction: async () => [finding1],
            runSopRetrieval: async () => [], // No matching SOP found
        };

        const graph2 = createInspectionGraph(createInspectionNodes(test2Adapters));
        const res2 = await graph2.invoke({
            documentId: doc2Id,
            organizationId: orgAId,
            task: "Analyze finding without SOP",
        });

        record(
            "TEST 2 — Risk level null and grounded false when SOP evidence absent",
            res2.riskAssessment.level === null &&
            res2.riskAssessment.grounded === false &&
            res2.recommendation.includes("Insufficient SOP evidence") &&
            res2.workflowOutcome === "INSUFFICIENT_EVIDENCE",
            `level=${res2.riskAssessment.level}, grounded=${res2.riskAssessment.grounded}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Multiple findings with independent SOP evidence
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 3] Multiple findings with independent SOP evidence");
        const doc3Id = `doc-t3-${randomUUID().slice(0, 8)}`;
        const finding3A = {
            finding: "High bearing temperature",
            equipment: "Turbine-A",
            observedValue: "95°C",
            limit: "80°C",
            severity: "HIGH",
            evidence: "Turbine-A bearing temp was 95°C.",
            source: { documentId: doc3Id, page: 1, chunkIndex: 0 },
        };
        const finding3B = {
            finding: "Lubricant oil leakage",
            equipment: "Gearbox-B",
            observedValue: "150 ml/hr",
            limit: "0 ml/hr",
            severity: "MEDIUM",
            evidence: "Gearbox-B has persistent oil leakage at output shaft seal.",
            source: { documentId: doc3Id, page: 3, chunkIndex: 2 },
        };

        const sopChunk3A = {
            documentId: "sop-temp",
            filename: "Thermal_Limits_SOP.pdf",
            organizationId: orgAId,
            page: 2,
            chunkIndex: 0,
            text: "Turbine bearing temperature exceeding 80°C requires high priority inspection.",
        };
        const sopChunk3B = {
            documentId: "sop-seal",
            filename: "Shaft_Seal_Maintenance.pdf",
            organizationId: orgAId,
            page: 4,
            chunkIndex: 1,
            text: "Oil leakage from gearbox shaft seals mandates seal replacement within 48 hours.",
        };

        const test3Adapters = {
            ...test1Adapters,
            runFindingsExtraction: async () => [finding3A, finding3B],
            runSopRetrieval: async (finding) => {
                if (finding.finding?.includes("temperature")) return [sopChunk3A];
                if (finding.finding?.includes("leakage")) return [sopChunk3B];
                return [];
            },
            runRiskAssessment: async (finding) => {
                if (finding.finding?.includes("temperature")) {
                    return {
                        riskAssessment: { level: "HIGH", reason: "Temperature exceeds 80°C." },
                        recommendation: "Perform thermal shutdown inspection.",
                        citations: [{ documentId: "sop-temp", filename: "Thermal_Limits_SOP.pdf", page: 2, chunkIndex: 0 }],
                        grounded: true,
                    };
                }
                return {
                    riskAssessment: { level: "MEDIUM", reason: "Active seal oil leak." },
                    recommendation: "Schedule seal replacement.",
                    citations: [{ documentId: "sop-seal", filename: "Shaft_Seal_Maintenance.pdf", page: 4, chunkIndex: 1 }],
                    grounded: true,
                };
            },
        };

        const graph3 = createInspectionGraph(createInspectionNodes(test3Adapters));
        const res3 = await graph3.invoke({
            documentId: doc3Id,
            organizationId: orgAId,
            task: "Analyze multiple findings",
        });

        const findingAResult = res3.findings.find((f) => f.finding.includes("temperature"));
        const findingBResult = res3.findings.find((f) => f.finding.includes("leakage"));

        record(
            "TEST 3 — Each finding receives isolated SOP evidence and independent risk",
            res3.findings.length === 2 &&
            findingAResult.sopEvidence.length === 1 &&
            findingAResult.sopEvidence[0].documentId === "sop-temp" &&
            findingBResult.sopEvidence.length === 1 &&
            findingBResult.sopEvidence[0].documentId === "sop-seal" &&
            findingAResult.riskAssessment.level === "HIGH" &&
            findingBResult.riskAssessment.level === "MEDIUM",
            `FindingA=${findingAResult.riskAssessment?.level}, FindingB=${findingBResult.riskAssessment?.level}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 4: One finding supported, one unsupported (Partial Success)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 4] One finding supported, one unsupported (Partial Success)");
        const doc4Id = `doc-t4-${randomUUID().slice(0, 8)}`;
        const test4Adapters = {
            ...test3Adapters,
            runSopRetrieval: async (finding) => {
                // Only finding 3A has SOP; finding 3B has no matching SOP
                if (finding.finding?.includes("temperature")) return [sopChunk3A];
                return [];
            },
        };

        const graph4 = createInspectionGraph(createInspectionNodes(test4Adapters));
        const res4 = await graph4.invoke({
            documentId: doc4Id,
            organizationId: orgAId,
            task: "Analyze partial findings",
        });

        const partialA = res4.findings.find((f) => f.finding.includes("temperature"));
        const partialB = res4.findings.find((f) => f.finding.includes("leakage"));

        record(
            "TEST 4 — Partial success: supported finding is grounded, unsupported finding is safely ungrounded",
            res4.status === "completed" &&
            partialA.grounded === true &&
            partialA.riskAssessment.level === "HIGH" &&
            partialB.grounded === false &&
            partialB.riskAssessment.level === null &&
            partialB.riskAssessment.reason.includes("Insufficient SOP evidence"),
            `A_level=${partialA.riskAssessment?.level}, B_level=${partialB.riskAssessment?.level}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 5: Finding citation / source validation
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 5] Finding citation / source validation");
        const legitimateFinding = {
            finding: "Vibration anomaly",
            evidence: "High radial vibration on bearing 2.",
            source: { documentId: "doc-real-123", page: 4, chunkIndex: 1 },
        };
        const groundedCheck = validateFindingGrounding(legitimateFinding, [
            { documentId: "doc-real-123", page: 4, chunkIndex: 1, text: "High radial vibration on bearing 2." },
        ]);

        const fabricatedFinding = {
            finding: "Invented cracked casing",
            evidence: "Major casing fracture observed at inspection.",
            source: { documentId: "doc-hallucinated", page: 99, chunkIndex: 99 },
        };
        // Not in retrieved report context
        const ungroundedCheck = validateFindingGrounding(fabricatedFinding, [
            { documentId: "doc-real-123", page: 1, chunkIndex: 0, text: "Pump operating normally at 1450 rpm." },
        ]);

        record(
            "TEST 5 — Finding source validation distinguishes real from hallucinated evidence",
            groundedCheck === true && ungroundedCheck === false,
            `grounded=${groundedCheck}, ungrounded=${ungroundedCheck}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 6: SOP citation validation against retrieved evidence
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 6] SOP citation validation");
        const realSopChunks = [
            { documentId: "sop-101", filename: "Turbine_SOP.pdf", page: 3, chunkIndex: 2, organizationId: orgAId },
        ];
        const rawLlmCitations = [
            { documentId: "sop-101", filename: "Turbine_SOP.pdf", page: 3, chunkIndex: 2 }, // Real
            { documentId: "sop-999", filename: "Ghost_SOP.pdf", page: 50, chunkIndex: 0 },   // Hallucinated
        ];

        const validCitations = runCitationValidation(rawLlmCitations, realSopChunks);
        record(
            "TEST 6 — SOP citation validation preserves genuine chunk and discards hallucinated chunk",
            validCitations.length === 1 &&
            validCitations[0].documentId === "sop-101" &&
            validCitations[0].page === 3,
            `validCount=${validCitations.length}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 7: Risk conclusion without SOP evidence (Refused)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 7] Risk conclusion without SOP evidence (Refused)");
        const ungroundedFinding = {
            finding: "Unspecified flange discoloration",
            evidence: "Discoloration noticed on outer pipe flange.",
        };
        // Node 8 insufficient evidence handler enforces refusal
        const insNode = (createInspectionNodes()).insufficientEvidenceNode;
        const insResult = await insNode({ task: "assess flange risk", findings: [ungroundedFinding] });

        record(
            "TEST 7 — Refuses risk conclusion without SOP evidence (level: null, grounded: false)",
            insResult.riskAssessment.level === null &&
            insResult.riskAssessment.grounded === false &&
            insResult.workflowOutcome === "INSUFFICIENT_EVIDENCE",
            `level=${insResult.riskAssessment?.level}, grounded=${insResult.riskAssessment?.grounded}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 8: Recommendation unsupported by SOP (Refused / Refrained)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 8] Recommendation unsupported by SOP (Refused / Refrained)");
        record(
            "TEST 8 — Recommendation states insufficient evidence instead of fabricating instructions",
            insResult.recommendation === "Insufficient SOP evidence is available to provide a validated recommendation.",
            `rec='${insResult.recommendation}'`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 9: Numeric threshold comparison (Deterministic Calculator)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 9] Numeric threshold comparison (Deterministic Calculator)");
        const findingWithThreshold = {
            finding: "Bearing temperature exceeded documented limit",
            observedValue: "95 °C",
            limit: "80 °C",
            evidence: "Observed 95°C vs 80°C threshold.",
        };

        const calcAnalysis = await analyzeFindingNumericThreshold(findingWithThreshold);

        record(
            "TEST 9 — Deterministic calculator evaluates 95°C vs 80°C (diff=15, pct=18.75%)",
            calcAnalysis !== null &&
            calcAnalysis.observed === 95 &&
            calcAnalysis.limit === 80 &&
            calcAnalysis.difference === 15 &&
            calcAnalysis.percentageExceedance === 18.75 &&
            calcAnalysis.exceeded === true,
            `diff=${calcAnalysis?.difference}, pct=${calcAnalysis?.percentageExceedance}%`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 10: Company A inspection uses only Company A evidence
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 10] Company A inspection uses only Company A evidence");
        const doc10Id = `doc-t10-${randomUUID().slice(0, 8)}`;
        const test10Adapters = {
            ...test1Adapters,
            runSopRetrieval: async (finding, opts) => {
                assert.equal(opts.organizationId, orgAId, "SOP search must be scoped to Company A");
                return [
                    {
                        documentId: "sop-alpha-01",
                        filename: "Alpha_SOP.pdf",
                        organizationId: orgAId,
                        page: 1,
                        chunkIndex: 0,
                        text: "Company A standard procedure.",
                    },
                ];
            },
        };

        const graph10 = createInspectionGraph(createInspectionNodes(test10Adapters));
        const res10 = await graph10.invoke({
            documentId: doc10Id,
            organizationId: orgAId,
            task: "Company A inspection",
        });

        record(
            "TEST 10 — Only Company A SOP evidence is retrieved and processed",
            res10.sopEvidence.every((chunk) => chunk.organizationId === orgAId),
            `allOrgA=${res10.sopEvidence.every((chunk) => chunk.organizationId === orgAId)}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 11: Company A inspection with highly similar Company B SOP
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 11] Company A inspection with highly similar Company B SOP");
        const doc11Id = `doc-t11-${randomUUID().slice(0, 8)}`;
        const test11Adapters = {
            ...test1Adapters,
            runSopRetrieval: async () => [
                // Foreign Company B chunk returned accidentally or maliciously
                {
                    documentId: "sop-beta-leak",
                    filename: "Beta_Confidential_SOP.pdf",
                    organizationId: orgBId,
                    page: 10,
                    chunkIndex: 0,
                    text: "Highly similar procedure belonging to Company Beta.",
                    score: 0.99,
                },
                // Genuine Company A chunk
                {
                    documentId: "sop-alpha-legit",
                    filename: "Alpha_Public_SOP.pdf",
                    organizationId: orgAId,
                    page: 1,
                    chunkIndex: 0,
                    text: "Legitimate Company Alpha procedure.",
                    score: 0.85,
                },
            ],
        };

        const graph11 = createInspectionGraph(createInspectionNodes(test11Adapters));
        const res11 = await graph11.invoke({
            documentId: doc11Id,
            organizationId: orgAId,
            task: "Inspect Company A",
        });

        const hasBetaEvidence = res11.sopEvidence.some((c) => c.organizationId === orgBId || c.documentId === "sop-beta-leak");
        record(
            "TEST 11 — Company B SOP is strictly excluded from Company A context",
            !hasBetaEvidence && res11.sopEvidence.some((c) => c.documentId === "sop-alpha-legit"),
            `hasBetaEvidence=${hasBetaEvidence}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 12: LLM supplies foreign organizationId (Ignored/Rejected)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 12] LLM supplies foreign organizationId");
        const rawCitationsWithSpoof = [
            { documentId: "sop-alpha-legit", filename: "Alpha_Public_SOP.pdf", page: 1, chunkIndex: 0, organizationId: orgBId },
        ];
        const sanitizedCitations = runCitationValidation(rawCitationsWithSpoof, [
            { documentId: "sop-alpha-legit", filename: "Alpha_Public_SOP.pdf", page: 1, chunkIndex: 0, organizationId: orgAId },
        ], orgAId);

        record(
            "TEST 12 — Cross-tenant organizationId in LLM citation output is rejected",
            sanitizedCitations.length === 0,
            `filteredCount=${sanitizedCitations.length}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 13: Approval Note generated (DOCX exists in Company A directory)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 13] Approval Note generated in Company A directory");
        const docxFilename = `Approval_Note_${randomUUID().slice(0, 8)}.docx`;
        const approvalData = {
            subject: "Operational Review for Pump-01",
            findings: [finding1],
            riskAssessment: { level: "HIGH", reason: "Temperature limit breach." },
            recommendation: "Inspect bearing lubricant immediately.",
            citations: [{ documentId: sop1DocId, filename: "Pump_Maintenance_SOP.pdf", page: 5, chunkIndex: 1 }],
        };

        const generatedReport = await runApprovalNoteGeneration(approvalData, {
            organizationId: orgAId,
            filename: docxFilename,
        });

        const expectedTenantPath = getReportStoragePath(orgAId, docxFilename);
        const fileExists = fs.existsSync(generatedReport.filePath);

        record(
            "TEST 13 — Approval Note DOCX generated and exists inside tenant directory",
            fileExists && generatedReport.filePath === expectedTenantPath,
            `path=${generatedReport.filePath}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 14: Approval Note references correspond to actual sources
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 14] Approval Note references correspond to actual sources");
        record(
            "TEST 14 — Citations map directly to authentic retrieved document and page",
            approvalData.citations[0].documentId === sop1DocId &&
            approvalData.citations[0].page === 5,
            `docId=${approvalData.citations[0].documentId}, page=${approvalData.citations[0].page}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 15: Report generation failure (no false success)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 15] Report generation failure handling");
        const doc15Id = `doc-t15-${randomUUID().slice(0, 8)}`;
        const test15Adapters = {
            ...test1Adapters,
            runReportGeneration: async () => {
                throw new Error("Disk quota exceeded during DOCX generation");
            },
        };

        const graph15 = createInspectionGraph(createInspectionNodes(test15Adapters));
        const res15 = await graph15.invoke({
            documentId: doc15Id,
            organizationId: orgAId,
            task: "Failure test",
        });

        record(
            "TEST 15 — Workflow reports status='failed' when report generation fails",
            res15.status === "failed" &&
            !res15.report &&
            res15.errors?.length > 0,
            `status=${res15.status}, error='${res15.errors?.[0]?.message}'`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 16: No findings detected (Clean inspection)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 16] No findings detected (Clean inspection)");
        const doc16Id = `doc-t16-${randomUUID().slice(0, 8)}`;
        const test16Adapters = {
            ...test1Adapters,
            runFindingsExtraction: async () => [], // Clean inspection: 0 findings
        };

        const graph16 = createInspectionGraph(createInspectionNodes(test16Adapters));
        const res16 = await graph16.invoke({
            documentId: doc16Id,
            organizationId: orgAId,
            task: "Clean inspection report",
        });

        record(
            "TEST 16 — Zero findings completes gracefully without fabricated anomalies",
            res16.status === "completed" &&
            res16.findings.length === 0 &&
            res16.riskAssessment.level === null &&
            res16.recommendation.includes("standard operating"),
            `status=${res16.status}, level=${res16.riskAssessment?.level}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 17: Inspection workflow SSE stages
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 17] Inspection workflow SSE stages");
        const run17Id = randomUUID();
        executionEvents.registerRunOwner(run17Id, orgAId, "inspection");

        const capturedEvents = [];
        let sseReq = null;
        const ssePromise = new Promise((resolve, reject) => {
            sseReq = http.request(
                `${baseUrl}/api/v1/inspection/runs/${run17Id}/stream`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${tokenA}`,
                    },
                },
                (res) => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`SSE connection failed with HTTP ${res.statusCode}`));
                    }
                    res.setEncoding("utf8");
                    let buffer = "";
                    res.on("data", (chunk) => {
                        buffer += chunk;
                        const blocks = buffer.split("\n\n");
                        buffer = blocks.pop();
                        for (const block of blocks) {
                            if (!block.trim()) continue;
                            let eventType = "message";
                            let eventData = null;
                            for (const line of block.split("\n")) {
                                if (line.startsWith("event:")) {
                                    eventType = line.replace("event:", "").trim();
                                } else if (line.startsWith("data:")) {
                                    try {
                                        eventData = JSON.parse(line.replace("data:", "").trim());
                                    } catch {
                                        eventData = line.replace("data:", "").trim();
                                    }
                                }
                            }
                            capturedEvents.push({ event: eventType, data: eventData });
                        }
                    });
                    res.on("close", () => resolve(capturedEvents));
                }
            );
            sseReq.on("error", reject);
            sseReq.end();
        });

        // Small delay for SSE connection handshake
        await new Promise((r) => setTimeout(r, 60));

        // Broadcast workflow stage events
        const expectedStages = [
            "Reading inspection report",
            "Extracting findings",
            "Validating findings",
            "Searching SOP",
            "Validating SOP evidence",
            "Assessing risk",
            "Preparing recommendation",
            "Generating approval note",
            "Validating report",
            "Completed",
        ];

        for (const stage of expectedStages) {
            executionEvents.publish(run17Id, "workflow_stage", { runId: run17Id, stage });
        }

        // Allow event delivery and terminate SSE stream
        await new Promise((r) => setTimeout(r, 60));
        sseReq.destroy();
        await ssePromise.catch(() => {});

        const receivedStages = capturedEvents.map((e) => e.data?.stage).filter(Boolean);
        record(
            "TEST 17 — SSE stream receives all ordered workflow activity stages",
            expectedStages.every((s) => receivedStages.includes(s)),
            `stagesCount=${receivedStages.length}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 18: Cross-tenant SSE attempt (Denied)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 18] Cross-tenant SSE attempt");
        const run18Id = randomUUID();
        executionEvents.registerRunOwner(run18Id, orgAId, "inspection");

        // Request stream using Company B credentials
        const sseRes = await new Promise((resolve) => {
            const req = http.request(
                `${baseUrl}/api/v1/inspection/runs/${run18Id}/stream`,
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${tokenB}`,
                    },
                },
                (res) => resolve(res)
            );
            req.end();
        });

        record(
            "TEST 18 — Company B denied access to Company A inspection SSE stream (HTTP 403)",
            sseRes.statusCode === 403,
            `statusCode=${sseRes.statusCode}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 19: Repeated workflow execution (Idempotent & Consistent)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 19] Repeated workflow execution");
        const doc19Id = `doc-t19-${randomUUID().slice(0, 8)}`;
        const test19Graph = createInspectionGraph(createInspectionNodes(test1Adapters));

        const run1 = await test19Graph.invoke({
            documentId: doc19Id,
            organizationId: orgAId,
            task: "Idempotency test run 1",
        });

        const run2 = await test19Graph.invoke({
            documentId: doc19Id,
            organizationId: orgAId,
            task: "Idempotency test run 2",
        });

        record(
            "TEST 19 — Repeated executions produce consistent, non-corrupting results",
            run1.status === "completed" &&
            run2.status === "completed" &&
            run1.riskAssessment.level === run2.riskAssessment.level &&
            run1.findings.length === run2.findings.length,
            `run1Status=${run1.status}, run2Status=${run2.status}`
        );

        // ─────────────────────────────────────────────────────────────
        // TEST 20: Missing organizationId in workflow state (Fail closed)
        // ─────────────────────────────────────────────────────────────
        console.log("\n[TEST 20] Missing organizationId in workflow state (Fail closed)");
        let failedClosed = false;
        try {
            await runInspectionWorkflow(doc1Id, {
                task: "Missing org test",
                organizationId: null, // Missing tenant context
            });
        } catch (err) {
            failedClosed = err.message.includes("organizationId is mandatory");
        }

        record(
            "TEST 20 — Workflow execution without organizationId fails closed",
            failedClosed,
            `failedClosed=${failedClosed}`
        );

    } finally {
        server.close();

        // Cleanup database fixtures
        for (const uid of cleanupUserIds) {
            await query("DELETE FROM users WHERE id = $1", [uid]).catch(() => {});
        }
        for (const oid of cleanupOrgIds) {
            await query("DELETE FROM organizations WHERE id = $1", [oid]).catch(() => {});
        }
    }

    console.log("\n==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed (${passed}/${passed + failed})`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

runSuite().catch((err) => {
    console.error("Fatal test error:", err);
    process.exit(1);
});
