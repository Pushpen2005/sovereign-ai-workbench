/**
 * SOVEREIGNAI — HOTFIX VERIFICATION: SOP UPLOAD CLASSIFICATION
 *
 * Verifies:
 * 1. Authenticated user uploads reference SOP via multipart upload with documentType="sop"
 * 2. HTTP response returns documentType="sop"
 * 3. PostgreSQL record persists document_type="sop"
 * 4. Qdrant vector payload persists documentType: "sop"
 * 5. GET /api/v1/documents?documentType=sop returns the uploaded SOP
 * 6. GET /api/v1/documents?documentType=other excludes the uploaded SOP
 * 7. POST /api/v1/knowledge/search returns the uploaded SOP with high semantic relevance
 * 8. Operational uploads (inspection, other) retain their respective documentType classifications
 * 9. Existing RAG/SOP retrieval via searchSop() remains completely functional
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes("host.docker.internal")) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace("host.docker.internal", "127.0.0.1");
}

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";

function buildTextPdf(linesPerPage = [[]]) {
  const parts = [];
  const offsets = {};
  let pos = 0;

  function write(str) {
    const b = Buffer.from(str, "latin1");
    parts.push(b);
    pos += b.length;
  }

  const pagesCount = linesPerPage.length;
  write("%PDF-1.4\n");
  offsets[1] = pos;
  write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageObjIds = [];
  let nextObjId = 3;
  const pageData = [];

  for (let i = 0; i < pagesCount; i++) {
    const pageId = nextObjId++;
    const contentId = nextObjId++;
    pageData.push({ pageId, contentId, lines: linesPerPage[i] });
    pageObjIds.push(`${pageId} 0 R`);
  }

  offsets[2] = pos;
  write(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.join(" ")}] /Count ${pagesCount} >>\nendobj\n`);

  for (const item of pageData) {
    offsets[item.pageId] = pos;
    write(`${item.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${item.contentId} 0 R >>\nendobj\n`);

    let stream = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
    for (let j = 0; j < item.lines.length; j++) {
      const escaped = item.lines[j].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      stream += j === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
    }
    stream += "ET\n";

    const streamBytes = Buffer.from(stream, "latin1");
    offsets[item.contentId] = pos;
    write(`${item.contentId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    parts.push(streamBytes);
    pos += streamBytes.length;
    write("\nendstream\nendobj\n");
  }

  const xrefOffset = pos;
  const totalObjs = nextObjId;
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjs; id++) {
    const off = String(offsets[id]).padStart(10, "0");
    write(`${off} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

let server;
let baseUrl;

async function apiUpload(pdfBytes, filename, documentType, token) {
  const form = new FormData();
  form.append("document", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  if (documentType) {
    form.append("documentType", documentType);
  }

  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}/api/v1/documents`, {
    method: "POST",
    headers,
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function apiJson(method, endpoint, body = null, token = null) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const opts = { method, headers };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runHotfixTests() {
  console.log("================================================================");
  console.log("HOTFIX VERIFICATION: SOP UPLOAD CLASSIFICATION & INTEGRITY");
  console.log("================================================================\n");

  await initDb();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  const orgId = `org_hotfix_${randomUUID().slice(0, 8)}`;
  await query(
    "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())",
    [orgId, `Hotfix Test Org ${orgId}`]
  );

  const user = {
    userId: `user_${orgId}`,
    id: randomUUID(),
    email: `hotfix-${Date.now()}@example.com`,
    organizationId: orgId,
    role: "admin",
  };
  const token = generateToken(user);

  let passed = 0;
  let failed = 0;

  async function testStep(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  let uploadedSopDocId = null;
  let uploadedInspectionDocId = null;

  try {
    // 1. Upload Synthetic SOP via Knowledge Base path (documentType = "sop")
    await testStep("1. Authenticate and upload synthetic SOP with documentType='sop'", async () => {
      const sopPdfBuffer = buildTextPdf([
        [
          "SOP-PUMP-08: High Pressure Feedwater Pump Maintenance Guidelines",
          "Section 4.2 Bearing Temperature Thresholds",
          "Normal operating temperature is 65°C to 78°C.",
          "Warning alert triggered at 85°C. Immediate vibration inspection required.",
          "Emergency shutdown required if bearing temperature exceeds 90°C.",
          "Replace lubricating ISO VG 46 synthetic oil immediately upon thermal spike.",
        ],
      ]);

      const res = await apiUpload(
        sopPdfBuffer,
        "SOP-PUMP-08_Feedwater_Maintenance.pdf",
        "sop",
        token
      );

      assert.equal(res.status, 200, `Upload should return 200, got ${res.status}`);
      assert.equal(res.data.success, true);
      assert.equal(res.data.documentType, "sop", `Expected documentType='sop', got '${res.data.documentType}'`);
      assert(res.data.documentId, "Expected documentId to be returned");
      assert(res.data.chunksStored > 0, "Expected chunks to be stored");

      uploadedSopDocId = res.data.documentId;
    });

    // 2. Verify PostgreSQL record
    await testStep("2. Verify PostgreSQL document record persists document_type='sop'", async () => {
      assert(uploadedSopDocId, "SOP docId must exist");
      const result = await query(
        "SELECT id, organization_id, original_filename, document_type, status, chunks_stored FROM documents WHERE id = $1",
        [uploadedSopDocId]
      );
      assert.equal(result.rows.length, 1, "Document record must exist in PostgreSQL");
      const doc = result.rows[0];
      assert.equal(doc.document_type, "sop", `PostgreSQL document_type must be 'sop', got '${doc.document_type}'`);
      assert.equal(doc.organization_id, orgId, "Organization ID must match tenant");
    });

    // 3. Verify Qdrant payload
    await testStep("3. Verify Qdrant payload contains documentType: 'sop'", async () => {
      assert(uploadedSopDocId, "SOP docId must exist");
      const { generateEmbedding } = await import("../../ai-service/embeddings/embedding.service.js");
      const queryVec = await generateEmbedding("bearing temperature threshold emergency shutdown");
      const results = await searchSimilarChunks(
        queryVec,
        3,
        uploadedSopDocId,
        { organizationId: orgId, documentType: "sop" }
      );

      assert(results.length > 0, "Qdrant search must retrieve the uploaded SOP");
      const hit = results.find((r) => r.documentId === uploadedSopDocId);
      assert(hit, "Uploaded SOP chunk must be in retrieval results");
      assert.equal(hit.documentType, "sop", `Qdrant payload documentType must be 'sop', got '${hit.documentType}'`);
      assert(hit.text.includes("SOP-PUMP-08"), "Retrieved chunk text must contain SOP content");
    });

    // 4. Request GET /api/v1/documents?documentType=sop
    await testStep("4. GET /api/v1/documents?documentType=sop returns the uploaded SOP", async () => {
      const res = await apiJson("GET", "/api/v1/documents?documentType=sop", null, token);

      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert(Array.isArray(res.data.documents));
      const found = res.data.documents.find((d) => d.id === uploadedSopDocId || d.documentId === uploadedSopDocId);
      assert(found, "Uploaded SOP must appear under GET /api/v1/documents?documentType=sop");
      assert.equal(found.documentType, "sop");
    });

    // 5. Request GET /api/v1/documents?documentType=other (must NOT include SOP)
    await testStep("5. GET /api/v1/documents?documentType=other excludes the uploaded SOP", async () => {
      const res = await apiJson("GET", "/api/v1/documents?documentType=other", null, token);

      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert(Array.isArray(res.data.documents));
      const found = res.data.documents.find((d) => d.id === uploadedSopDocId || d.documentId === uploadedSopDocId);
      assert(!found, "Uploaded SOP must NOT appear under GET /api/v1/documents?documentType=other");
    });

    // 6. Interactive Knowledge Search
    await testStep("6. POST /api/v1/knowledge/search retrieves the uploaded SOP evidence", async () => {
      const res = await apiJson(
        "POST",
        "/api/v1/knowledge/search",
        {
          query: "What is the emergency shutdown temperature for feedwater pump bearings?",
          topK: 5,
          scoreThreshold: 0.0,
        },
        token
      );

      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert(Array.isArray(res.data.results));
      assert(res.data.results.length > 0, "Should retrieve matching SOP evidence");
      const topResult = res.data.results[0];
      assert.equal(topResult.documentType, "sop");
      assert(topResult.text.includes("exceeds 90°C") || topResult.text.includes("SOP-PUMP-08"));
      assert(typeof topResult.score === "number" && topResult.score > 0, "Score should be a positive number");
    });

    // 7. Verify searchSop() RAG core integration
    await testStep("7. searchSop() helper retrieves the uploaded SOP for finding-driven RAG", async () => {
      const findings = "Pump bearing temperature reached 92°C with high vibration.";
      const sopMatches = await searchSop(findings, { organizationId: orgId, limit: 3, scoreThreshold: 0.0 });
      assert(sopMatches.length > 0, "searchSop must return grounded SOP evidence");
      const top = sopMatches[0];
      assert(top.text.includes("90°C") || top.text.includes("SOP-PUMP-08"));
    });

    // 8. Operational uploads (inspection & other) preserve classification
    await testStep("8. Operational uploads (inspection & other) preserve respective classifications", async () => {
      const inspectionPdf = buildTextPdf([
        [
          "ROUTINE FIELD INSPECTION REPORT",
          "Inspector: J. Doe",
          "Finding: Minor surface rust on support bracket 12-B.",
        ],
      ]);

      const inspRes = await apiUpload(
        inspectionPdf,
        "field_inspection_log.pdf",
        "inspection",
        token
      );

      assert.equal(inspRes.status, 200);
      assert.equal(inspRes.data.documentType, "inspection");
      uploadedInspectionDocId = inspRes.data.documentId;

      // Verify inspection doc in PostgreSQL
      const inspDb = await query("SELECT document_type FROM documents WHERE id = $1", [uploadedInspectionDocId]);
      assert.equal(inspDb.rows[0].document_type, "inspection");

      // Verify other document upload
      const otherPdf = buildTextPdf([
        [
          "GENERAL FACILITY SPECIFICATION",
          "Section 1: General layout of auxiliary generator shed.",
        ],
      ]);

      const otherRes = await apiUpload(
        otherPdf,
        "general_spec.pdf",
        "other",
        token
      );

      assert.equal(otherRes.status, 200);
      assert.equal(otherRes.data.documentType, "other");
      const otherDocId = otherRes.data.documentId;

      const otherDb = await query("SELECT document_type FROM documents WHERE id = $1", [otherDocId]);
      assert.equal(otherDb.rows[0].document_type, "other");
    });

    console.log(`\nResults: ${passed}/${passed + failed} tests passed.`);
    if (failed === 0) {
      console.log("✓ Hotfix verification suite PASSED successfully!\n");
      process.exit(0);
    } else {
      console.error(`✗ ${failed} tests failed in hotfix verification.\n`);
      process.exit(1);
    }
  } finally {
    if (server) server.close();
  }
}

runHotfixTests().catch((err) => {
  console.error("Fatal error during hotfix test execution:", err);
  if (server) server.close();
  process.exit(1);
});
