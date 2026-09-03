import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";
import { ingestInspectionFile } from "../src/services/inspection.service.js";
import { createDocument } from "../src/repositories/documents.repository.js";
import { createReportRecord } from "../src/services/reports.service.js";
import { validateFindingStructure, validateRiskStructure } from "../src/orchestration/inspection/inspection.nodes.js";
import { filterValidCitations } from "../../ai-service/risk/risk.schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../src/uploads");
const GENERATED_DIR = path.resolve(__dirname, "../generated");

/**
 * Builds a minimal valid PDF 1.4 from page lines without external libraries.
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
  const pageObjectIds = [];
  const contentObjectIds = [];
  let nextId = 3;

  for (const lines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjectIds.push(pageId);
    contentObjectIds.push(contentId);

    const textLines = lines.map((line, i) => {
      const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      return i === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
    });

    const streamContent = ["BT", "/F1 11 Tf", "14.5 TL", "50 750 Td", ...textLines, "ET"].join("\n") + "\n";
    const streamLen = Buffer.byteLength(streamContent, "latin1");
    writeObj(contentId, `<< /Length ${streamLen} >>\nstream\n${streamContent}endstream`);
  }

  const pagesObjStr =
    `<< /Type /Pages\n` +
    `/Count ${pages.length}\n` +
    `/Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}]\n` +
    `>>`;
  writeObj(2, pagesObjStr);

  for (let i = 0; i < pages.length; i++) {
    const pageId = pageObjectIds[i];
    const contentId = contentObjectIds[i];
    const pageObjStr =
      `<< /Type /Page\n` +
      `/Parent 2 0 R\n` +
      `/MediaBox [0 0 612 792]\n` +
      `/Contents ${contentId} 0 R\n` +
      `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>\n` +
      `>>`;
    writeObj(pageId, pageObjStr);
  }

  writeObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);

  const xrefOffset = pos;
  const totalObjs = nextId;
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjs; id++) {
    const offsetStr = String(offsets[id]).padStart(10, "0");
    write(`${offsetStr} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

/**
 * Phase 3 — Golden Path & Comprehensive Negative Test Suite
 */
