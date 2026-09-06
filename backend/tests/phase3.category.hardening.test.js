import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";
import {
  resolveUploadDocumentType,
  matchesFilter,
  getCanonicalDocumentType,
  getDisplayDocumentType,
  inferDocumentType,
} from "../../frontend/src/pages/Documents/documentClassification.js";

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

async function runPhase3Tests() {
  console.log("==================================================");
  console.log("   SOVEREIGNAI — PHASE 3 CATEGORY TEST MATRIX     ");
  console.log("==================================================\n");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedCount = 0;
  let failedCount = 0;

  try {
    // ── Setup Organizations & Users ─────────────────────────────
    const orgAId = `org_a_${randomUUID().slice(0, 8)}`;
    const orgBId = `org_b_${randomUUID().slice(0, 8)}`;
    const orgCId = `org_c_${randomUUID().slice(0, 8)}`; // Empty org for empty state tests

    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [orgAId, `Org Alpha ${orgAId}`]);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [orgBId, `Org Beta ${orgBId}`]);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [orgCId, `Org Empty ${orgCId}`]);

    const tokenA = generateToken({ userId: `user_${orgAId}`, organizationId: orgAId, email: "alpha@example.com", role: "admin" });
    const tokenB = generateToken({ userId: `user_${orgBId}`, organizationId: orgBId, email: "beta@example.com", role: "admin" });
    const tokenC = generateToken({ userId: `user_${orgCId}`, organizationId: orgCId, email: "empty@example.com", role: "admin" });

    const authA = { Authorization: `Bearer ${tokenA}` };
    const authB = { Authorization: `Bearer ${tokenB}` };
    const authC = { Authorization: `Bearer ${tokenC}` };

    // Upload an SOP for Org A
    const pdfSopA = buildMinimalPdf(["ORG A SOP: Emergency shutdown protocol."]);
    const formSopA = new FormData();
    formSopA.append("document", new Blob([pdfSopA], { type: "application/pdf" }), "OrgA_Emergency_SOP.pdf");
    formSopA.append("documentType", "sop");
    const resSopA = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: authA, body: formSopA });
    assert.equal(resSopA.status, 200);
    const dataSopA = await resSopA.json();

    // Upload an Inspection for Org A
    const pdfInspA = buildMinimalPdf(["ORG A INSPECTION: Heat exchanger fouling observed."]);
    const formInspA = new FormData();
    formInspA.append("document", new Blob([pdfInspA], { type: "application/pdf" }), "OrgA_Exchanger_Report.pdf");
    formInspA.append("documentType", "inspection");
    const resInspA = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: authA, body: formInspA });
    assert.equal(resInspA.status, 200);
    const dataInspA = await resInspA.json();

    // Upload an Other document for Org A
    const pdfOtherA = buildMinimalPdf(["ORG A OTHER: Valve specification sheet."]);
    const formOtherA = new FormData();
    formOtherA.append("document", new Blob([pdfOtherA], { type: "application/pdf" }), "OrgA_Valve_Spec.pdf");
    formOtherA.append("documentType", "other");
    const resOtherA = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: authA, body: formOtherA });
    assert.equal(resOtherA.status, 200);
    const dataOtherA = await resOtherA.json();

    // Insert a legacy NULL document for Org A directly in DB
    const legacyDocId = `legacy_${randomUUID()}`;
    await query(
      `INSERT INTO documents (id, organization_id, filename, original_filename, document_type, status, chunks_stored, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'Indexed', 1, NOW(), NOW())`,
      [legacyDocId, orgAId, `${legacyDocId}.pdf`, "Old_Maintenance_SOP.pdf"]
    );

    // Upload an SOP for Org B (to test isolation)
    const pdfSopB = buildMinimalPdf(["ORG B CONFIDENTIAL SOP: Pipeline purging guide."]);
    const formSopB = new FormData();
    formSopB.append("document", new Blob([pdfSopB], { type: "application/pdf" }), "OrgB_Purging_SOP.pdf");
    formSopB.append("documentType", "sop");
    const resSopB = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: authB, body: formSopB });
    assert.equal(resSopB.status, 200);
    const dataSopB = await resSopB.json();

    // Upload an Inspection for Org B
    const pdfInspB = buildMinimalPdf(["ORG B CONFIDENTIAL INSPECTION: Reactor vessel crack."]);
    const formInspB = new FormData();
    formInspB.append("document", new Blob([pdfInspB], { type: "application/pdf" }), "OrgB_Reactor_Report.pdf");
    formInspB.append("documentType", "inspection");
    const resInspB = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: authB, body: formInspB });
    assert.equal(resInspB.status, 200);
    const dataInspB = await resInspB.json();

    // ─────────────────────────────────────────────────────────────
    // TEST 1: GET all documents
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1] GET /api/v1/documents (all documents for Org A)...");
    try {
      const res = await fetch(`${baseUrl}/api/v1/documents`, { headers: authA });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.documents));
      assert.equal(data.documents.length, 4, "Org A should have exactly 4 documents (3 uploaded + 1 legacy)");
      const ids = data.documents.map((d) => d.documentId);
      assert.ok(ids.includes(dataSopA.documentId));
      assert.ok(ids.includes(dataInspA.documentId));
      assert.ok(ids.includes(dataOtherA.documentId));
      assert.ok(ids.includes(legacyDocId));
      console.log(`  ✓ PASS Test 1: Returned all ${data.documents.length} documents for Org A`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 1:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 2: GET documentType=sop
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 2] GET /api/v1/documents?documentType=sop...");
    try {
      const res = await fetch(`${baseUrl}/api/v1/documents?documentType=sop`, { headers: authA });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.documents));
      assert.equal(data.documents.length, 1, "Only 1 SOP document was explicitly tagged for Org A");
      assert.equal(data.documents[0].documentId, dataSopA.documentId);
      assert.equal(data.documents[0].documentType, "sop");
      console.log(`  ✓ PASS Test 2: Filtered strictly to SOP documents: '${data.documents[0].originalFilename}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 2:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: GET documentType=inspection
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 3] GET /api/v1/documents?documentType=inspection...");
    try {
      const res = await fetch(`${baseUrl}/api/v1/documents?documentType=inspection`, { headers: authA });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.documents));
      assert.equal(data.documents.length, 1, "Only 1 inspection document was explicitly tagged for Org A");
      assert.equal(data.documents[0].documentId, dataInspA.documentId);
      assert.equal(data.documents[0].documentType, "inspection");
      console.log(`  ✓ PASS Test 3: Filtered strictly to inspection documents: '${data.documents[0].originalFilename}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 3:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 4: GET documentType=other
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] GET /api/v1/documents?documentType=other...");
    try {
      const res = await fetch(`${baseUrl}/api/v1/documents?documentType=other`, { headers: authA });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(Array.isArray(data.documents));
      assert.equal(data.documents.length, 1, "Only 1 other document was explicitly tagged for Org A");
      assert.equal(data.documents[0].documentId, dataOtherA.documentId);
      assert.equal(data.documents[0].documentType, "other");
      console.log(`  ✓ PASS Test 4: Filtered strictly to other documents: '${data.documents[0].originalFilename}'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 4:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Invalid documentType
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Invalid documentType parameter rejection...");
    try {
      const badQuery = "unsupported_type";
      const res = await fetch(`${baseUrl}/api/v1/documents?documentType=${badQuery}`, { headers: authA });
      assert.equal(res.status, 400, "Invalid documentType must return 400");
      const data = await res.json();
      assert.equal(data.success, false);
      assert.ok(data.message.includes("Invalid documentType"));
      console.log("  ✓ PASS Test 5: Invalid documentType returned HTTP 400 with helpful error message");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 5:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Legacy document with documentType=NULL
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Legacy document with document_type=NULL...");
    try {
      const res = await fetch(`${baseUrl}/api/v1/documents`, { headers: authA });
      const data = await res.json();
      const legacyDoc = data.documents.find((d) => d.documentId === legacyDocId);
      assert.ok(legacyDoc, "Legacy document must be present in GET /api/v1/documents");
      assert.strictEqual(legacyDoc.documentType, null, "Legacy record documentType must be strictly null");
      console.log("  ✓ PASS Test 6: Legacy document returns documentType=null without breaking API");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 6:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Explicit SOP metadata overrides filename
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Explicit SOP metadata overrides filename...");
    try {
      const doc = {
        documentType: "sop",
        filename: "Maintenance_Inspection_Report.pdf",
        originalFilename: "Maintenance_Inspection_Report.pdf",
      };
      assert.equal(getCanonicalDocumentType(doc), "sop");
      assert.equal(getDisplayDocumentType(doc), "SOPs / Knowledge Base");
      assert.equal(matchesFilter(doc, "SOPs / Knowledge Base"), true);
      assert.equal(matchesFilter(doc, "Inspection Reports"), false);
      console.log("  ✓ PASS Test 7: Explicit SOP metadata overrides 'Inspection_Report' in filename");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 7:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Explicit inspection metadata overrides misleading filename
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Explicit inspection metadata overrides misleading filename...");
    try {
      const doc = {
        documentType: "inspection",
        filename: "Maintenance_SOP.pdf",
        originalFilename: "Maintenance_SOP.pdf",
      };
      assert.equal(getCanonicalDocumentType(doc), "inspection");
      assert.equal(getDisplayDocumentType(doc), "Inspection Reports");
      assert.equal(matchesFilter(doc, "Inspection Reports"), true);
      assert.equal(matchesFilter(doc, "SOPs / Knowledge Base"), false);
      console.log("  ✓ PASS Test 8: Explicit inspection metadata overrides 'SOP' in filename");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 8:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Legacy filename fallback
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Legacy filename fallback when documentType=null...");
    try {
      const doc = {
        documentType: null,
        filename: "Old_Maintenance_SOP.pdf",
        originalFilename: "Old_Maintenance_SOP.pdf",
      };
      assert.equal(getCanonicalDocumentType(doc), "sop");
      assert.equal(getDisplayDocumentType(doc), "SOPs / Knowledge Base");
      assert.equal(matchesFilter(doc, "SOPs / Knowledge Base"), true);
      assert.equal(matchesFilter(doc, "Inspection Reports"), false);
      console.log("  ✓ PASS Test 9: Legacy document with null documentType safely infers SOP from filename");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 9:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 10: SOP organization isolation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10] SOP organization isolation (Org A vs Org B)...");
    try {
      // Query Org A for SOPs
      const resA = await fetch(`${baseUrl}/api/v1/documents?documentType=sop`, { headers: authA });
      const dataA = await resA.json();
      const sopIdsA = dataA.documents.map((d) => d.documentId);
      assert.ok(sopIdsA.includes(dataSopA.documentId), "Org A must see Org A SOP");
      assert.ok(!sopIdsA.includes(dataSopB.documentId), "Org A must NEVER see Org B SOP");

      // Query Org B for SOPs
      const resB = await fetch(`${baseUrl}/api/v1/documents?documentType=sop`, { headers: authB });
      const dataB = await resB.json();
      const sopIdsB = dataB.documents.map((d) => d.documentId);
      assert.ok(sopIdsB.includes(dataSopB.documentId), "Org B must see Org B SOP");
      assert.ok(!sopIdsB.includes(dataSopA.documentId), "Org B must NEVER see Org A SOP");

      console.log("  ✓ PASS Test 10: Complete tenant isolation on SOP documents verified");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 10:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Inspection organization isolation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 11] Inspection organization isolation (Org A vs Org B)...");
    try {
      const resA = await fetch(`${baseUrl}/api/v1/documents?documentType=inspection`, { headers: authA });
      const dataA = await resA.json();
      const inspIdsA = dataA.documents.map((d) => d.documentId);
      assert.ok(inspIdsA.includes(dataInspA.documentId), "Org A must see Org A inspection");
      assert.ok(!inspIdsA.includes(dataInspB.documentId), "Org A must NEVER see Org B inspection");

      const resB = await fetch(`${baseUrl}/api/v1/documents?documentType=inspection`, { headers: authB });
      const dataB = await resB.json();
      const inspIdsB = dataB.documents.map((d) => d.documentId);
      assert.ok(inspIdsB.includes(dataInspB.documentId), "Org B must see Org B inspection");
      assert.ok(!inspIdsB.includes(dataInspA.documentId), "Org B must NEVER see Org A inspection");

      console.log("  ✓ PASS Test 11: Complete tenant isolation on inspection documents verified");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 11:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 12: SOP retrieval isolation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 12] Qdrant SOP search strictly enforces documentType='sop'...");
    try {
      const sopResults = await searchSop("protocol", {
        organizationId: orgAId,
        limit: 10,
        scoreThreshold: 0.1,
      });
      assert.ok(sopResults.length > 0, "Should retrieve indexed Org A SOP chunks");
      for (const chunk of sopResults) {
        assert.equal(chunk.documentType, "sop", "Retrieved chunk must strictly have documentType='sop'");
        assert.equal(chunk.organizationId, orgAId, "Retrieved chunk must strictly belong to Org A");
      }
      console.log(`  ✓ PASS Test 12: searchSop strictly returned ${sopResults.length} chunk(s) with documentType='sop'`);
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 12:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Browser refresh
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 13] Browser refresh persistence for new SOP...");
    try {
      // First fetch
      const resInitial = await fetch(`${baseUrl}/api/v1/documents`, { headers: authA });
      const dataInitial = await resInitial.json();
      const docInitial = dataInitial.documents.find((d) => d.documentId === dataSopA.documentId);
      assert.ok(docInitial);
      assert.equal(docInitial.documentType, "sop");
      assert.equal(matchesFilter(docInitial, "SOPs / Knowledge Base"), true);

      // Simulating page refresh by re-fetching from the database API
      const resRefresh = await fetch(`${baseUrl}/api/v1/documents`, { headers: authA });
      const dataRefresh = await resRefresh.json();
      const docRefresh = dataRefresh.documents.find((d) => d.documentId === dataSopA.documentId);
      assert.ok(docRefresh, "Document must remain present after refresh");
      assert.equal(docRefresh.documentType, "sop", "documentType must remain 'sop'");
      assert.equal(matchesFilter(docRefresh, "SOPs / Knowledge Base"), true, "Must remain visible under SOPs filter");

      console.log("  ✓ PASS Test 13: SOP document state persists across refresh via PostgreSQL source-of-truth");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 13:", err.message);
      failedCount++;
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Empty SOP category
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 14] Empty category behavior (Org C with 0 documents)...");
    try {
      // 1. API query for empty org SOPs
      const resEmptyApi = await fetch(`${baseUrl}/api/v1/documents?documentType=sop`, { headers: authC });
      assert.equal(resEmptyApi.status, 200);
      const dataEmptyApi = await resEmptyApi.json();
      assert.equal(dataEmptyApi.success, true);
      assert.deepEqual(dataEmptyApi.documents, [], "API must return empty array when category has no documents");

      // 2. Frontend filtering behavior on empty list
      const emptyDocList = [];
      const filteredEmptySops = emptyDocList.filter((d) => matchesFilter(d, "SOPs / Knowledge Base"));
      assert.equal(filteredEmptySops.length, 0);

      // 3. Frontend filtering on list with only inspection reports (no SOPs)
      const inspectionOnlyList = [dataInspA];
      const filteredNoSops = inspectionOnlyList.filter((d) => matchesFilter(d, "SOPs / Knowledge Base"));
      assert.equal(filteredNoSops.length, 0, "Inspection report must not show up in SOP category");

      console.log("  ✓ PASS Test 14: Empty category returns clean empty state without crash or misclassification");
      passedCount++;
    } catch (err) {
      console.error("  ✗ FAIL Test 14:", err.message);
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

runPhase3Tests().catch((err) => {
  console.error("Unexpected error in Phase 3 tests:", err);
  process.exit(1);
});
