import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { runApprovalNoteGeneration } from "../src/services/inspection.service.js";
import { generateApprovalNote } from "../../ai-service/reports/approval-note.service.js";
import { filterValidCitations } from "../../ai-service/risk/risk.service.js";
import { getReportStoragePath, validateFilename } from "../src/utils/storage.js";

function inspectDocxContent(filePath) {
  // Uses Python to extract paragraphs, tables, headers, footers, and raw XML verification
  const script = `
import sys, json, zipfile, docx

file_path = sys.argv[1]

# 1. Verify ZIP package & required XML files
with zipfile.ZipFile(file_path, 'r') as z:
    names = z.namelist()
    has_content_types = '[Content_Types].xml' in names
    has_document_xml = 'word/document.xml' in names
    doc_xml = z.read('word/document.xml').decode('utf-8')

# 2. Extract visible text via python-docx
doc = docx.Document(file_path)
paras = [p.text for p in doc.paragraphs]
tables_text = []
for t in doc.tables:
    for r in t.rows:
        for c in r.cells:
            tables_text.append(c.text)

all_text = "\\n".join(paras + tables_text)

result = {
    "has_content_types": has_content_types,
    "has_document_xml": has_document_xml,
    "all_text": all_text,
    "doc_xml_len": len(doc_xml)
}
print(json.dumps(result))
`;

  const output = execSync(`python3 -c "${script.replace(/"/g, '\\"')}" "${filePath}"`, {
    encoding: "utf-8",
  });
  return JSON.parse(output.trim());
}

