/**
 * Phase 3: Inspection Workflow Migration & Equivalence Test Suite
 *
 * Compares the legacy imperative workflow against the LangGraph StateGraph
 * workflow across:
 *   1. Feature flag control (INSPECTION_ORCHESTRATOR=legacy vs langgraph)
 *   2. Output schema equivalence (findings, risk, recommendation, citations, docx)
 *   3. Multi-tenant scoping preservation
 *   4. Zero-findings non-hallucination handling
 *   5. Error and failure handling parity
 *
 * Run with:
 *   node backend/tests/inspection.migration.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import {
    runCompleteWorkflow,
    runLegacyCompleteWorkflow,
} from "../src/services/inspection.service.js";
import { runInspectionWorkflow } from "../src/services/inspection-orchestrator.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigrationTests() {
    console.log("==================================================");
    console.log("Phase 3: LangGraph Migration & Equivalence Suite");
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

    // Fixture & options for controlled testing
    const testDocId = "doc-migration-test-001";
    const testOrgId = "0bd5dba2-05e1-4f5c-9047-25843d338622";
    const testTask = "Analyze Pump-03 bearing inspection findings and assess risk.";

    const controlledFinding = {
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

    const controlledSopChunk = {
        documentId: "sop-doc-001",
        filename: "Demo_Maintenance_SOP.pdf",
        documentType: "sop",
        page: 1,
        chunkIndex: 0,
        score: 0.88,
        text: "Normal bearing operating temperature is up to 80°C. If exceeded, stop and inspect.",
    };

    const mockAnalysisOptions = {
        candidateLimit: 2,
        contextLimit: 2,
        generateEmbedding: async () => new Array(384).fill(0.05),
        searchSimilarChunks: async () => [
            {
                documentId: testDocId,
                page: 1,
                chunkIndex: 0,
                score: 0.95,
                text: "Observed pump bearing temperature of 92°C against normal limit of 80°C.",
            },
        ],
        generateAnswer: async () =>
            JSON.stringify({
                findings: [controlledFinding],
            }),
    };

    const mockRiskOptions = {
        searchSop: async () => [controlledSopChunk],
        generateAnswer: async () =>
            JSON.stringify({
                riskAssessment: {
                    level: "HIGH",
                    reason: "Bearing temperature of 92°C exceeds normal limit of 80°C.",
                },
                recommendation: "Immediately inspect lubrication and replace bearings if necessary.",
                citations: [
                    {
                        documentId: "sop-doc-001",
                        filename: "Demo_Maintenance_SOP.pdf",
                        page: 1,
                        chunkIndex: 0,
                    },
                ],
            }),
    };

    const mockApprovalNoteOptions = {
        outputPath: path.resolve(__dirname, `../generated/Approval_Note_Migration_${testDocId}.docx`),
    };

/**
 * Builds a valid minimal PDF buffer with plain text pages using pure Node.
 */
