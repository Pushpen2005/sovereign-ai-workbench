/**
 * Phase 3 — Tenant-Isolated Filesystem & Report Storage Test Suite
 *
 * Validates the 16 mandated physical filesystem and report isolation guarantees:
 *
 * TEST 1: Company A uploads a file -> Exists strictly under Company A storage directory.
 * TEST 2: Company B uploads a file with same filename -> Both coexist independently.
 * TEST 3: Company A attempts to read Company B document -> Denied (403/404).
 * TEST 4: Company A attempts to download Company B document using known ID -> Denied (403/404).
 * TEST 5: Company A attempts to download Company B document using known filename -> Denied (403/404).
 * TEST 6: Company A attempts path traversal -> Denied (400/403).
 * TEST 7: Company A attempts absolute-path access -> Denied (400/403).
 * TEST 8: Company A generates an approval note -> Stored strictly under Company A generated directory.
 * TEST 9: Company B generates same report filename -> Stored under Company B directory without collision.
 * TEST 10: Company A attempts to download Company B report -> Denied (403/404).
 * TEST 11: Agent document_generate under Company A context -> Belongs to Company A.
 * TEST 12: Agent attempts to provide another organization ID -> LLM parameter ignored, uses trusted context.
 * TEST 13: Delete Company A document -> Only Company A physical file and record are removed.
 * TEST 14: Attempt deletion of Company B document from Company A context -> Denied, Company B file untouched.
 * TEST 15: Legacy ambiguous file -> Not exposed through tenant-scoped APIs.
 * TEST 16: Unauthenticated file/download attempt -> 401 Unauthorized.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import {
  UPLOADS_ROOT,
  GENERATED_ROOT,
  getOrganizationUploadDir,
  getOrganizationGeneratedDir,
  getDocumentStoragePath,
  getReportStoragePath,
  validateOrganizationId,
  validateFilename,
  assertPathContained,
} from "../src/utils/storage.js";
import { executeDocumentGenerate } from "../src/services/agentTools/documentGenerate.tool.js";
import { executeFileRead } from "../src/services/agentTools/fileRead.tool.js";

function buildMinimalPdf(lines) {
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
  writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  writeObj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
  );

  let stream = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
  for (let j = 0; j < lines.length; j++) {
    const escaped = lines[j].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    stream += j === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
  }
  stream += "ET\n";

  const streamBytes = Buffer.from(stream, "latin1");
  offsets[4] = pos;
  write(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  parts.push(streamBytes);
  pos += streamBytes.length;
  write("\nendstream\nendobj\n");

  const startXref = pos;
  write(`xref\n0 5\n0000000000 65535 f \n`);
  for (let i = 1; i <= 4; i++) {
    write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function runFilesystemIsolationSuite() {
  console.log("==================================================");
  console.log("Phase 3: Tenant-Isolated Filesystem & Report Storage Suite");
  console.log("==================================================");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];
  const cleanupFiles = [];

  try {
    // Setup Organizations
    const orgAId = randomUUID();
    const orgBId = randomUUID();
    cleanupOrgIds.push(orgAId, orgBId);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAId, `Company Alpha ${orgAId.slice(0, 6)}`]);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBId, `Company Beta ${orgBId.slice(0, 6)}`]);

    const userAId = randomUUID();
    const userBId = randomUUID();
    cleanupUserIds.push(userAId, userBId);

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

    const sharedFilename = "Standard_Equipment_Manual.pdf";
    let docAId = null;
    let docBId = null;
    let filenameA = null;
    let filenameB = null;

    // ----------------------------------------------------
    // TEST 1: Company A uploads a file -> Exists only under Company A directory
    // ----------------------------------------------------
    console.log("\n[TEST 1] Company A uploads a file");
    {
      const pdfBytes = buildMinimalPdf(["Alpha Reactor Specs", "Operating Pressure: 45 bar"]);
      const formData = new FormData();
      formData.append("document", new Blob([pdfBytes], { type: "application/pdf" }), sharedFilename);

      const res = await fetch(`${baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenA}` },
        body: formData,
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Upload failed: ${JSON.stringify(body)}`);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.organizationId, orgAId);

      docAId = body.documentId;
      filenameA = body.filename;
      cleanupDocIds.push(docAId);

      // Check physical filesystem: Must exist in Company A's directory
      const orgAUploadDir = getOrganizationUploadDir(orgAId);
      const orgBUploadDir = getOrganizationUploadDir(orgBId);
      const fileInOrgA = path.join(orgAUploadDir, filenameA);
      const fileInOrgB = path.join(orgBUploadDir, filenameA);
      const fileInRoot = path.join(UPLOADS_ROOT, filenameA);

      assert.strictEqual(fs.existsSync(fileInOrgA), true, "File must physically exist inside Company A upload directory");
      assert.strictEqual(fs.existsSync(fileInOrgB), false, "File must NOT exist inside Company B directory");
      assert.strictEqual(fs.existsSync(fileInRoot), false, "File must NOT exist in flat root uploads directory");

      console.log(`✓ Passed: Uploaded file stored strictly in ${fileInOrgA}`);
    }

    // ----------------------------------------------------
    // TEST 2: Company B uploads a file with same filename -> Coexist independently
    // ----------------------------------------------------
    console.log("\n[TEST 2] Company B uploads a file with the same filename");
    {
      const pdfBytesB = buildMinimalPdf(["Beta Turbine Secrets", "Operating Temp: 950 C"]);
      const formData = new FormData();
      formData.append("document", new Blob([pdfBytesB], { type: "application/pdf" }), sharedFilename);

      const res = await fetch(`${baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenB}` },
        body: formData,
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Upload failed: ${JSON.stringify(body)}`);
      assert.strictEqual(body.organizationId, orgBId);

      docBId = body.documentId;
      filenameB = body.filename;
      cleanupDocIds.push(docBId);

      const orgAUploadDir = getOrganizationUploadDir(orgAId);
      const orgBUploadDir = getOrganizationUploadDir(orgBId);
      const fileInOrgA = path.join(orgAUploadDir, filenameA);
      const fileInOrgB = path.join(orgBUploadDir, filenameB);

      assert.strictEqual(fs.existsSync(fileInOrgA), true, "Company A file still exists");
      assert.strictEqual(fs.existsSync(fileInOrgB), true, "Company B file exists independently");

      console.log(`✓ Passed: Both documents coexist independently in separate tenant directories.`);
    }

    // ----------------------------------------------------
    // TEST 3: Company A attempts to read Company B document
    // ----------------------------------------------------
    console.log("\n[TEST 3] Company A attempts to read Company B document");
    {
      // 3a. Via HTTP GET /api/v1/documents/:id
      const res = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.strictEqual(res.status === 404 || res.status === 403, true, `Expected 404/403, got ${res.status}`);

      // 3b. Via agent file_read tool
      await assert.rejects(
        async () => {
          await executeFileRead({ documentId: docBId }, { organizationId: orgAId });
        },
        /not found|Access Denied|Forbidden/i,
        "Agent file_read tool must reject cross-tenant document read"
      );

      console.log("✓ Passed: Cross-tenant document read rejected.");
    }

    // ----------------------------------------------------
    // TEST 4: Company A attempts to download Company B document using known ID
    // ----------------------------------------------------
    console.log("\n[TEST 4] Company A attempts to download Company B document using known ID");
    {
      const res = await fetch(`${baseUrl}/api/v1/documents/${docBId}/download`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.strictEqual(res.status === 404 || res.status === 403, true, `Expected 404/403, got ${res.status}`);

      console.log("✓ Passed: Download of foreign document ID denied.");
    }

    // ----------------------------------------------------
    // TEST 5: Company A attempts to download Company B document using known filename
    // ----------------------------------------------------
    console.log("\n[TEST 5] Company A attempts to download Company B document using known filename");
    {
      // Check doc B filename in DB
      const bDocRes = await query("SELECT filename FROM documents WHERE id = $1", [docBId]);
      const bFilename = bDocRes.rows[0].filename;

      // Request using Company A token
      const res = await fetch(`${baseUrl}/api/v1/documents/download/${bFilename}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      // If filenames are different, Company A shouldn't find Company B's filename in its tenant scope
      if (bFilename !== sharedFilename) {
        assert.strictEqual(res.status === 404 || res.status === 403, true, `Expected 404/403, got ${res.status}`);
      }

      console.log("✓ Passed: Download of foreign filename denied.");
    }

    // ----------------------------------------------------
    // TEST 6: Company A attempts path traversal
    // ----------------------------------------------------
    console.log("\n[TEST 6] Company A attempts path traversal");
    {
      const traversalPayloads = [
        "../../etc/passwd",
        "..%2f..%2fetc/passwd",
        "%2e%2e/%2e%2e/etc/passwd",
        "....//....//etc/passwd",
        "..\\..\\windows\\win.ini",
      ];

      for (const payload of traversalPayloads) {
        // Via document download
        const res1 = await fetch(`${baseUrl}/api/v1/documents/download/${encodeURIComponent(payload)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.strictEqual(res1.status >= 400, true, `Expected >= 400 for payload ${payload}, got ${res1.status}`);

        // Via inspection download
        const res2 = await fetch(`${baseUrl}/api/v1/inspection/download/${encodeURIComponent(payload)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.strictEqual(res2.status >= 400, true, `Expected >= 400 for payload ${payload}, got ${res2.status}`);

        // Direct utility assertion
        assert.throws(
          () => validateFilename(payload),
          /path traversal/i,
          `validateFilename must reject ${payload}`
        );
      }

      console.log("✓ Passed: All path traversal payloads safely blocked.");
    }

    // ----------------------------------------------------
    // TEST 7: Company A attempts absolute-path access
    // ----------------------------------------------------
    console.log("\n[TEST 7] Company A attempts absolute-path access");
    {
      const absolutePayloads = [
        "/etc/passwd",
        "/var/log/system.log",
        "C:\\Windows\\System32\\calc.exe",
      ];

      for (const payload of absolutePayloads) {
        const res = await fetch(`${baseUrl}/api/v1/documents/download/${encodeURIComponent(payload)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.strictEqual(res.status >= 400, true, `Expected >= 400 for payload ${payload}, got ${res.status}`);

        assert.throws(
          () => validateFilename(payload),
          /path traversal|filename/i,
          `validateFilename must reject ${payload}`
        );
      }

      console.log("✓ Passed: Absolute path access safely blocked.");
    }

    // ----------------------------------------------------
    // TEST 8: Company A generates an approval note -> Stored in Company A generated directory
    // ----------------------------------------------------
    console.log("\n[TEST 8] Company A generates an approval note");
    const testReportFilename = `Approval_Note_Alpha_${randomUUID().slice(0, 8)}.docx`;
    {
      const approvalPayload = {
        filename: testReportFilename,
        subject: "Company A Critical Heat Exchanger Assessment",
        findings: [
          {
            finding: "Wall thinning on exchanger bundle",
            equipment: "Exchanger HX-101",
            severity: "HIGH",
            evidence: "Ultrasonic gauge measured 3.2mm vs 6.0mm spec",
          },
        ],
        riskAssessment: {
          level: "HIGH",
          reason: "Risk of rupture under 25 bar operating pressure",
        },
        technicalAnalysis: "Rapid corrosion due to sour gas exposure.",
        recommendation: "Immediate isolation and bundle retubing.",
        citations: [{ filename: "Standard_Equipment_Manual.pdf", page: 1 }],
      };

      const res = await fetch(`${baseUrl}/api/v1/inspection/approval-note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify(approvalPayload),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Approval note generation failed: ${JSON.stringify(body)}`);
      assert.strictEqual(body.success, true);

      // Verify physical storage
      const orgAGeneratedDir = getOrganizationGeneratedDir(orgAId);
      const orgBGeneratedDir = getOrganizationGeneratedDir(orgBId);
      const reportFileA = path.join(orgAGeneratedDir, body.filename);
      const reportFileB = path.join(orgBGeneratedDir, body.filename);

      assert.strictEqual(fs.existsSync(reportFileA), true, "Report must exist in Company A generated folder");
      assert.strictEqual(fs.existsSync(reportFileB), false, "Report must NOT exist in Company B folder");

      console.log(`✓ Passed: Approval Note stored strictly in ${reportFileA}`);
    }

    // ----------------------------------------------------
    // TEST 9: Company B generates same report filename -> Stored under Company B without collision
    // ----------------------------------------------------
    console.log("\n[TEST 9] Company B generates same report filename without collision");
    {
      const approvalPayloadB = {
        filename: testReportFilename, // Exact same filename
        subject: "Company B Turbine Inspection",
        findings: [
          {
            finding: "Vibration in bearing 2",
            equipment: "Turbine TG-2",
            severity: "MEDIUM",
            evidence: "Amplitude 4.1 mm/s",
          },
        ],
        riskAssessment: {
          level: "MEDIUM",
          reason: "Misalignment suspected",
        },
        technicalAnalysis: "Spectral analysis shows 1X unbalance.",
        recommendation: "Re-align coupling.",
        citations: [{ filename: "Standard_Equipment_Manual.pdf", page: 1 }],
      };

      const res = await fetch(`${baseUrl}/api/v1/inspection/approval-note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenB}`,
        },
        body: JSON.stringify(approvalPayloadB),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Generation failed: ${JSON.stringify(body)}`);

      const orgAGeneratedDir = getOrganizationGeneratedDir(orgAId);
      const orgBGeneratedDir = getOrganizationGeneratedDir(orgBId);
      const reportFileA = path.join(orgAGeneratedDir, testReportFilename);
      const reportFileB = path.join(orgBGeneratedDir, testReportFilename);

      assert.strictEqual(fs.existsSync(reportFileA), true, "Company A report exists intact");
      assert.strictEqual(fs.existsSync(reportFileB), true, "Company B report exists intact in its own directory");

      console.log("✓ Passed: Same report filename coexists independently in Company A and Company B folders.");
    }

    // ----------------------------------------------------
    // TEST 10: Company A attempts to download Company B report
    // ----------------------------------------------------
    console.log("\n[TEST 10] Company A attempts to download Company B report");
    {
      // Create a unique report for Company B
      const uniqueBFilename = `Approval_Note_Confidential_B_${randomUUID().slice(0, 8)}.docx`;
      const genRes = await fetch(`${baseUrl}/api/v1/inspection/approval-note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenB}`,
        },
        body: JSON.stringify({
          filename: uniqueBFilename,
          subject: "Beta Confidential",
          findings: [{ finding: "Secret finding", equipment: "Classified", severity: "HIGH" }],
          riskAssessment: { level: "HIGH", reason: "Critical" },
          technicalAnalysis: "Analysis",
          recommendation: "Fix immediately",
          citations: [{ filename: "Standard_Equipment_Manual.pdf", page: 1 }],
        }),
      });
      assert.strictEqual(genRes.status, 200);

      // Company A attempts to download it
      const downloadRes = await fetch(`${baseUrl}/api/v1/inspection/download/${uniqueBFilename}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      assert.strictEqual(downloadRes.status === 404 || downloadRes.status === 403, true, `Expected 404/403, got ${downloadRes.status}`);

      // Company B can download it successfully
      const authorizedRes = await fetch(`${baseUrl}/api/v1/inspection/download/${uniqueBFilename}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      assert.strictEqual(authorizedRes.status, 200, "Owner Company B must be allowed to download");

      console.log("✓ Passed: Cross-tenant report download denied; owner download succeeded.");
    }

    // ----------------------------------------------------
    // TEST 11: Agent document_generate under Company A context
    // ----------------------------------------------------
    console.log("\n[TEST 11] Agent document_generate under Company A context");
    {
      const agentResult = await executeDocumentGenerate(
        {
          title: "Agent Generated Alpha Assessment",
          sections: [
            { heading: "Background", content: "Agent autonomous inspection for Company Alpha." },
            { heading: "Findings", content: "Pressure relief valve RV-401 seated improperly." },
            { heading: "Risk Assessment", content: "HIGH risk of overpressure during surge." },
            { heading: "Recommendations", content: "Test and recalibrate RV-401 valve." },
          ],
        },
        { organizationId: orgAId, userId: userAId }
      );

      assert.strictEqual(agentResult.status, "Generated");
      assert.ok(agentResult.filename);

      const orgAGeneratedDir = getOrganizationGeneratedDir(orgAId);
      const generatedFilePath = path.join(orgAGeneratedDir, agentResult.filename);
      assert.strictEqual(fs.existsSync(generatedFilePath), true, "Agent output must reside in Company A generated directory");

      console.log(`✓ Passed: Agent document_generate stored in ${generatedFilePath}`);
    }

    // ----------------------------------------------------
    // TEST 12: Agent attempts to provide another organization ID
    // ----------------------------------------------------
    console.log("\n[TEST 12] Agent attempts to provide another organization ID in tool arguments");
    {
      const agentResult = await executeDocumentGenerate(
        {
          organizationId: orgBId, // Spoofed in LLM args
          organization_id: orgBId,
          title: "Agent Spoofing Attempt",
          sections: [
            { heading: "Background", content: "Attempting to write to Company B directory." },
            { heading: "Findings", content: "Finding content." },
          ],
        },
        { organizationId: orgAId, userId: userAId } // Trusted execution context
      );

      // Verify that the file went to Company A, NOT Company B
      const orgAGeneratedDir = getOrganizationGeneratedDir(orgAId);
      const orgBGeneratedDir = getOrganizationGeneratedDir(orgBId);
      const fileInA = path.join(orgAGeneratedDir, agentResult.filename);
      const fileInB = path.join(orgBGeneratedDir, agentResult.filename);

      assert.strictEqual(fs.existsSync(fileInA), true, "Must be written to trusted context (Company A)");
      assert.strictEqual(fs.existsSync(fileInB), false, "Must NOT be written to spoofed organization (Company B)");

      // Check report record in PostgreSQL
      if (agentResult.reportId) {
        const repCheck = await query("SELECT organization_id FROM reports WHERE id = $1", [agentResult.reportId]);
        assert.strictEqual(repCheck.rows[0].organization_id, orgAId, "Report record must be bound to Company A");
      }

      console.log("✓ Passed: LLM-provided organizationId ignored; trusted context enforced.");
    }

    // ----------------------------------------------------
    // TEST 13: Delete Company A document -> Physical file and record removed
    // ----------------------------------------------------
    console.log("\n[TEST 13] Delete Company A document");
    {
      const docARec = await query("SELECT filename FROM documents WHERE id = $1", [docAId]);
      const filenameA = docARec.rows[0].filename;
      const fileAOnDisk = path.join(getOrganizationUploadDir(orgAId), filenameA);
      assert.strictEqual(fs.existsSync(fileAOnDisk), true, "Company A file exists before deletion");

      const delRes = await fetch(`${baseUrl}/api/v1/documents/${docAId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      assert.strictEqual(delRes.status, 200);
      assert.strictEqual(fs.existsSync(fileAOnDisk), false, "Company A physical file must be removed");

      const checkDb = await query("SELECT id FROM documents WHERE id = $1", [docAId]);
      assert.strictEqual(checkDb.rows.length, 0, "Company A DB record must be deleted");

      console.log("✓ Passed: Company A document and physical file safely deleted.");
    }

    // ----------------------------------------------------
    // TEST 14: Attempt deletion of Company B document from Company A context
    // ----------------------------------------------------
    console.log("\n[TEST 14] Attempt deletion of Company B document from Company A context");
    {
      const docBRec = await query("SELECT filename FROM documents WHERE id = $1", [docBId]);
      const filenameB = docBRec.rows[0].filename;
      const fileBOnDisk = path.join(getOrganizationUploadDir(orgBId), filenameB);
      assert.strictEqual(fs.existsSync(fileBOnDisk), true, "Company B file exists before unauthorized deletion attempt");

      const delRes = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tokenA}` },
      });

      assert.strictEqual(delRes.status === 404 || delRes.status === 403, true, `Expected 404/403, got ${delRes.status}`);
      assert.strictEqual(fs.existsSync(fileBOnDisk), true, "Company B physical file must remain intact");

      const checkDbB = await query("SELECT id FROM documents WHERE id = $1", [docBId]);
      assert.strictEqual(checkDbB.rows.length, 1, "Company B DB record must remain intact");

      console.log("✓ Passed: Cross-tenant deletion denied; Company B file and DB record intact.");
    }

    // ----------------------------------------------------
    // TEST 15: Legacy ambiguous file -> Not exposed through tenant-scoped APIs
    // ----------------------------------------------------
    console.log("\n[TEST 15] Legacy ambiguous file quarantine check");
    {
      const ambiguousFilename = `quarantine_test_${randomUUID().slice(0, 8)}.pdf`;
      const ambiguousFilePath = path.join(UPLOADS_ROOT, ambiguousFilename);
      fs.writeFileSync(ambiguousFilePath, "%PDF-1.4\nambiguous unmapped legacy file");
      cleanupFiles.push(ambiguousFilePath);

      // Attempt to download via Company A
      const resDocA = await fetch(`${baseUrl}/api/v1/documents/download/${ambiguousFilename}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      assert.strictEqual(resDocA.status === 404 || resDocA.status === 403, true, "Ambiguous file must be inaccessible to Company A");

      // Attempt to download via Company B
      const resDocB = await fetch(`${baseUrl}/api/v1/documents/download/${ambiguousFilename}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      assert.strictEqual(resDocB.status === 404 || resDocB.status === 403, true, "Ambiguous file must be inaccessible to Company B");

      console.log("✓ Passed: Legacy ambiguous file is quarantined and inaccessible to tenants.");
    }

    // ----------------------------------------------------
    // TEST 16: Unauthenticated file/download attempt
    // ----------------------------------------------------
    console.log("\n[TEST 16] Unauthenticated file/download attempt");
    {
      const res1 = await fetch(`${baseUrl}/api/v1/documents/${docBId}/download`, {
        method: "GET",
      });
      assert.strictEqual(res1.status, 401, `Expected 401 for unauthenticated doc download, got ${res1.status}`);

      const res2 = await fetch(`${baseUrl}/api/v1/inspection/download/some_report.docx`, {
        method: "GET",
      });
      assert.strictEqual(res2.status, 401, `Expected 401 for unauthenticated report download, got ${res2.status}`);

      console.log("✓ Passed: Unauthenticated download attempts rejected with 401.");
    }

    console.log("\n==================================================");
    console.log("ALL 16 PHASE 3 TENANT FILESYSTEM TESTS PASSED!");
    console.log("==================================================");
  } finally {
    server.close();

    // Clean up temporary test files
    for (const f of cleanupFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }

    // Clean up test DB entities and tenant directories
    for (const orgId of cleanupOrgIds) {
      try {
        await query("DELETE FROM reports WHERE organization_id = $1", [orgId]);
        await query("DELETE FROM documents WHERE organization_id = $1", [orgId]);
        await query("DELETE FROM users WHERE organization_id = $1", [orgId]);
        await query("DELETE FROM organizations WHERE id = $1", [orgId]);
        // Clean up tenant directories created during test
        const upDir = path.join(UPLOADS_ROOT, orgId);
        if (fs.existsSync(upDir)) {
          fs.rmSync(upDir, { recursive: true, force: true });
        }
        const genDir = path.join(GENERATED_ROOT, orgId);
        if (fs.existsSync(genDir)) {
          fs.rmSync(genDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }
}

runFilesystemIsolationSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Phase 3 Filesystem Isolation Suite Failed:\n", err);
    process.exit(1);
  });

