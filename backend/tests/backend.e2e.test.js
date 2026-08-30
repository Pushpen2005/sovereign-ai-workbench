/**
 * PR #17 — Backend Integration E2E Test Suite
 *
 * Tests the complete backend HTTP surface:
 *   1. Health check (17.1)
 *   2. PDF upload (17.2)
 *   3. Inspection ingestion (17.3)
 *   4. Qdrant payload verification (documentType="inspection", 384-d vector)
 *   5. Inspection analysis (17.4)
 *   6. Risk workflow (17.5)
 *   7. Approval Note DOCX generation & download (17.6)
 *   8. Complete inspection workflow (17.7)
 *   9. Negative & error handling scenarios
 *
 * Run with:
 *   node backend/tests/backend.e2e.test.js
 */

import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";

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

async function run() {
    console.log("=== PR #17 — Backend Integration E2E Test Suite ===\n");

    // Start ephemeral server on random available port
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`✓ Test backend server running at ${baseUrl}\n`);

    let uploadedDocId = null;
    let uploadedFilename = null;

    try {
        // ─── 1. Health Check (17.1) ──────────────────────────────────────────
        console.log("  [1] Testing GET /api/v1/health...");
        const healthRes = await fetch(`${baseUrl}/api/v1/health`);
        assert.equal(healthRes.status, 200);
        const healthData = await healthRes.json();
        assert.deepEqual(healthData, { status: "ok" });
        console.log("    ✓ Health check endpoint operational");

        // ─── 2. PDF Upload (17.2) ────────────────────────────────────────────
        console.log("\n  [2] Testing POST /api/v1/inspection/upload...");
        const samplePdfBuffer = buildMinimalPdf([
            [
                "INDUSTRIAL INSPECTION REPORT",
                "Facility: Plant-01",
                "Equipment: Pump-03",
                "Inspection Type: Contact Probe & Thermal Imaging",
                "Observation: Pump-03 bearing temperature was observed at 92 degrees C.",
                "Specification: Documented continuous operating limit is 80 degrees C.",
                "Severity Context: High temperature condition requiring evaluation.",
            ],
        ]);

        const uploadFormData = new FormData();
        uploadFormData.append(
            "document",
            new Blob([samplePdfBuffer], { type: "application/pdf" }),
            "inspection_report_pump03.pdf"
        );

        const uploadRes = await fetch(`${baseUrl}/api/v1/inspection/upload`, {
            method: "POST",
            body: uploadFormData,
        });

        assert.equal(uploadRes.status, 200, "Upload must return HTTP 200");
        const uploadData = await uploadRes.json();
        assert.equal(uploadData.success, true);
        assert.ok(uploadData.documentId, "documentId must be returned");
        assert.ok(uploadData.filename, "filename must be returned");

        uploadedDocId = uploadData.documentId;
        uploadedFilename = uploadData.filename;
        console.log(`    ✓ Uploaded PDF: documentId=${uploadedDocId}`);

        // ─── 3. Upload Failures & Validation ─────────────────────────────────
        console.log("\n  [3] Testing upload validation (non-PDF and empty)...");
        const badFileForm = new FormData();
        badFileForm.append(
            "document",
            new Blob(["Plain text not allowed"], { type: "text/plain" }),
            "invalid.txt"
        );
        const badFileRes = await fetch(`${baseUrl}/api/v1/inspection/upload`, {
            method: "POST",
            body: badFileForm,
        });
        assert.equal(badFileRes.status, 400, "Non-PDF file must be rejected with HTTP 400");

        const emptyForm = new FormData();
        const emptyRes = await fetch(`${baseUrl}/api/v1/inspection/upload`, {
            method: "POST",
            body: emptyForm,
        });
        assert.equal(emptyRes.status, 400, "Missing file must be rejected with HTTP 400");
        console.log("    ✓ Upload validation correctly rejected invalid inputs");

        // ─── 4. Ingestion API (17.3) ─────────────────────────────────────────
        console.log("\n  [4] Testing POST /api/v1/inspection/ingest...");
        const ingestRes = await fetch(`${baseUrl}/api/v1/inspection/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                documentId: uploadedDocId,
                filename: uploadedFilename,
            }),
        });

        assert.equal(ingestRes.status, 200, "Ingestion must return HTTP 200");
        const ingestData = await ingestRes.json();
        assert.equal(ingestData.success, true);
        assert.equal(ingestData.documentId, uploadedDocId);
        assert.ok(ingestData.chunksStored > 0, "At least 1 chunk must be stored in Qdrant");
        console.log(`    ✓ Ingestion complete: ${ingestData.chunksStored} chunk(s) stored in Qdrant`);

        // ─── 5. Qdrant Verification ──────────────────────────────────────────
        console.log("\n  [5] Verifying points in Qdrant...");
        const qdrantScrollRes = await fetch(`${QDRANT_URL}/collections/documents/points/scroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filter: {
                    must: [
                        { key: "documentId", match: { value: uploadedDocId } },
                    ],
                },
                limit: 10,
                with_payload: true,
                with_vector: true,
            }),
        });

        if (qdrantScrollRes.ok) {
            const scrollData = await qdrantScrollRes.json();
            const points = scrollData.result?.points || [];
            assert.ok(points.length > 0, "Points must exist in Qdrant");

            const samplePoint = points[0];
            assert.equal(
                samplePoint.payload.documentType,
                "inspection",
                "documentType must be 'inspection'"
            );
            assert.equal(
                samplePoint.payload.documentId,
                uploadedDocId,
                "documentId in Qdrant must match uploaded documentId"
            );
            assert.equal(
                samplePoint.vector.length,
                384,
                "Vector must be 384-dimensional"
            );
            console.log("    ✓ Verified in Qdrant: documentType='inspection', vector=384-d");
        } else {
            console.log("    (Notice: Qdrant scroll request returned status " + qdrantScrollRes.status + ")");
        }

        // ─── 6. Inspection Analysis (17.4) ───────────────────────────────────
        console.log("\n  [6] Testing POST /api/v1/inspection/analyze...");
        const analyzeRes = await fetch(`${baseUrl}/api/v1/inspection/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                documentId: uploadedDocId,
                task: "Analyze this inspection report and extract all significant findings.",
            }),
        });

        assert.equal(analyzeRes.status, 200, "Analyze endpoint must return HTTP 200");
        const analyzeData = await analyzeRes.json();
        assert.equal(analyzeData.success, true);
        assert.equal(analyzeData.documentId, uploadedDocId);
        assert.ok(Array.isArray(analyzeData.findings), "findings must be an array");
        console.log(`    ✓ Inspection analysis complete: ${analyzeData.findings.length} finding(s) returned`);

        // ─── 7. Risk Workflow API (17.5) ─────────────────────────────────────
        console.log("\n  [7] Testing POST /api/v1/inspection/risk...");
        const sampleFinding = {
            finding: "Bearing temperature exceeded operating limit",
            equipment: "Pump-03",
            observedValue: "92°C",
            limit: "80°C",
            severity: "HIGH",
            evidence: "Pump-03 bearing temperature was observed at 92 degrees C.",
            source: {
                documentId: uploadedDocId,
                page: 1,
                chunkIndex: 0,
            },
        };

        const riskRes = await fetch(`${baseUrl}/api/v1/inspection/risk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                documentId: uploadedDocId,
                finding: sampleFinding,
            }),
        });

        if (!riskRes.ok) {
            const errBody = await riskRes.json();
            console.error("    [Risk endpoint failed]:", errBody);
        }
        assert.equal(riskRes.status, 200, "Risk endpoint must return HTTP 200");
        const riskData = await riskRes.json();
        assert.equal(riskData.success, true);
        assert.ok(riskData.riskAssessment, "riskAssessment must be present");
        assert.ok(
            ["LOW", "MEDIUM", "HIGH", null].includes(riskData.riskAssessment.level),
            "Risk level must be LOW, MEDIUM, HIGH, or null"
        );
        assert.ok(
            typeof riskData.riskAssessment.reason === "string",
            "riskAssessment.reason must be string"
        );
        assert.ok(typeof riskData.recommendation === "string", "recommendation must be string");
        assert.ok(Array.isArray(riskData.citations), "citations must be an array");
        console.log(`    ✓ Risk assessment: level=${riskData.riskAssessment.level}, citations=${riskData.citations.length}`);

        // ─── 8. Approval Note API & Download (17.6) ──────────────────────────
        console.log("\n  [8] Testing POST /api/v1/inspection/approval-note...");
        const docxRes = await fetch(`${baseUrl}/api/v1/inspection/approval-note`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subject: "Inspection Report Analysis — Pump-03",
                findings: [sampleFinding],
                riskAssessment: riskData.riskAssessment,
                recommendation: riskData.recommendation,
                citations: riskData.citations,
            }),
        });

        assert.equal(docxRes.status, 200, "Approval note endpoint must return HTTP 200");
        const docxData = await docxRes.json();
        assert.equal(docxData.success, true);
        assert.ok(docxData.filename, "Generated filename must be returned");
        assert.ok(docxData.downloadUrl, "Download URL must be returned");
        console.log(`    ✓ Approval note generated: ${docxData.filename}`);

        // Test safe download
        console.log("    → Testing GET download endpoint...");
        const downloadRes = await fetch(`${baseUrl}${docxData.downloadUrl}`);
        assert.equal(downloadRes.status, 200, "Download must return HTTP 200");
        const docxBuffer = await downloadRes.arrayBuffer();
        assert.ok(docxBuffer.byteLength > 1000, "Downloaded DOCX must be non-empty");
        console.log(`    ✓ Downloaded DOCX file (${docxBuffer.byteLength} bytes)`);

        // ─── 9. Complete Workflow API (17.7) ─────────────────────────────────
        console.log("\n  [9] Testing POST /api/v1/inspection/workflow...");
        const workflowForm = new FormData();
        workflowForm.append(
            "document",
            new Blob([samplePdfBuffer], { type: "application/pdf" }),
            "workflow_inspection_report.pdf"
        );
        workflowForm.append("task", "Analyze this inspection report and extract all significant findings.");

        const workflowRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
            method: "POST",
            body: workflowForm,
        });

        assert.equal(workflowRes.status, 200, "Workflow endpoint must return HTTP 200");
        const workflowData = await workflowRes.json();
        assert.equal(workflowData.success, true);
        assert.ok(workflowData.data, "Workflow data must be present");
        assert.ok(workflowData.data.documentId, "Workflow documentId must be present");
        assert.ok(workflowData.data.chunksStored > 0, "Workflow chunksStored must be > 0");
        assert.ok(Array.isArray(workflowData.data.findings), "Workflow findings must be an array");
        assert.ok(Array.isArray(workflowData.data.riskAssessments), "Workflow riskAssessments must be an array");
        assert.ok(Array.isArray(workflowData.data.recommendations), "Workflow recommendations must be an array");
        assert.ok(workflowData.data.approvalNote, "Workflow approvalNote must be present");
        assert.ok(workflowData.data.approvalNote.downloadUrl, "Workflow downloadUrl must be present");
        console.log(`    ✓ Complete workflow finished successfully: ${workflowData.data.approvalNote.filename}`);

        // ─── 10. Additional Negative & Edge Case Tests ───────────────────────
        console.log("\n  [10] Testing negative edge cases...");

        // Ingest without input
        const badIngest = await fetch(`${baseUrl}/api/v1/inspection/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        assert.equal(badIngest.status, 400);

        // Analyze without documentId
        const badAnalyze = await fetch(`${baseUrl}/api/v1/inspection/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: "Analyze" }),
        });
        assert.equal(badAnalyze.status, 400);

        // Risk without finding
        const badRisk = await fetch(`${baseUrl}/api/v1/inspection/risk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documentId: "123" }),
        });
        assert.equal(badRisk.status, 400);

        // Download non-existent file
        const badDownload = await fetch(`${baseUrl}/api/v1/inspection/download/nonexistent.docx`);
        assert.equal(badDownload.status, 404);

        console.log("    ✓ Negative scenarios handled cleanly with proper HTTP status codes");

        console.log("\n==============================================");
        console.log("✅ All PR #17 Backend Integration tests passed");
        console.log("==============================================");
    } catch (error) {
        console.error("\n❌ Backend integration test failed:");
        console.error(error);
        process.exitCode = 1;
    } finally {
        server.close();
    }
}

await run();