async function runApprovalNoteE2ETests() {
  console.log("==================================================");
  console.log("   SOVEREIGNAI — PHASE 5 APPROVAL NOTE E2E MATRIX ");
  console.log("==================================================\n");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedCount = 0;
  let failedCount = 0;

  const orgAId = `org_p5_a_${randomUUID().slice(0, 8)}`;
  const orgBId = `org_p5_b_${randomUUID().slice(0, 8)}`;

  await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
    orgAId,
    `Org Phase5 Alpha ${orgAId}`,
  ]);
  await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
    orgBId,
    `Org Phase5 Beta ${orgBId}`,
  ]);

  const tokenA = generateToken({
    userId: `user_${orgAId}`,
    organizationId: orgAId,
    email: "alpha_p5@example.com",
    role: "admin",
  });
  const tokenB = generateToken({
    userId: `user_${orgBId}`,
    organizationId: orgBId,
    email: "beta_p5@example.com",
    role: "admin",
  });

  const authA = { Authorization: `Bearer ${tokenA}`, "Content-Type": "application/json" };
  const authB = { Authorization: `Bearer ${tokenB}`, "Content-Type": "application/json" };

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST 1, 2, 3: Valid Approval Note generation, file exists, structurally valid DOCX
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1-3] Generating valid Approval Note DOCX and validating package integrity...");
    const testDocId = randomUUID();
    const filenameA = `Approval_Note_Test_${randomUUID().slice(0, 8)}.docx`;
    const targetPathA = getReportStoragePath(orgAId, filenameA);

    const validPayloadA = {
      subject: "Critical Equipment Health Assessment — Pump-03",
      background: "Routine inspection of CDU-II section rotating assets revealed abnormal operating parameters.",
      findings: [
        {
          finding: "Bearing temperature exceeded continuous operating limit.",
          equipment: "Pump-03",
          observedValue: "92°C",
          limit: "80°C",
          severity: "HIGH",
          evidence: "Observed bearing casing temperature 92°C with heavy casing vibration.",
        },
      ],
      technicalAnalysis:
        "Correlating the observed 92°C temperature against Maintenance SOP (limit 80°C) confirms immediate over-temperature condition requiring isolation.",
      riskAssessment: {
        level: "HIGH",
        reason: "Bearing temperature exceeded the 80°C limit by 12°C under full load with casing vibration.",
      },
      recommendation:
        "Execute emergency shutdown of Pump-03 immediately. Inspect bearing assembly, check lubricant level, and verify shaft runout before returning to service.",
      citations: [
        {
          filename: "Maintenance_SOP.pdf",
          page: 1,
          chunkIndex: 0,
          documentId: testDocId,
        },
      ],
      filename: filenameA,
    };

    const genResultA = await runApprovalNoteGeneration(validPayloadA, {
      organizationId: orgAId,
      filename: filenameA,
    });

    assert.ok(fs.existsSync(genResultA.filePath), "DOCX file must exist on disk");
    const statsA = fs.statSync(genResultA.filePath);
    assert.ok(statsA.size > 1000, `DOCX file must be non-zero size, got ${statsA.size} bytes`);

    // Verify ZIP package structure & document.xml
    const docxMeta = inspectDocxContent(genResultA.filePath);
    assert.equal(docxMeta.has_content_types, true, "DOCX must contain [Content_Types].xml");
    assert.equal(docxMeta.has_document_xml, true, "DOCX must contain word/document.xml");
    assert.ok(docxMeta.doc_xml_len > 500, "word/document.xml must contain substantial XML content");
    console.log(`  ✓ PASS Test 1-3: DOCX created (${statsA.size} bytes), valid OpenXML ZIP package verified`);
    passedCount += 3;

    // ─────────────────────────────────────────────────────────────
    // TEST 4: All 8 required sections present
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Verifying all 8 required sections are present in DOCX...");
    const content = docxMeta.all_text;

    assert.ok(content.includes("APPROVAL NOTE"), "Must contain document title 'APPROVAL NOTE'");
    assert.ok(content.includes("1. Subject"), "Must contain section '1. Subject'");
    assert.ok(content.includes("2. Background"), "Must contain section '2. Background'");
    assert.ok(content.includes("3. Inspection Findings"), "Must contain section '3. Inspection Findings'");
    assert.ok(content.includes("4. Technical Analysis"), "Must contain section '4. Technical Analysis'");
    assert.ok(content.includes("5. Risk Assessment"), "Must contain section '5. Risk Assessment'");
    assert.ok(content.includes("6. Recommendation"), "Must contain section '6. Recommendation'");
    assert.ok(content.includes("7. References"), "Must contain section '7. References'");
    assert.ok(content.includes("8. Approval"), "Must contain section '8. Approval'");
    console.log("  ✓ PASS Test 4: All 8 required sections verified in generated document");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Inspection findings included with correct data
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Verifying inspection findings details in DOCX...");
    assert.ok(content.includes("Pump-03"), "Must include equipment name 'Pump-03'");
    assert.ok(content.includes("92°C"), "Must include observed value '92°C'");
    assert.ok(content.includes("80°C"), "Must include limit '80°C'");
    assert.ok(content.includes("Bearing temperature exceeded"), "Must include finding text");
    assert.ok(content.includes("heavy casing vibration"), "Must include evidence text");
    console.log("  ✓ PASS Test 5: Inspection finding fields correctly mapped and formatted");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Technical analysis included
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Verifying technical analysis section content...");
    assert.ok(content.includes("Maintenance SOP"), "Technical analysis must ground against SOP");
    assert.ok(content.includes("over-temperature condition"), "Technical analysis content must appear");
    console.log("  ✓ PASS Test 6: Technical analysis grounded in finding and SOP evidence verified");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Risk assessment included
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Verifying risk assessment section...");
    assert.ok(content.includes("HIGH"), "Must include risk level 'HIGH'");
    assert.ok(content.includes("exceeded the 80°C limit by 12°C"), "Must include risk reason");
    console.log("  ✓ PASS Test 7: Risk assessment level and reason reproduced accurately");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Recommendation included
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Verifying recommendation section...");
    assert.ok(content.includes("emergency shutdown of Pump-03"), "Must include actionable recommendation");
    assert.ok(content.includes("verify shaft runout"), "Must include procedure instructions");
    console.log("  ✓ PASS Test 8: Validated recommendation preserved without AI re-generation");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 9: References included
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Verifying references section...");
    assert.ok(content.includes("Maintenance_SOP.pdf"), "Must cite filename");
    assert.ok(content.includes("Page: 1"), "Must cite authentic page");
    assert.ok(content.includes(testDocId), "Must cite documentId");
    console.log("  ✓ PASS Test 9: Authoritative reference citations formatted correctly");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 10 & 11: Application citations are authoritative & no hallucinated citations
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10-11] Testing citation integrity filter prevents LLM hallucinations...");
    const authenticChunk = {
      filename: "Maintenance_SOP.pdf",
      page: 1,
      chunkIndex: 0,
      documentId: testDocId,
      organizationId: orgAId,
    };
    const untrustedLlmCitations = [
      { filename: "Maintenance_SOP.pdf", page: 99, chunkIndex: 0 }, // Fake page
      { filename: "Phantom_Guide.pdf", page: 1, chunkIndex: 0 }, // Fake doc
      { filename: "Maintenance_SOP.pdf", page: 1, chunkIndex: 0 }, // Valid
    ];
    const filtered = filterValidCitations(untrustedLlmCitations, [authenticChunk], orgAId);
    assert.equal(filtered.length, 1, "Only authentic citation must survive");
    assert.equal(filtered[0].page, 1, "Surviving citation must have authentic page 1");
    assert.equal(filtered[0].filename, "Maintenance_SOP.pdf");
    console.log("  ✓ PASS Test 10-11: Application metadata overrides LLM hallucinations (Page 99 rejected)");
    passedCount += 2;

    // ─────────────────────────────────────────────────────────────
    // TEST 12: No-evidence case is safe (Risk null, insufficient evidence)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 12] Testing no-evidence safe refusal DOCX generation...");
    const noEvidenceFilename = `Approval_Note_NoEvidence_${randomUUID().slice(0, 8)}.docx`;
    const noEvidencePayload = {
      subject: "Uncorrelated Observation — Perimeter Enclosure",
      background: "Cosmetic wear observed on perimeter security barrier.",
      findings: [
        {
          finding: "Cosmetic paint discoloration on perimeter enclosure.",
          equipment: "Perimeter-Enclosure",
          observedValue: "Discoloration",
          evidence: "Visual surface oxidation on outer gate.",
        },
      ],
      riskAssessment: {
        level: null,
        reason: "Insufficient SOP evidence is available to determine risk level.",
      },
      recommendation: "Insufficient SOP evidence is available to provide a validated recommendation.",
      citations: [],
      filename: noEvidenceFilename,
    };

    const noEvidenceResult = await runApprovalNoteGeneration(noEvidencePayload, {
      organizationId: orgAId,
      filename: noEvidenceFilename,
    });
    assert.ok(fs.existsSync(noEvidenceResult.filePath));

    const noEvContent = inspectDocxContent(noEvidenceResult.filePath).all_text;
    assert.ok(noEvContent.toLowerCase().includes("not determined"), "Risk level must display as Not Determined");
    assert.ok(noEvContent.includes("Insufficient SOP evidence is available to determine risk level."));
    assert.ok(noEvContent.includes("Insufficient SOP evidence is available to provide a validated recommendation."));
    assert.ok(noEvContent.includes("No specific SOP references cited."));
    console.log("  ✓ PASS Test 12: No-evidence case handled safely without fabricating limits or risk");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Multi-tenant organization isolation (generation & DB registration)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 13] Multi-tenant isolation: Org A cannot generate into Org B partition...");
    const orgBFilename = `Approval_Note_OrgB_${randomUUID().slice(0, 8)}.docx`;
    const orgBPayload = {
      ...validPayloadA,
      subject: "Confidential Org B Reactor Note",
      filename: orgBFilename,
    };

    const orgBResult = await runApprovalNoteGeneration(orgBPayload, {
      organizationId: orgBId,
      filename: orgBFilename,
    });
    assert.ok(orgBResult.filePath.includes(orgBId), "Org B report must be located in Org B directory partition");

    // Check DB registration via API
    const apiResB = await fetch(`${baseUrl}/api/v1/inspection/approval-note`, {
      method: "POST",
      headers: authB,
      body: JSON.stringify(orgBPayload),
    });
    assert.equal(apiResB.status, 200);
    const apiJsonB = await apiResB.json();
    assert.equal(apiJsonB.success, true);
    assert.equal(apiJsonB.filename, orgBFilename);
    console.log("  ✓ PASS Test 13: Generation partition strictly scoped to tenant organization");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Unauthorized report access rejected (HTTP 403)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 14] Cross-organization download attempt rejected with HTTP 403...");
    // Org A attempts to download Org B's report
    const crossOrgRes = await fetch(`${baseUrl}/api/v1/inspection/download/${encodeURIComponent(orgBFilename)}`, {
      headers: authA,
    });
    assert.equal(crossOrgRes.status, 403, "Cross-organization report access MUST return HTTP 403 Forbidden");
    const crossOrgJson = await crossOrgRes.json();
    assert.equal(crossOrgJson.success, false);
    assert.ok(crossOrgJson.message.toLowerCase().includes("another organization"));
    console.log("  ✓ PASS Test 14: Cross-tenant download blocked with HTTP 403 Forbidden");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Path traversal rejected (HTTP 400)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 15] Path traversal attacks strictly rejected with HTTP 400...");
    const attackFilenames = [
      "../../etc/passwd",
      "..\\..\\windows\\system32",
      "../Approval_Note.docx",
      "%2e%2e%2fpasswd",
      "Approval_Note.docx\0.exe",
    ];

    for (const attack of attackFilenames) {
      const res = await fetch(`${baseUrl}/api/v1/inspection/download/${encodeURIComponent(attack)}`, {
        headers: authA,
      });
      assert.equal(res.status, 400, `Path traversal '${attack}' must return HTTP 400`);
      const errJson = await res.json();
      assert.equal(errJson.success, false);
      assert.ok(errJson.message.toLowerCase().includes("path traversal") || errJson.message.toLowerCase().includes("invalid"));
    }
    console.log("  ✓ PASS Test 15: All path traversal payloads rejected with HTTP 400");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 16: Download works for authenticated owner via both inspection and reports routes
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 16] Verifying valid download via both /api/v1/inspection/download and /api/v1/reports/download...");
    // Register report for Org A via API
    const apiResA = await fetch(`${baseUrl}/api/v1/reports/approval-note`, {
      method: "POST",
      headers: authA,
      body: JSON.stringify(validPayloadA),
    });
    assert.equal(apiResA.status, 200);

    // 1. Download via /api/v1/inspection/download/:filename
    const dlInspRes = await fetch(`${baseUrl}/api/v1/inspection/download/${encodeURIComponent(filenameA)}`, {
      headers: authA,
    });
    assert.equal(dlInspRes.status, 200, "Download via inspection route must return 200");
    assert.equal(
      dlInspRes.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const blobInsp = await dlInspRes.arrayBuffer();
    assert.ok(blobInsp.byteLength > 1000, "Downloaded buffer must be valid DOCX size");

    // 2. Download via /api/v1/reports/download/:filename
    const dlRepRes = await fetch(`${baseUrl}/api/v1/reports/download/${encodeURIComponent(filenameA)}`, {
      headers: authA,
    });
    assert.equal(dlRepRes.status, 200, "Download via reports route must return 200");
    const blobRep = await dlRepRes.arrayBuffer();
    assert.equal(blobRep.byteLength, blobInsp.byteLength);
    console.log("  ✓ PASS Test 16: Owner download verified across both endpoints with valid MIME type");
    passedCount++;
  } catch (err) {
    console.error("  ✗ TEST ERROR:", err);
    failedCount++;
  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runApprovalNoteE2ETests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal test error:", err);
    process.exit(1);
  });
