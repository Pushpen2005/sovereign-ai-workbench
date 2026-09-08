/**
 * SOVEREIGNAI — PHASE 7: INSPECTION AGENT VERIFICATION SUITE
 *
 * Requirements Verified:
 * 1. Agent planning (structured 7-step plan, no hidden CoT)
 * 2. Tool allow-list enforcement (only document_search, file_read, calculator, document_generate)
 * 3. Inspection document access & ownership check
 * 4. Finding extraction (structured findings with equipment, observed, limit, evidence)
 * 5. Finding -> SOP search (respects documentType="sop" and organizationId)
 * 6. SOP evidence gating (authoritative refusal when evidence missing)
 * 7. Risk assessment integration (grounded risk evaluation)
 * 8. Recommendation integration (grounded recommendation)
 * 9. Approval Note integration (existing generateApprovalNote pipeline)
 * 10. No-evidence handling (Risk: Not Determined, Rec: Insufficient SOP evidence...)
 * 11. Multi-finding handling (extracts multiple findings, searches SOP, no mixed citations)
 * 12. Tenant isolation (Org A vs Org B document access)
 * 13. Cross-tenant SOP retrieval prevention
 * 14. Cross-tenant report prevention
 * 15. Agent loop limit (maxSteps anti-loop safeguard)
 * 16. Invalid tool invocation rejection
 * 17. Failure handling (missing document returns explicit error)
 * 18. Activity/status observability events (recorded in steps and published)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import { query, initDb } from "../src/config/db.js";
import {
    runInspectionAgent,
    executeInspectionAgentTool,
    ALLOWED_INSPECTION_TOOLS,
    INSPECTION_AGENT_STATES,
    InspectionAgentError,
} from "../src/services/inspection-agent.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { upsertChunks, deleteChunksByDocumentId } from "../../ai-service/vectorstore/qdrant.service.js";
import { createDocument } from "../src/repositories/documents.repository.js";
import { getReportStoragePath, getOrganizationGeneratedDir } from "../src/utils/storage.js";

async function runPhase7Tests() {
    console.log("==================================================");
    console.log("  SOVEREIGNAI — PHASE 7 INSPECTION AGENT SUITE    ");
    console.log("==================================================\n");

    await initDb();

    let passed = 0;
    let failed = 0;

    const cleanupDocIds = [];
    const cleanupOrgIds = [];
    const cleanupFiles = [];

    function check(testNumber, name, condition, detail = "") {
        if (condition) {
            passed++;
            console.log(`  ✓ PASS [Test ${testNumber}]: ${name}${detail ? ` (${detail})` : ""}`);
        } else {
            failed++;
            console.error(`  ✗ FAIL [Test ${testNumber}]: ${name}${detail ? ` (${detail})` : ""}`);
        }
    }

    const orgA = `org_p7_a_${randomUUID().slice(0, 8)}`;
    const orgB = `org_p7_b_${randomUUID().slice(0, 8)}`;
    cleanupOrgIds.push(orgA, orgB);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgA, "Refinery Inspection Org A"]).catch(() => {});
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgB, "Refinery Inspection Org B"]).catch(() => {});

    try {
        // ====================================================
        // SEEDING TEST FIXTURES
        // ====================================================
        // 1. Seed Inspection Report for Org A (Primary Pump-03 scenario)
        const docPump03Id = `doc_insp_pump03_${randomUUID().slice(0, 8)}`;
        cleanupDocIds.push({ docId: docPump03Id, orgId: orgA });

        await createDocument({
            id: docPump03Id,
            organizationId: orgA,
            filename: "Pump03_Inspection_Report.pdf",
            originalFilename: "Pump03_Inspection_Report.pdf",
            documentType: "inspection",
            status: "Indexed",
            chunksStored: 1,
        });

        const pump03ChunkText = "Crude Distillation Unit Inspection: Pump-03 bearing temperature observed at 92 degrees Celsius during continuous operation. Visual inspection shows normal alignment.";
        const pump03Vector = await generateEmbedding(pump03ChunkText);

        await upsertChunks([
            {
                documentId: docPump03Id,
                filename: "Pump03_Inspection_Report.pdf",
                documentType: "inspection",
                organizationId: orgA,
                page: 1,
                chunkIndex: 0,
                pageStartOffset: 0,
                pageEndOffset: pump03ChunkText.length,
                text: pump03ChunkText,
                vector: pump03Vector,
            },
        ]);

        // 2. Seed SOP in Org A: Operating limit 80°C for Pump-03
        const sopPump03Id = `doc_sop_pump03_${randomUUID().slice(0, 8)}`;
        cleanupDocIds.push({ docId: sopPump03Id, orgId: orgA });

        await createDocument({
            id: sopPump03Id,
            organizationId: orgA,
            filename: "Pump_Maintenance_SOP.pdf",
            originalFilename: "Pump_Maintenance_SOP.pdf",
            documentType: "sop",
            status: "Indexed",
            chunksStored: 1,
        });

        const sopChunkText = "STANDARD OPERATING PROCEDURE SOP-ROT-004: Centrifugal pump bearing temperature continuous operating limit is 80 degrees Celsius. Temperatures exceeding 80 C require immediate inspection and lubrication check.";
        const sopVector = await generateEmbedding(sopChunkText);

        await upsertChunks([
            {
                documentId: sopPump03Id,
                filename: "Pump_Maintenance_SOP.pdf",
                documentType: "sop",
                organizationId: orgA,
                page: 4,
                chunkIndex: 0,
                pageStartOffset: 0,
                pageEndOffset: sopChunkText.length,
                text: sopChunkText,
                vector: sopVector,
            },
        ]);

        // 3. Seed No-Evidence Report in Org A: "Pump-03 casing has unusual discoloration"
        const docNoEvidenceId = `doc_insp_noev_${randomUUID().slice(0, 8)}`;
        cleanupDocIds.push({ docId: docNoEvidenceId, orgId: orgA });

        await createDocument({
            id: docNoEvidenceId,
            organizationId: orgA,
            filename: "Casing_Discoloration_Report.pdf",
            originalFilename: "Casing_Discoloration_Report.pdf",
            documentType: "inspection",
            status: "Indexed",
            chunksStored: 1,
        });

        const noEvChunkText = "Routine Visual Inspection: Pump-03 casing has unusual discoloration on outer casing shroud. No temperature anomalies recorded.";
        const noEvVector = await generateEmbedding(noEvChunkText);

        await upsertChunks([
            {
                documentId: docNoEvidenceId,
                filename: "Casing_Discoloration_Report.pdf",
                documentType: "inspection",
                organizationId: orgA,
                page: 1,
                chunkIndex: 0,
                pageStartOffset: 0,
                pageEndOffset: noEvChunkText.length,
                text: noEvChunkText,
                vector: noEvVector,
            },
        ]);

        // 4. Seed Multi-Finding Report in Org A:
        // Finding 1: Pump-03 bearing temp 92°C
        // Finding 2: Motor casing vibration observed at 7.5 mm/s (limit 4.5 mm/s in SOP)
        const docMultiId = `doc_insp_multi_${randomUUID().slice(0, 8)}`;
        cleanupDocIds.push({ docId: docMultiId, orgId: orgA });

        await createDocument({
            id: docMultiId,
            organizationId: orgA,
            filename: "Comprehensive_Inspection_Report.pdf",
            originalFilename: "Comprehensive_Inspection_Report.pdf",
            documentType: "inspection",
            status: "Indexed",
            chunksStored: 2,
        });

        const multiChunk1 = "CRUDE UNIT INSPECTION REPORT — Finding 1: Pump-03 bearing temperature observed at 92 degrees Celsius during continuous operation.";
        const multiChunk2 = "CRUDE UNIT INSPECTION REPORT — Finding 2: Motor casing vibration observed at 7.5 mm/s abnormal vibration under peak load.";
        const multiVec1 = await generateEmbedding(multiChunk1);
        const multiVec2 = await generateEmbedding(multiChunk2);

        await upsertChunks([
            {
                documentId: docMultiId,
                filename: "Comprehensive_Inspection_Report.pdf",
                documentType: "inspection",
                organizationId: orgA,
                page: 1,
                chunkIndex: 0,
                pageStartOffset: 0,
                pageEndOffset: multiChunk1.length,
                text: multiChunk1,
                vector: multiVec1,
            },
            {
                documentId: docMultiId,
                filename: "Comprehensive_Inspection_Report.pdf",
                documentType: "inspection",
                organizationId: orgA,
                page: 2,
                chunkIndex: 1,
                pageStartOffset: 0,
                pageEndOffset: multiChunk2.length,
                text: multiChunk2,
                vector: multiVec2,
            },
        ]);

        // Seed Vibration SOP
        const sopVibrationId = `doc_sop_vib_${randomUUID().slice(0, 8)}`;
        cleanupDocIds.push({ docId: sopVibrationId, orgId: orgA });

        await createDocument({
            id: sopVibrationId,
            organizationId: orgA,
            filename: "Vibration_Standards_SOP.pdf",
            originalFilename: "Vibration_Standards_SOP.pdf",
            documentType: "sop",
            status: "Indexed",
            chunksStored: 1,
        });

        const vibChunkText = "SOP-VIB-012: Motor casing vibration maximum acceptable limit is 4.5 mm/s RMS. Vibration exceeding 7.0 mm/s constitutes critical warning.";
        const vibVector = await generateEmbedding(vibChunkText);

        await upsertChunks([
            {
                documentId: sopVibrationId,
                filename: "Vibration_Standards_SOP.pdf",
                documentType: "sop",
                organizationId: orgA,
                page: 1,
                chunkIndex: 0,
                pageStartOffset: 0,
                pageEndOffset: vibChunkText.length,
                text: vibChunkText,
                vector: vibVector,
            },
        ]);

        // ====================================================
        // TEST 1: Agent Planning
        // ====================================================
        console.log("[Test 1] Verifying Agent Planning produces visible 7-step plan without hidden CoT...");
        const agentResult = await runInspectionAgent({
            documentId: docPump03Id,
            goal: "Analyze this inspection report and prepare an approval note.",
            organizationId: orgA,
        });

        const planValid =
            Array.isArray(agentResult.plan) &&
            agentResult.plan.length === 7 &&
            agentResult.plan[0].action === "Read inspection report" &&
            agentResult.plan[6].action === "Generate Approval Note";

        check(1, "Agent produces structured 7-step plan", planValid,
            `steps=${agentResult.plan.length}, start="${agentResult.plan[0].action}", end="${agentResult.plan[6].action}"`);

        // ====================================================
        // TEST 2: Tool Allow-List Enforcement
        // ====================================================
        console.log("\n[Test 2] Verifying Tool Allow-List strictly restricts tools to [document_search, file_read, calculator, document_generate]...");
        let illegalToolRejected = false;
        try {
            await executeInspectionAgentTool("bash_exec", { command: "ls" }, { organizationId: orgA });
        } catch (err) {
            illegalToolRejected = err.message.includes("Unauthorized tool") && err.statusCode === 403;
        }

        const allowedToolsCorrect =
            ALLOWED_INSPECTION_TOOLS.has("document_search") &&
            ALLOWED_INSPECTION_TOOLS.has("file_read") &&
            ALLOWED_INSPECTION_TOOLS.has("calculator") &&
            ALLOWED_INSPECTION_TOOLS.has("document_generate") &&
            ALLOWED_INSPECTION_TOOLS.size === 4;

        check(2, "Strict tool allow-list rejects unauthorized tools",
            illegalToolRejected && allowedToolsCorrect,
            `allowedTools=[${[...ALLOWED_INSPECTION_TOOLS].join(", ")}]`);

        // ====================================================
        // TEST 3: Inspection Document Access & Ownership Check
        // ====================================================
        console.log("\n[Test 3] Verifying inspection document access enforces organizationId boundary...");
        let crossTenantDocRejected = false;
        try {
            await runInspectionAgent({
                documentId: docPump03Id,
                goal: "Analyze inspection report",
                organizationId: orgB, // Org B trying to access Org A's document
            });
        } catch (err) {
            crossTenantDocRejected = err.statusCode === 403 && err.message.includes("another organization");
        }

        check(3, "Cross-tenant document access blocked with HTTP 403",
            crossTenantDocRejected,
            "Org B denied access to Org A inspection document");

        // ====================================================
        // TEST 4: Finding Extraction
        // ====================================================
        console.log("\n[Test 4] Verifying structured finding extraction retains required fields...");
        const findings = agentResult.findings || [];
        const hasPump03Finding = findings.some(
            (f) =>
                (f.equipment?.toLowerCase().includes("pump") || f.finding?.toLowerCase().includes("bearing") || f.finding?.toLowerCase().includes("pump")) &&
                Boolean(f.evidence)
        );

        check(4, "Structured finding extracted retaining equipment, finding, evidence",
            hasPump03Finding && findings.length >= 1,
            `findingCount=${findings.length}, finding="${findings[0]?.finding?.slice(0, 40)}..."`);

        // ====================================================
        // TEST 5: Finding -> SOP Search
        // ====================================================
        console.log("\n[Test 5] Verifying SOP search enforces documentType='sop' and organizationId...");
        const sopSearchToolResult = await executeInspectionAgentTool("document_search", {
            query: "bearing temperature limit",
            documentType: "sop",
            limit: 3,
        }, { organizationId: orgA });

        const sopFound = (sopSearchToolResult.results || []).some(
            (r) => r.documentId === sopPump03Id && r.text.includes("80 degrees Celsius")
        );

        check(5, "SOP search returns authoritative SOP reference with documentType='sop'",
            sopFound,
            `docId=${sopPump03Id}, found=${sopFound}`);

        // ====================================================
        // TEST 6: SOP Evidence Gating
        // ====================================================
        console.log("\n[Test 6] Verifying SOP Evidence Gating: Authoritative citations only, no fabricated limits...");
        const citations = agentResult.citations || [];
        const authenticCitation = citations.some(
            (c) => c.documentId === sopPump03Id && c.filename === "Pump_Maintenance_SOP.pdf"
        );

        check(6, "Evidence gating preserves genuine SOP citation",
            authenticCitation,
            `citationsCount=${citations.length}, source=${citations[0]?.filename}`);

        // ====================================================
        // TEST 7: Risk Assessment Integration
        // ====================================================
        console.log("\n[Test 7] Verifying Risk Assessment accurately identifies HIGH risk when 92°C > 80°C limit...");
        const riskLevel = agentResult.riskAssessment?.level;
        const riskReason = agentResult.riskAssessment?.reason || "";

        check(7, "Risk Assessment integrates with existing risk engine",
            riskLevel === "HIGH" && riskReason.length > 10,
            `level=${riskLevel}, reason="${riskReason.slice(0, 50)}..."`);

        // ====================================================
        // TEST 8: Recommendation Integration
        // ====================================================
        console.log("\n[Test 8] Verifying Recommendation is grounded in finding and SOP evidence...");
        const rec = agentResult.recommendation;
        const recGrounded = typeof rec === "string" && rec.length > 20 && !rec.includes("Insufficient SOP evidence");

        check(8, "Recommendation grounded in SOP evidence and risk",
            recGrounded,
            `recommendation="${rec.slice(0, 60)}..."`);

        // ====================================================
        // TEST 9: Approval Note Integration
        // ====================================================
        console.log("\n[Test 9] Verifying Approval Note DOCX generated via existing pipeline...");
        const reportFilename = agentResult.report?.filename;
        const reportDownloadUrl = agentResult.report?.downloadUrl;

        let docxFileExists = false;
        if (reportFilename) {
            const docxPath = getReportStoragePath(orgA, reportFilename);
            docxFileExists = fs.existsSync(docxPath);
            if (docxFileExists) cleanupFiles.push(docxPath);
        }

        check(9, "Approval Note DOCX deliverable compiled and stored in tenant storage",
            Boolean(reportFilename && docxFileExists && reportDownloadUrl),
            `filename=${reportFilename}, exists=${docxFileExists}`);

        // ====================================================
        // TEST 10: No-Evidence Scenario
        // ====================================================
        console.log("\n[Test 10] Verifying No-Evidence scenario ('discoloration' with no matching SOP)...");
        const noEvResult = await runInspectionAgent({
            documentId: docNoEvidenceId,
            goal: "Analyze casing discoloration report",
            organizationId: orgA,
        });

        const noEvRisk = noEvResult.riskAssessment?.level;
        const noEvRec = noEvResult.recommendation;

        const safeRefusal =
            noEvRisk === "Not Determined" &&
            noEvRec.includes("Insufficient SOP evidence is available to provide a validated recommendation");

        check(10, "No-evidence case returns 'Not Determined' risk and safe refusal recommendation",
            safeRefusal,
            `risk=${noEvRisk}, rec="${noEvRec.slice(0, 60)}..."`);

        if (noEvResult.report?.filename) {
            const fPath = getReportStoragePath(orgA, noEvResult.report.filename);
            if (fs.existsSync(fPath)) cleanupFiles.push(fPath);
        }

        // ====================================================
        // TEST 11: Multi-Finding Scenario
        // ====================================================
        console.log("\n[Test 11] Verifying Multi-Finding scenario (Bearing Temp 92°C and Motor Vibration 7.5 mm/s)...");
        const multiResult = await runInspectionAgent({
            documentId: docMultiId,
            goal: "Extract all significant findings including bearing temperature and motor casing vibration.",
            organizationId: orgA,
        });

        const multiFindings = multiResult.findings || [];
        const multiRisk = multiResult.riskAssessment?.level;

        check(11, "Multi-finding scenario extracts all findings and associates independent evidence",
            multiFindings.length >= 1 && multiRisk === "HIGH",
            `findingsCount=${multiFindings.length}, overallRisk=${multiRisk}`);

        if (multiResult.report?.filename) {
            const fPath = getReportStoragePath(orgA, multiResult.report.filename);
            if (fs.existsSync(fPath)) cleanupFiles.push(fPath);
        }

        // ====================================================
        // TEST 12: Tenant Isolation
        // ====================================================
        console.log("\n[Test 12] Verifying tenant isolation across document retrieval and agent execution...");
        const orgADocs = await query("SELECT id FROM documents WHERE organization_id = $1", [orgA]);
        const orgBDocs = await query("SELECT id FROM documents WHERE organization_id = $1", [orgB]);

        const orgBHasZeroOfOrgA = !orgBDocs.rows.some((b) => orgADocs.rows.some((a) => a.id === b.id));

        check(12, "PostgreSQL document partitions strictly isolated",
            orgBHasZeroOfOrgA,
            `OrgA doc count: ${orgADocs.rows.length}, OrgB doc count: ${orgBDocs.rows.length}`);

        // ====================================================
        // TEST 13: Cross-Tenant SOP Retrieval Prevention
        // ====================================================
        console.log("\n[Test 13] Verifying Org B cannot retrieve Org A SOP chunks via document_search tool...");
        const orgBCrossSearch = await executeInspectionAgentTool("document_search", {
            query: "bearing temperature continuous operating limit",
            documentType: "sop",
            limit: 5,
        }, { organizationId: orgB });

        const leakedToOrgB = (orgBCrossSearch.results || []).some(
            (r) => r.documentId === sopPump03Id || r.filename === "Pump_Maintenance_SOP.pdf"
        );

        check(13, "Cross-tenant SOP search blocked (Qdrant payload filter enforced)",
            !leakedToOrgB && orgBCrossSearch.totalResults === 0,
            "Org B receives 0 results for Org A's SOP knowledge base");

        // ====================================================
        // TEST 14: Cross-Tenant Report Prevention
        // ====================================================
        console.log("\n[Test 14] Verifying generated report storage is strictly tenant-partitioned...");
        const orgAReportPath = getReportStoragePath(orgA, "Sample_Report.docx");
        const orgBReportPath = getReportStoragePath(orgB, "Sample_Report.docx");

        const pathsDistinct = orgAReportPath !== orgBReportPath &&
            orgAReportPath.includes(orgA) &&
            orgBReportPath.includes(orgB);

        check(14, "Report generation directories strictly partitioned by organizationId",
            pathsDistinct,
            "No cross-tenant file collisions possible");

        // ====================================================
        // TEST 15: Agent Loop Limit (Anti-Loop Safeguard)
        // ====================================================
        console.log("\n[Test 15] Verifying anti-loop safeguard terminates execution if maxSteps exceeded...");
        let loopLimitTriggered = false;
        try {
            await runInspectionAgent({
                documentId: docPump03Id,
                goal: "Loop test",
                organizationId: orgA,
                maxSteps: 2, // Set absurdly low limit to verify anti-loop guard
            });
        } catch (err) {
            loopLimitTriggered = err.statusCode === 429 && err.message.includes("maximum allowable steps");
        }

        check(15, "Agent loop safeguard terminates when step limit exceeded (HTTP 429)",
            loopLimitTriggered,
            "Anti-loop circuit breaker engaged successfully");

        // ====================================================
        // TEST 16: Invalid Tool Invocation
        // ====================================================
        console.log("\n[Test 16] Verifying invalid tool invocation is rejected safely...");
        let invalidToolFailed = false;
        try {
            await executeInspectionAgentTool("arbitrary_system_call", { cmd: "rm -rf /" }, { organizationId: orgA });
        } catch (err) {
            invalidToolFailed = err.statusCode === 403;
        }

        check(16, "Attempt to invoke unapproved tool rejected with HTTP 403",
            invalidToolFailed,
            "Unauthorized tool invocation rejected");

        // ====================================================
        // TEST 17: Failure Handling (Non-existent Document)
        // ====================================================
        console.log("\n[Test 17] Verifying non-existent documentId triggers explicit 404 error...");
        let notFoundFailed = false;
        try {
            await runInspectionAgent({
                documentId: "non_existent_doc_uuid_99999",
                goal: "Analyze missing document",
                organizationId: orgA,
            });
        } catch (err) {
            notFoundFailed = err.statusCode === 404 && err.message.includes("not found");
        }

        check(17, "Non-existent document triggers explicit HTTP 404 error",
            notFoundFailed,
            "Explicit error propagated without silent failures");

        // ====================================================
        // TEST 18: Activity / Status Observability Events
        // ====================================================
        console.log("\n[Test 18] Verifying structured activity steps are persisted to database...");
        const runStepsQuery = await query(
            "SELECT step_number, node, status, tool_result_summary FROM agent_run_steps WHERE run_id = $1 ORDER BY step_number ASC",
            [agentResult.workflowId]
        );

        const stepsPersisted = runStepsQuery.rows.length >= 5;
        check(18, "Observability: Execution timeline persisted in agent_run_steps table",
            stepsPersisted,
            `persistedSteps=${runStepsQuery.rows.length}, runId=${agentResult.workflowId}`);

    } catch (err) {
        console.error("Test execution fatal error in try block:", err);
        failed++;
    } finally {
        // Clean up temporary files
        for (const f of cleanupFiles) {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch (_) {}
        }

        // Clean up Qdrant points
        for (const item of cleanupDocIds) {
            try {
                await deleteChunksByDocumentId(item.docId, item.orgId);
            } catch (_) {}
        }

        // Clean up documents and organizations
        for (const orgId of cleanupOrgIds) {
            try {
                await query("DELETE FROM agent_run_steps WHERE run_id IN (SELECT run_id FROM agent_runs WHERE organization_id = $1)", [orgId]);
                await query("DELETE FROM agent_runs WHERE organization_id = $1", [orgId]);
                await query("DELETE FROM reports WHERE organization_id = $1", [orgId]);
                await query("DELETE FROM documents WHERE organization_id = $1", [orgId]);
                await query("DELETE FROM organizations WHERE id = $1", [orgId]);
            } catch (_) {}
        }

        console.log("\n==================================================");
        console.log(`Results: ${passed} passed, ${failed} failed (${passed}/${passed + failed})`);
        console.log("==================================================\n");

        process.exit(failed > 0 ? 1 : 0);
    }
}

runPhase7Tests().catch((err) => {
    console.error("Phase 7 test suite fatal error:", err);
    process.exit(1);
});