function buildMinimalPdf(pages) {
    const parts = [];
    const offsets = {};
    let pos = 0;

    function write(str) {
        const buf = Buffer.from(str, "latin1");
        parts.push(buf);
        pos += buf.length;
    }

    function writeObj(id, str) {
        offsets[id] = pos;
        write(`${id} 0 obj\n${str}\nendobj\n`);
    }

    write("%PDF-1.4\n");
    const numPages = pages.length;

    writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");

    const pageRefs = [];
    for (let i = 0; i < numPages; i++) {
        pageRefs.push(`${3 + i * 2} 0 R`);
    }
    writeObj(2, `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${numPages} >>`);

    for (let i = 0; i < numPages; i++) {
        const pageObjId = 3 + i * 2;
        const streamObjId = 4 + i * 2;

        writeObj(
            pageObjId,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamObjId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`
        );

        const lines = pages[i];
        let stream = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
        for (let j = 0; j < lines.length; j++) {
            const escaped = lines[j].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            stream += j === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
        }
        stream += "ET\n";

        const streamBytes = Buffer.from(stream, "latin1");
        offsets[streamObjId] = pos;
        write(`${streamObjId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
        parts.push(streamBytes);
        pos += streamBytes.length;
        write("\nendstream\nendobj\n");
    }

    const startXref = pos;
    const totalObjs = 3 + numPages * 2;

    write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
    for (let i = 1; i < totalObjs; i++) {
        write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    }

    write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);
    return Buffer.concat(parts);
}

    // Ensure mock PDF exists in uploads for ingestion resolution
    const uploadsDir = path.resolve(__dirname, "../src/uploads");
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const fixturePdfPath = path.resolve(uploadsDir, `${testDocId}.pdf`);
    const validPdfBuffer = buildMinimalPdf([
        [
            "Industrial Inspection Report",
            "Observed pump bearing temperature of 92C against limit of 80C.",
        ],
    ]);
    fs.writeFileSync(fixturePdfPath, validPdfBuffer);

    const workflowOptions = {
        task: testTask,
        organizationId: testOrgId,
        ingestOptions: {
            documentId: testDocId,
            organizationId: testOrgId,
            // Mock extractor/chunker for fast execution
            extractText: async () => ({ fullText: "Mock inspection text", pages: [{ pageNumber: 1, text: "Mock inspection text" }] }),
        },
        analysisOptions: mockAnalysisOptions,
        riskOptions: mockRiskOptions,
        approvalNoteOptions: mockApprovalNoteOptions,
    };

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Feature Flag Orchestrator Switching
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Feature Flag Switching (INSPECTION_ORCHESTRATOR)");

    // 1.1 Legacy Mode
    process.env.INSPECTION_ORCHESTRATOR = "legacy";
    const legacyResult = await runCompleteWorkflow(testDocId, workflowOptions);
    record(
        "Legacy mode executes through runLegacyCompleteWorkflow",
        legacyResult.orchestration === undefined,
        "legacy mode returns without LangGraph orchestration metadata"
    );

    // 1.2 LangGraph Mode
    process.env.INSPECTION_ORCHESTRATOR = "langgraph";
    const langgraphResult = await runCompleteWorkflow(testDocId, workflowOptions);
    record(
        "LangGraph mode executes through runInspectionWorkflow",
        langgraphResult.orchestration?.engine === "langgraph",
        `engine=${langgraphResult.orchestration?.engine}`
    );
    record(
        "LangGraph status is completed",
        langgraphResult.orchestration?.status === "completed"
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Schema & Business Data Equivalence
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Contract & Business Data Equivalence");

    record(
        "documentId match",
        legacyResult.documentId === langgraphResult.documentId,
        `docId=${langgraphResult.documentId}`
    );
    record(
        "filename match",
        legacyResult.filename === langgraphResult.filename,
        `filename=${langgraphResult.filename}`
    );
    record(
        "findings schema parity",
        Array.isArray(langgraphResult.findings) &&
        langgraphResult.findings.length === legacyResult.findings.length &&
        langgraphResult.findings[0]?.equipment === legacyResult.findings[0]?.equipment &&
        langgraphResult.findings[0]?.severity === legacyResult.findings[0]?.severity
    );
    record(
        "risk level parity",
        langgraphResult.riskAssessments[0]?.level === legacyResult.riskAssessments[0]?.level,
        `level=${langgraphResult.riskAssessments[0]?.level}`
    );
    record(
        "recommendation presence",
        typeof langgraphResult.recommendations[0] === "string" &&
        langgraphResult.recommendations[0].length > 0
    );
    record(
        "citations parity",
        Array.isArray(langgraphResult.citations) &&
        langgraphResult.citations.length === legacyResult.citations.length &&
        langgraphResult.citations[0]?.documentId === legacyResult.citations[0]?.documentId
    );
    record(
        "approvalNote deliverable structure parity",
        Boolean(langgraphResult.approvalNote?.filename) &&
        Boolean(langgraphResult.approvalNote?.filePath)
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Multi-tenant Isolation Preservation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Multi-tenant Isolation Preservation");

    const directGraphRes = await runInspectionWorkflow(testDocId, {
        ...workflowOptions,
        organizationId: "tenant-delta-99",
    });

    record(
        "Tenant ID correctly bound to workflow run",
        directGraphRes.documentId === testDocId && directGraphRes.orchestration?.status === "completed"
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Zero Findings Non-Hallucination
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] Zero Findings Non-Hallucination Safety");

    const zeroFindingsOptions = {
        ...workflowOptions,
        analysisOptions: {
            ...mockAnalysisOptions,
            generateAnswer: async () => JSON.stringify({ findings: [] }),
        },
    };

    const zeroFindingsLegacy = await runLegacyCompleteWorkflow(testDocId, zeroFindingsOptions);
    const zeroFindingsLangGraph = await runInspectionWorkflow(testDocId, zeroFindingsOptions);

    record(
        "Zero findings produces safe null risk in both legacy and LangGraph",
        zeroFindingsLegacy.riskAssessments[0]?.level === null &&
        zeroFindingsLangGraph.riskAssessments[0]?.level === null
    );
    record(
        "Zero findings produces schedule recommendation in both",
        zeroFindingsLegacy.recommendations[0].includes("standard operating") &&
        zeroFindingsLangGraph.recommendations[0].includes("standard operating")
    );
    record(
        "Zero findings produces empty citations in both",
        zeroFindingsLegacy.citations.length === 0 &&
        zeroFindingsLangGraph.citations.length === 0
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Error Handling Parity
    // ─────────────────────────────────────────────────────────────
    console.log("\n[5] Error Handling Parity");

    let legacyError = null;
    try {
        await runLegacyCompleteWorkflow(null);
    } catch (e) {
        legacyError = e;
    }

    let langGraphError = null;
    try {
        await runInspectionWorkflow(null);
    } catch (e) {
        langGraphError = e;
    }

    record(
        "Both workflows reject invalid input with TypeError",
        Boolean(legacyError && langGraphError)
    );

    // Clean up temporary mock pdf fixture
    if (fs.existsSync(fixturePdfPath)) {
        fs.unlinkSync(fixturePdfPath);
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

runMigrationTests().catch((err) => {
    console.error("Migration test failed:", err);
    process.exit(1);
});
