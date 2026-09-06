import assert from "node:assert/strict";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

import { query } from "../src/config/db.js";
import {
  matchesFilter,
  getCanonicalDocumentType,
  getDisplayDocumentType,
} from "../../frontend/src/pages/Documents/documentClassification.js";

const BACKEND_URL = "http://127.0.0.1:9000";
const QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333";

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

async function verifyStep14() {
  console.log("==================================================");
  console.log("     STEP 14 — LIVE END-TO-END VERIFICATION       ");
  console.log("==================================================\n");

  // 1. Authenticate against running backend
  console.log("[1] Authenticating against live backend at " + BACKEND_URL + "...");
  const loginRes = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "engineer@example.com",
      password: "DemoPassword123!",
    }),
  });
  assert.equal(loginRes.status, 200, "Login must succeed");
  const loginData = await loginRes.json();
  const token = loginData.data?.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log("  ✓ Logged in successfully");

  // 2. Upload Test_Maintenance_SOP.pdf with documentType=sop
  console.log("\n[2] Uploading Test_Maintenance_SOP.pdf with documentType=sop...");
  const pdfBytes = buildMinimalPdf([
    "TEST MAINTENANCE STANDARD OPERATING PROCEDURE",
    "Scope: Routine maintenance for high-pressure industrial pumps.",
    "Instruction: Inspect shaft seals every 500 operating hours.",
    "Requirement: Maximum shaft runout tolerance is 0.05 mm.",
  ]);

  const form = new FormData();
  form.append("document", new Blob([pdfBytes], { type: "application/pdf" }), "Test_Maintenance_SOP.pdf");
  form.append("documentType", "sop");

  const uploadRes = await fetch(`${BACKEND_URL}/api/v1/documents`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });
  assert.equal(uploadRes.status, 200, "Upload must return HTTP 200");
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.success, true);
  const uploadedDocId = uploadData.documentId;
  console.log(`  ✓ Document uploaded successfully: ID=${uploadedDocId}`);

  // 3. Verify PostgreSQL
  console.log("\n[3] Verifying PostgreSQL persistence...");
  const pgRes = await query("SELECT id, document_type, original_filename, status FROM documents WHERE id = $1", [uploadedDocId]);
  assert.equal(pgRes.rows.length, 1, "Document record must exist in PostgreSQL");
  const pgRow = pgRes.rows[0];
  assert.equal(pgRow.document_type, "sop", "PostgreSQL document_type must be 'sop'");
  console.log(`  ✓ PostgreSQL document_type: '${pgRow.document_type}'`);

  // 4. Verify API response contract
  console.log("\n[4] Verifying API response contract...");
  assert.equal(uploadData.documentType, "sop", "Upload response documentType must be 'sop'");

  // Verify GET /api/v1/documents
  const getDocsRes = await fetch(`${BACKEND_URL}/api/v1/documents`, { headers: authHeaders });
  assert.equal(getDocsRes.status, 200);
  const getDocsData = await getDocsRes.json();
  const retrievedDoc = getDocsData.documents.find((d) => d.documentId === uploadedDocId);
  assert.ok(retrievedDoc, "Uploaded document must appear in GET /api/v1/documents");
  assert.equal(retrievedDoc.documentType, "sop", "GET /api/v1/documents documentType must be 'sop'");
  console.log(`  ✓ API documentType in GET /api/v1/documents: '${retrievedDoc.documentType}'`);

  // 5. Verify Qdrant payload
  console.log("\n[5] Verifying Qdrant vector store payload...");
  const qdrantRes = await fetch(`${QDRANT_URL}/collections/documents/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: {
        must: [{ key: "documentId", match: { value: uploadedDocId } }],
      },
      limit: 10,
      with_payload: true,
    }),
  });
  assert.equal(qdrantRes.status, 200, "Qdrant scroll must return 200");
  const qdrantData = await qdrantRes.json();
  const points = qdrantData.result?.points || [];
  assert.ok(points.length > 0, "Points must exist in Qdrant for the document");
  for (const pt of points) {
    assert.equal(pt.payload.documentType, "sop", "Every Qdrant chunk payload.documentType must be 'sop'");
  }
  console.log(`  ✓ Verified ${points.length} chunk(s) in Qdrant with payload.documentType='sop'`);

  // 6. Verify Frontend categorization logic
  console.log("\n[6] Verifying Frontend categorization & filtering...");
  const visibleInAll = matchesFilter(retrievedDoc, "All");
  const visibleInSops = matchesFilter(retrievedDoc, "SOPs");
  const visibleInInspection = matchesFilter(retrievedDoc, "Inspection Reports");
  const visibleInOther = matchesFilter(retrievedDoc, "Other");

  assert.equal(visibleInAll, true, "Must be visible in All");
  assert.equal(visibleInSops, true, "Must be visible in SOPs");
  assert.equal(visibleInInspection, false, "Must be HIDDEN in Inspection Reports");
  assert.equal(visibleInOther, false, "Must be HIDDEN in Other");
  console.log("  ✓ Frontend filter behavior:");
  console.log(`    - All: ${visibleInAll ? "VISIBLE" : "HIDDEN"}`);
  console.log(`    - SOPs: ${visibleInSops ? "VISIBLE" : "HIDDEN"}`);
  console.log(`    - Inspection Reports: ${visibleInInspection ? "VISIBLE" : "HIDDEN"}`);
  console.log(`    - Other: ${visibleInOther ? "VISIBLE" : "HIDDEN"}`);

  // 7. Verify browser refresh simulation
  console.log("\n[7] Verifying Browser Refresh Simulation...");
  const refreshRes = await fetch(`${BACKEND_URL}/api/v1/documents`, { headers: authHeaders });
  const refreshData = await refreshRes.json();
  const docAfterRefresh = refreshData.documents.find((d) => d.documentId === uploadedDocId);
  assert.ok(docAfterRefresh, "Document must remain in document list after refresh");
  assert.equal(docAfterRefresh.documentType, "sop");
  assert.equal(matchesFilter(docAfterRefresh, "SOPs"), true, "Must still match SOPs filter after refresh");
  console.log("  ✓ Document persists and remains classified as 'sop' after browser refresh");

  console.log("\n==================================================");
  console.log("  ✅ STEP 14 VERIFICATION COMPLETE: ALL PASSED!   ");
  console.log("==================================================\n");
  process.exit(0);
}

verifyStep14().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