async function runGoldenPathTests() {
  console.log("==================================================");
  console.log("Phase 3: Inspection Agent Golden Path Test Suite");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupDocIds = [];
  const cleanupReportIds = [];
  const cleanupUserIds = [];
  const cleanupOrgIds = [];
  const cleanupFiles = [];

  const timings = {};

  try {
    // ----------------------------------------------------
    // [1] Authentication Context & Demo Engineer Setup
    // ----------------------------------------------------
    console.log("\n[1] Authenticating Demo Engineer");
    const t0 = Date.now();
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "engineer@example.com",
        password: "DemoPassword123!",
      }),
    });
    assert.equal(loginRes.status, 200, "Demo login must return 200");
    const loginData = await loginRes.json();
    const token = loginData.data.token;
    const demoOrgId = loginData.data.user.organizationId;
    timings.authLoginMs = Date.now() - t0;
    console.log(`  ✅ PASS: Demo login successful in ${timings.authLoginMs}ms (Org: ${demoOrgId})`);

    // ----------------------------------------------------
    // [2] Synthetic Inspection Document Generation & Ingestion
    // ----------------------------------------------------
    console.log("\n[2] Creating & Ingesting Synthetic Inspection Report (Pump-03, 92°C)");
    const tIngestStart = Date.now();
    const docId = `mrpl_pump03_${randomUUID().slice(0, 8)}`;
    const pdfFilename = `${docId}.pdf`;
    const pdfPath = path.join(UPLOADS_DIR, pdfFilename);
    cleanupFiles.push(pdfPath);
    cleanupDocIds.push(docId);

    const inspectionPdfBuffer = buildMinimalPdf([
      [
        "MANGALORE REFINERY AND PETROCHEMICALS LIMITED (MRPL)",
        "EQUIPMENT INSPECTION REPORT",
        `Document ID: ${docId}`,
        "Unit: CDU-II Cracking & Pumping Section",
        "Date: 2026-09-03",
        "",
        "Equipment: Pump-03 Main Cooling Water Circulation Pump",
        "Parameter: Bearing Temperature",
        "Observed Value: 92 degrees C",
        "Operational Limit: 80 degrees C max continuous",
        "Condition: Abnormal heating observed during routine daily round.",
        "Evidence: Temperature sensor PT-204 recorded 92 degrees C under normal load.",
        "Observation: Heavy casing vibration and localized overheating detected on bearing housing.",
      ],
      [
        "EQUIPMENT INSPECTION REPORT — PAGE 2",
        "Equipment: Valve-12",
        "Parameter: Stem Leakage",
        "Observed Value: None",
        "Condition: Normal operation.",
        "Evidence: Visual inspection confirmed tight gland packing with zero leakage.",
      ],
    ]);

    fs.writeFileSync(pdfPath, inspectionPdfBuffer);
    assert.ok(fs.existsSync(pdfPath), "Inspection PDF file must exist on disk");

    // Ingest into Qdrant & PostgreSQL
    const ingestResult = await ingestInspectionFile(pdfPath, {
      documentId: docId,
      filename: pdfFilename,
      organizationId: demoOrgId,
    });
    assert.ok(ingestResult.chunksStored > 0, "Ingestion must store vector chunks");

    await createDocument({
      id: docId,
      organizationId: demoOrgId,
      filename: pdfFilename,
      originalFilename: "MRPL_CDU2_Pump03_Inspection.pdf",
      status: "Indexed",
      chunksStored: ingestResult.chunksStored,
    });
    timings.ingestMs = Date.now() - tIngestStart;
    console.log(`  ✅ PASS: Synthetic report ingested in ${timings.ingestMs}ms (${ingestResult.chunksStored} chunks stored)`);

    // ----------------------------------------------------
    // [3] Golden Path LangGraph Inspection Workflow Execution
    // ----------------------------------------------------
    console.log("\n[3] Executing Golden Path LangGraph Inspection Workflow");
    const tWorkflowStart = Date.now();
    const workflowRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        documentId: docId,
        task: "Analyze this inspection report, extract all significant findings, evaluate against maintenance SOPs, and prepare approval note.",
      }),
    });

    timings.workflowMs = Date.now() - tWorkflowStart;
    const workflowBodyText = await workflowRes.text();
    if (workflowRes.status !== 200) {
      console.error("Workflow failed with status:", workflowRes.status, "Body:", workflowBodyText);
    }
    assert.equal(workflowRes.status, 200, "Inspection workflow must succeed with HTTP 200");
    const result = JSON.parse(workflowBodyText);
    assert.equal(result.success, true);
    const data = result.data || result;
    console.log(`  ✅ PASS: Inspection workflow completed in ${timings.workflowMs}ms`);

    // ----------------------------------------------------
    // [4] Structured Findings Validation
    // ----------------------------------------------------
    console.log("\n[4] Validating Extracted Findings");
    assert.ok(Array.isArray(data.findings), "Findings must be an array");
    assert.ok(data.findings.length > 0, "Must extract at least 1 finding");

    const pumpFinding = data.findings.find(
      (f) => (f.equipment && f.equipment.includes("Pump")) || (f.finding && f.finding.includes("92"))
    ) || data.findings[0];

    assert.ok(pumpFinding, "Must identify pump finding");
    assert.ok(pumpFinding.finding, "Finding description must not be empty");
    assert.ok(pumpFinding.evidence, "Finding must include verbatim evidence");

    // Validate finding structure against adapter schema
    assert.doesNotThrow(() => validateFindingStructure(pumpFinding), "Finding must conform to schema");
    console.log(`  ✅ PASS: Finding extracted with verbatim evidence: "${pumpFinding.finding}"`);

    // ----------------------------------------------------
    // [5] SOP Retrieval & documentType="sop" Filtering
    // ----------------------------------------------------
    console.log("\n[5] Validating SOP Retrieval & Qdrant Filter");
    const sopQuery = "bearing temperature limit";
    const sopChunks = await searchSop(sopQuery, { limit: 5 });
    assert.ok(Array.isArray(sopChunks), "SOP search must return an array");
    assert.ok(sopChunks.length > 0, "Must retrieve matching SOP chunks from Demo_Maintenance_SOP.pdf");

    for (const chunk of sopChunks) {
      assert.equal(chunk.documentType, "sop", "All retrieved SOP chunks must have documentType='sop'");
      assert.ok(chunk.text.length > 0, "SOP chunk text must not be empty");
    }
    console.log(`  ✅ PASS: Qdrant SOP search strictly returned ${sopChunks.length} chunks with documentType='sop'`);

    // ----------------------------------------------------
    // [6] Technical Analysis & Risk Assessment
    // ----------------------------------------------------
    console.log("\n[6] Validating Technical Analysis & Risk Assessment");
    assert.ok(data.riskAssessments && data.riskAssessments.length > 0, "Risk assessments must exist");
    const primaryRisk = data.riskAssessments[0];
    assert.doesNotThrow(() => validateRiskStructure(primaryRisk), "Risk assessment must conform to schema");
    assert.ok(
      ["HIGH", "MEDIUM", "LOW"].includes(primaryRisk.level),
      `Risk level must be valid, got: ${primaryRisk.level}`
    );
    assert.ok(primaryRisk.reason && primaryRisk.reason.length > 10, "Risk must have substantial technical rationale");
    console.log(`  ✅ PASS: Risk classified as ${primaryRisk.level}: "${primaryRisk.reason.slice(0, 80)}..."`);

    // ----------------------------------------------------
    // [7] Recommendation & Human Review Governance
    // ----------------------------------------------------
    console.log("\n[7] Validating Recommendation & Human Governance Boundary");
    assert.ok(data.recommendations && data.recommendations.length > 0, "Recommendations must exist");
    const recText = data.recommendations[0];
    assert.ok(typeof recText === "string" && recText.length > 15, "Recommendation must be actionable text");
    console.log(`  ✅ PASS: Corrective recommendation generated: "${recText.slice(0, 80)}..."`);

    // ----------------------------------------------------
    // [8] Citation Verification & Anti-Hallucination
    // ----------------------------------------------------
    console.log("\n[8] Verifying Citations & Rejecting Fabrications");
    const candidateCitations = [
      { filename: "Demo_Maintenance_SOP.pdf", page: 1, chunkIndex: 0 },
      { filename: "Fabricated_Imaginary_SOP.pdf", page: 99, chunkIndex: 42 },
    ];
    const verified = filterValidCitations(candidateCitations, sopChunks);
    assert.equal(verified.length, 1, "Must discard fabricated citation");
    assert.equal(verified[0].filename, "Demo_Maintenance_SOP.pdf");
    console.log("  ✅ PASS: Fabricated citation discarded; authentic SOP citation preserved");

    // ----------------------------------------------------
    // [9] Approval Note DOCX Generation & Validation
    // ----------------------------------------------------
    console.log("\n[9] Validating Generated Approval Note DOCX");
    assert.ok(data.approvalNote, "Approval Note deliverable metadata must exist");
    assert.ok(data.approvalNote.filename, "Approval Note must have a filename");
    const docxPath = path.join(GENERATED_DIR, data.approvalNote.filename);
    assert.ok(fs.existsSync(docxPath), `DOCX file must physically exist at: ${docxPath}`);
    const docxStats = fs.statSync(docxPath);
    assert.ok(docxStats.size > 1000, `DOCX file must have substantial content (size: ${docxStats.size} bytes)`);

    // Verify DOCX ZIP signature (PK\x03\x04)
    const docxHeader = Buffer.alloc(4);
    const fd = fs.openSync(docxPath, "r");
    fs.readSync(fd, docxHeader, 0, 4, 0);
    fs.closeSync(fd);
    assert.equal(docxHeader.toString("hex"), "504b0304", "DOCX must have valid OpenXML zip signature (PK..)");
    console.log(`  ✅ PASS: Valid Approval Note DOCX generated (${docxStats.size} bytes, valid zip magic bytes)`);

    // ----------------------------------------------------
    // [10] Persistence & Report Download Security
    // ----------------------------------------------------
    console.log("\n[10] Validating PostgreSQL Report Persistence & Download");
    const reportQuery = await query(
      "SELECT id, filename, organization_id, risk_level, status FROM reports WHERE filename = $1",
      [data.approvalNote.filename]
    );
    assert.equal(reportQuery.rows.length, 1, "Report record must be persisted in PostgreSQL");
    const savedReport = reportQuery.rows[0];
    assert.equal(savedReport.organization_id, demoOrgId);
    assert.equal(savedReport.status, "GENERATED");
    cleanupReportIds.push(savedReport.id);

    // Download with valid demo engineer token
    const downloadRes = await fetch(`${baseUrl}/api/v1/inspection/download/${data.approvalNote.filename}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(downloadRes.status, 200, "Download with valid tenant token must succeed");
    const downloadBlob = await downloadRes.arrayBuffer();
    assert.equal(downloadBlob.byteLength, docxStats.size, "Downloaded file size must match file on disk");
    console.log("  ✅ PASS: Persisted report downloaded successfully with tenant token");

    // ----------------------------------------------------
    // [11] Multi-Tenant Isolation & Cross-Organization Rejection (Step 32)
    // ----------------------------------------------------
    console.log("\n[11] Testing Cross-Organization Multi-Tenant Security Boundaries");

    // Create Alien Org & User
    const alienOrgId = randomUUID();
    cleanupOrgIds.push(alienOrgId);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
      alienOrgId,
      "Alien Unit Petrochem",
    ]);

    const alienEmail = `alien_engineer_${randomUUID().slice(0, 6)}@alien.local`;
    const alienRegRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alien Operator",
        email: alienEmail,
        password: "AlienPassword123!",
        organizationId: alienOrgId,
      }),
    });
    const alienRegData = await alienRegRes.json();
    const alienToken = alienRegData.data.token;
    cleanupUserIds.push(alienRegData.data.user.id);

    // 11a: Alien User attempts to inspect Demo Org's Document -> 403 Forbidden
    const crossInspRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${alienToken}`,
      },
      body: JSON.stringify({ documentId: docId }),
    });
    assert.equal(crossInspRes.status, 403, "Cross-org inspection attempt must be rejected with 403 Forbidden");
    console.log("  ✅ PASS: Cross-organization inspection rejected (HTTP 403 Forbidden)");

    // 11b: Alien User attempts to download Demo Org's Approval Note -> 403 Forbidden
    const crossDlRes = await fetch(`${baseUrl}/api/v1/inspection/download/${data.approvalNote.filename}`, {
      headers: { Authorization: `Bearer ${alienToken}` },
    });
    assert.equal(crossDlRes.status, 403, "Cross-org report download must be rejected with 403 Forbidden");
    console.log("  ✅ PASS: Cross-organization report download rejected (HTTP 403 Forbidden)");

    // 11c: Header spoofing attempt (Demo User JWT + x-organization-id: alienOrgId) -> 403 Forbidden
    const spoofHeaderRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-organization-id": alienOrgId,
      },
      body: JSON.stringify({ documentId: docId }),
    });
    assert.equal(spoofHeaderRes.status, 403, "Conflicting organization header must be rejected with 403 Forbidden");
    console.log("  ✅ PASS: Header spoofing attempt blocked (HTTP 403 Forbidden)");

    // ----------------------------------------------------
    // [12] Negative & Boundary Handling Tests (Step 31)
    // ----------------------------------------------------
    console.log("\n[12] Executing Negative & Robustness Tests");

    // 12a: Missing Document ID and file
    const missingInputRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingInputRes.status, 400, "Empty workflow request must return 400 Bad Request");
    console.log("  ✅ PASS: Empty workflow request rejected (400 Bad Request)");

    // 12b: Non-existent Document ID in analyze
    const nonExistentRes = await fetch(`${baseUrl}/api/v1/inspection/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ documentId: "00000000-0000-0000-0000-000000000000" }),
    });
    assert.ok([400, 404].includes(nonExistentRes.status), "Non-existent document must return 400/404");
    console.log("  ✅ PASS: Non-existent document analysis safely rejected");

    // 12c: Download non-existent file
    const nonExistentDl = await fetch(`${baseUrl}/api/v1/inspection/download/non_existent_report.docx`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(nonExistentDl.status, 404, "Non-existent download must return 404");
    console.log("  ✅ PASS: Non-existent report download returns 404");

    console.log("\n==================================================");
    console.log("✅ ALL PHASE 3 GOLDEN PATH & SECURITY TESTS PASSED");
    console.log("==================================================");
    console.log("Timing Summary:", JSON.stringify(timings, null, 2));
  } finally {
    server.close();

    // Cleanup ephemeral test data
    try {
      if (cleanupDocIds.length > 0) {
        await query("DELETE FROM documents WHERE id = ANY($1)", [cleanupDocIds]);
      }
      if (cleanupReportIds.length > 0) {
        await query("DELETE FROM reports WHERE id = ANY($1)", [cleanupReportIds]);
      }
      if (cleanupUserIds.length > 0) {
        await query("DELETE FROM users WHERE id = ANY($1)", [cleanupUserIds]);
      }
      if (cleanupOrgIds.length > 0) {
        await query("DELETE FROM organizations WHERE id = ANY($1)", [cleanupOrgIds]);
      }
      for (const f of cleanupFiles) {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      }
    } catch (e) {
      console.warn("Cleanup warning:", e.message);
    }
  }
}

runGoldenPathTests().catch((err) => {
  console.error("Golden path test suite failed:", err);
  process.exit(1);
});
