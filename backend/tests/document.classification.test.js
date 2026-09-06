import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import {
  resolveUploadDocumentType,
  matchesFilter,
  getCanonicalDocumentType,
  getDisplayDocumentType,
} from "../../frontend/src/pages/Documents/documentClassification.js";

const QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333";

async function getQdrantPointsForDoc(documentId) {
  const res = await fetch(`${QDRANT_URL}/collections/documents/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: {
        must: [{ key: "documentId", match: { value: documentId } }],
      },
      limit: 10,
      with_payload: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Qdrant scroll failed with status ${res.status}`);
  }
  const data = await res.json();
  return data.result?.points || [];
}

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

async function runTests() {
  console.log("==================================================");
  console.log("   SOVEREIGNAI — DOCUMENT CLASSIFICATION TESTS    ");
  console.log("==================================================\n");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedCount = 0;
  let failedCount = 0;

  try {
    // Authenticate demo user
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.DEMO_USER_EMAIL || "engineer@example.com",
        password: process.env.DEMO_USER_PASSWORD || "DemoPassword123!",
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    assert.ok(token, "Login must succeed and return a token");
    const authHeaders = { Authorization: `Bearer ${token}` };
    const orgId = loginData.data?.user?.organizationId;

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 1: Upload with documentType = "sop"
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1] Upload with documentType='sop'...");
    try {
      const pdfSop = buildMinimalPdf([
        "STANDARD OPERATING PROCEDURE: CENTRIFUGAL COMPRESSOR",
        "Section 1: Operating Limit Pressure: max 45 bar.",
        "Section 2: Lube oil pressure must remain between 2.5 and 3.5 bar.",
      ]);
      const form1 = new FormData();
      form1.append("document", new Blob([pdfSop], { type: "application/pdf" }), "Compressor_SOP_Doc.pdf");
      form1.append("documentType", "sop");

      const res1 = await fetch(`${baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: authHeaders,
        body: form1,
      });
      assert.equal(res1.status, 200, "Upload with documentType=sop must return 200");
      const data1 = await res1.json();
      assert.equal(data1.success, true);
      assert.equal(data1.documentType, "sop", "API response documentType must be 'sop'");

      // Verify PostgreSQL
      const pg1 = await query("SELECT document_type FROM documents WHERE id = $1", [data1.documentId]);
      assert.equal(pg1.rows.length, 1);
      assert.equal(pg1.rows[0].document_type, "sop", "PostgreSQL document_type must be 'sop'");

      // Verify Qdrant points
      const qdrantPoints1 = await getQdrantPointsForDoc(data1.documentId);
      assert.ok(qdrantPoints1.length > 0, "Qdrant points must be indexed");
      for (const pt of qdrantPoints1) {
        assert.equal(pt.payload.documentType, "sop", "Qdrant payload.documentType must be 'sop'");
      }
      console.log(`  ✓ PASS Test 1: PostgreSQL='${pg1.rows[0].document_type}', API='${data1.documentType}', Qdrant='${qdrantPoints1[0].payload.documentType}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 1:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 2: Upload with documentType = "inspection"
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 2] Upload with documentType='inspection'...");
    try {
      const pdfInsp = buildMinimalPdf([
        "ANNUAL INSPECTION REPORT - CRUDE DISTILLATION UNIT 2",
        "Finding: Minor corrosion observed at discharge pipe flange.",
        "Severity: Medium. Wall thickness reduction: 0.8 mm.",
      ]);
      const form2 = new FormData();
      form2.append("document", new Blob([pdfInsp], { type: "application/pdf" }), "CDU2_Inspection_2026.pdf");
      form2.append("documentType", "inspection");

      const res2 = await fetch(`${baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: authHeaders,
        body: form2,
      });
      assert.equal(res2.status, 200, "Upload with documentType=inspection must return 200");
      const data2 = await res2.json();
      assert.equal(data2.success, true);
      assert.equal(data2.documentType, "inspection", "API response documentType must be 'inspection'");

      // Verify PostgreSQL
      const pg2 = await query("SELECT document_type FROM documents WHERE id = $1", [data2.documentId]);
      assert.equal(pg2.rows.length, 1);
      assert.equal(pg2.rows[0].document_type, "inspection", "PostgreSQL document_type must be 'inspection'");

      // Verify Qdrant points
      const qdrantPoints2 = await getQdrantPointsForDoc(data2.documentId);
      assert.ok(qdrantPoints2.length > 0, "Qdrant points must be indexed");
      for (const pt of qdrantPoints2) {
        assert.equal(pt.payload.documentType, "inspection", "Qdrant payload.documentType must be 'inspection'");
      }
      console.log(`  ✓ PASS Test 2: PostgreSQL='${pg2.rows[0].document_type}', API='${data2.documentType}', Qdrant='${qdrantPoints2[0].payload.documentType}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 2:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 3: Upload with documentType = "other"
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Upload with documentType='other'...");
    try {
      const pdfOther = buildMinimalPdf([
        "TECHNICAL SPECIFICATION & DATASHEET",
        "Vendor: Siemens Energy. Model: SGT-400 Gas Turbine.",
        "Output: 12.9 MW. Fuel: Pipeline natural gas.",
      ]);
      const form3 = new FormData();
      form3.append("document", new Blob([pdfOther], { type: "application/pdf" }), "Turbine_Datasheet.pdf");
      form3.append("documentType", "other");

      const res3 = await fetch(`${baseUrl}/api/v1/documents`, {
        method: "POST",
        headers: authHeaders,
        body: form3,
      });
      assert.equal(res3.status, 200, "Upload with documentType=other must return 200");
      const data3 = await res3.json();
      assert.equal(data3.success, true);
      assert.equal(data3.documentType, "other", "API response documentType must be 'other'");

      // Verify PostgreSQL
      const pg3 = await query("SELECT document_type FROM documents WHERE id = $1", [data3.documentId]);
      assert.equal(pg3.rows.length, 1);
      assert.equal(pg3.rows[0].document_type, "other", "PostgreSQL document_type must be 'other'");

      // Verify Qdrant points
      const qdrantPoints3 = await getQdrantPointsForDoc(data3.documentId);
      assert.ok(qdrantPoints3.length > 0, "Qdrant points must be indexed");
      for (const pt of qdrantPoints3) {
        assert.equal(pt.payload.documentType, "other", "Qdrant payload.documentType must be 'other'");
      }
      console.log(`  ✓ PASS Test 3: PostgreSQL='${pg3.rows[0].document_type}', API='${data3.documentType}', Qdrant='${qdrantPoints3[0].payload.documentType}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 3:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 4: Invalid documentType
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Invalid documentType rejection...");
    try {
      const invalidTypes = ["random", "pdf", "knowledge", "SOPs", "inspection-report"];
      for (const badType of invalidTypes) {
        const badForm = new FormData();
        badForm.append("document", new Blob([buildMinimalPdf(["Test"])], { type: "application/pdf" }), "bad.pdf");
        badForm.append("documentType", badType);

        const badRes = await fetch(`${baseUrl}/api/v1/documents`, {
          method: "POST",
          headers: authHeaders,
          body: badForm,
        });
        assert.equal(badRes.status, 400, `Invalid documentType '${badType}' must be rejected with 400`);
        const badData = await badRes.json();
        assert.equal(badData.success, false);
      }
      console.log("  ✓ PASS Test 4: All invalid documentType values rejected with HTTP 400");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 4:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 5: GET /api/v1/documents returns documentType
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] GET /api/v1/documents includes documentType...");
    try {
      const listRes = await fetch(`${baseUrl}/api/v1/documents`, { headers: authHeaders });
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.equal(listData.success, true);
      assert.ok(Array.isArray(listData.documents));
      for (const doc of listData.documents) {
        assert.ok("documentType" in doc, "Every document in GET /api/v1/documents must include 'documentType' field");
      }
      console.log(`  ✓ PASS Test 5: GET /api/v1/documents successfully returns documentType for all ${listData.documents.length} records`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 5:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // BACKEND TEST 6: GET /api/v1/documents/:id returns documentType
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] GET /api/v1/documents/:id includes documentType...");
    try {
      // Find a document from DB
      const sampleDoc = (await query("SELECT id FROM documents LIMIT 1")).rows[0];
      const getRes = await fetch(`${baseUrl}/api/v1/documents/${sampleDoc.id}`, { headers: authHeaders });
      assert.equal(getRes.status, 200);
      const getData = await getRes.json();
      assert.equal(getData.success, true);
      assert.ok("documentType" in getData.document, "Document from GET /api/v1/documents/:id must include 'documentType'");
      console.log(`  ✓ PASS Test 6: GET /api/v1/documents/:id returned documentType='${getData.document.documentType}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 6:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // FRONTEND TEST 7: SOP tab upload sends documentType = "sop"
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] SOP tab upload sends documentType='sop'...");
    try {
      const typeForSopTab = resolveUploadDocumentType("SOPs");
      assert.equal(typeForSopTab, "sop", "SOPs tab must resolve to canonical 'sop'");
      console.log("  ✓ PASS Test 7: SOPs tab upload resolves to documentType='sop'");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 7:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // FRONTEND TEST 8: Inspection tab upload sends documentType = "inspection"
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Inspection tab upload sends documentType='inspection'...");
    try {
      const typeForInspTab = resolveUploadDocumentType("Inspection Reports");
      assert.equal(typeForInspTab, "inspection", "Inspection Reports tab must resolve to canonical 'inspection'");
      console.log("  ✓ PASS Test 8: Inspection Reports tab upload resolves to documentType='inspection'");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 8:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // FRONTEND TEST 9: Other tab upload sends documentType = "other"
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Other tab upload sends documentType='other'...");
    try {
      const typeForOtherTab = resolveUploadDocumentType("Other");
      assert.equal(typeForOtherTab, "other", "Other tab must resolve to canonical 'other'");
      console.log("  ✓ PASS Test 9: Other tab upload resolves to documentType='other'");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 9:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // FRONTEND TEST 10: Document { documentType: "sop", filename: "Centrifugal_Compressor_Guide.pdf" } appears under SOPs
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10] Document with documentType='sop' and non-SOP filename appears under SOPs...");
    try {
      const doc = {
        documentType: "sop",
        filename: "Centrifugal_Compressor_Guide.pdf",
        originalFilename: "Centrifugal_Compressor_Guide.pdf",
      };
      const canonical = getCanonicalDocumentType(doc);
      assert.equal(canonical, "sop", "Canonical type must be 'sop'");
      assert.ok(["SOP", "SOPs / Knowledge Base"].includes(getDisplayDocumentType(doc)), "Display type must be 'SOP' or 'SOPs / Knowledge Base'");

      assert.equal(matchesFilter(doc, "All"), true, "Must appear in 'All'");
      assert.equal(matchesFilter(doc, "SOPs"), true, "Must appear under 'SOPs'");
      assert.equal(matchesFilter(doc, "SOPs / Knowledge Base"), true, "Must appear under 'SOPs / Knowledge Base'");
      assert.equal(matchesFilter(doc, "Inspection Reports"), false, "Must NOT appear under 'Inspection Reports'");
      assert.equal(matchesFilter(doc, "Other"), false, "Must NOT appear under 'Other'");
      console.log("  ✓ PASS Test 10: Document with documentType='sop' correctly appears under SOPs even if filename lacks 'sop'");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 10:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // FRONTEND TEST 11: Document { documentType: "inspection", filename: "Maintenance_SOP.pdf" } does NOT appear under SOPs
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 11] Authoritative metadata wins: documentType='inspection' with 'Maintenance_SOP.pdf' must NOT appear under SOPs...");
    try {
      const doc = {
        documentType: "inspection",
        filename: "Maintenance_SOP.pdf",
        originalFilename: "Maintenance_SOP.pdf",
      };
      const canonical = getCanonicalDocumentType(doc);
      assert.equal(canonical, "inspection", "Canonical type must strictly be 'inspection' from authoritative metadata");
      assert.ok(["Inspection Report", "Inspection Reports"].includes(getDisplayDocumentType(doc)), "Display type must be 'Inspection Report(s)'");

      assert.equal(matchesFilter(doc, "All"), true, "Must appear in 'All'");
      assert.equal(matchesFilter(doc, "SOPs"), false, "Must NOT appear under 'SOPs'");
      assert.equal(matchesFilter(doc, "SOPs / Knowledge Base"), false, "Must NOT appear under 'SOPs / Knowledge Base'");
      assert.equal(matchesFilter(doc, "Inspection Reports"), true, "Must appear under 'Inspection Reports'");
      assert.equal(matchesFilter(doc, "Other"), false, "Must NOT appear under 'Other'");
      console.log("  ✓ PASS Test 11: Authoritative metadata successfully overrides misleading filename!");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 11:", err.message);
      failedCount++;
    }

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log("==================================================\n");

    if (failedCount > 0) {
      process.exit(1);
    }
    process.exit(0);
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Unexpected test error:", err);
  process.exit(1);
});
