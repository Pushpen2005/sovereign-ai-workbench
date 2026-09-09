/**
 * SOVEREIGNAI — PHASE 4: KNOWLEDGE BASE FINAL VERIFICATION & REGRESSION
 *
 * Comprehensive end-to-end test suite verifying the full Knowledge Base lifecycle:
 *  1. Normal PDF text SOP ingestion
 *  2. Scanned PDF / OCR ingestion
 *  3. Document metadata in PostgreSQL (documentType="sop")
 *  4. Page-aware chunking with token offsets
 *  5. Local 384D ONNX embeddings
 *  6. Qdrant point storage and schema
 *  7. Knowledge Base listing (GET /api/v1/documents?documentType=sop)
 *  8. Interactive semantic search (POST /api/v1/knowledge/search)
 *  9. Real Qdrant similarity score preservation
 * 10. Source metadata integrity (filename, page, chunkIndex, extractionMethod)
 * 11. Zero-result safety without hallucinations
 * 12. SOP-only filter enforced at Qdrant level
 * 13. Inspection documents exclusion from KB search
 * 14. Other documents exclusion from KB search
 * 15. Tenant isolation (Org A -> Org B)
 * 16. Tenant isolation (Org B -> Org A)
 * 17. Client spoofing protection
 * 18. Unauthenticated search rejection (401)
 * 19. Unauthenticated upload/delete rejection (401)
 * 20. Tenant-scoped document deletion
 * 21. Physical file cleanup on deletion
 * 22. Qdrant vector cleanup on deletion
 * 23. PostgreSQL cleanup on deletion
 * 24. LangGraph Inspection Agent RAG integration
 * 25. Citation integrity & no-evidence safety
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes("host.docker.internal")) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace("host.docker.internal", "127.0.0.1");
}

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { getAllDocuments } from "../src/services/documents.service.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { assessFindingRisk } from "../../ai-service/risk/risk.service.js";
import { runInspectionAnalysis } from "../src/services/inspection.service.js";

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

  const totalObjs = nextObjId;
  const xrefOffset = pos;
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let i = 1; i < totalObjs; i++) {
    write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

function buildScannedIndustrialPdf(lines = []) {
  const parts = [];
  const offsets = {};
  let pos = 0;

  function write(str) {
    const b = Buffer.from(str, "latin1");
    parts.push(b);
    pos += b.length;
  }
  function writeBytes(b) {
    parts.push(b);
    pos += b.length;
  }

  write("%PDF-1.4\n");
  offsets[1] = pos;
  write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageId = 3;
  const contentId = 4;
  const imgId = 5;

  offsets[2] = pos;
  write(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);

  const canvas = createCanvas(1000, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, 1000, 400);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 26px sans-serif";

  ctx.fillText("INTERNAL INDUSTRIAL STANDARD OPERATING PROCEDURE", 40, 60);
  let y = 120;
  for (const line of lines) {
    ctx.fillText(line, 40, y);
    y += 45;
  }

  const jpegBuffer = canvas.toBuffer("image/jpeg");

  offsets[imgId] = pos;
  write(`${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1000 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuffer.length} >>\nstream\n`);
  writeBytes(jpegBuffer);
  write("\nendstream\nendobj\n");

  const stream = "q 612 0 0 792 0 0 cm /Im1 Do Q\n";
  const streamBytes = Buffer.from(stream, "latin1");

  offsets[contentId] = pos;
  write(`${contentId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  parts.push(streamBytes);
  pos += streamBytes.length;
  write("\nendstream\nendobj\n");

  offsets[pageId] = pos;
  write(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

  const totalObjs = 6;
  const xrefOffset = pos;
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let i = 1; i < totalObjs; i++) {
    write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
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

async function apiJson(method, endpoint, body = null, token = null, headers = {}) {
  const reqHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    reqHeaders["Authorization"] = `Bearer ${token}`;
  }

  const opts = { method, headers: reqHeaders };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

console.log("==================================================");
console.log("PHASE 4: KNOWLEDGE BASE FINAL VERIFICATION & REGRESSION");
console.log("==================================================\n");

let passed = 0;
let total = 0;

async function runTest(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ PASS [Test ${total}]: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL [Test ${total}]: ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function main() {
  await initDb();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    const orgAId = `org_p4_a_${randomUUID().slice(0, 8)}`;
    const orgBId = `org_p4_b_${randomUUID().slice(0, 8)}`;
    const orgEmptyId = `org_p4_empty_${randomUUID().slice(0, 8)}`;

    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
      orgAId,
      `Phase4 Org Alpha ${orgAId}`,
    ]);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
      orgBId,
      `Phase4 Org Beta ${orgBId}`,
    ]);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
      orgEmptyId,
      `Phase4 Org Empty ${orgEmptyId}`,
    ]);

    const userA = { userId: `user_${orgAId}`, id: randomUUID(), email: "lead_eng_a@mrpl.demo", organizationId: orgAId, role: "admin" };
    const userB = { userId: `user_${orgBId}`, id: randomUUID(), email: "lead_eng_b@other.demo", organizationId: orgBId, role: "admin" };

    const tokenA = generateToken(userA);
    const tokenB = generateToken(userB);

    let docSopAId = null;
    let docOcrAId = null;
    let docInspAId = null;
    let docOtherAId = null;

    // 1. Normal PDF text SOP ingestion
    await runTest("Normal PDF text SOP ingestion via upload endpoint", async () => {
      const pdfBytes = buildTextPdf([
        [
          "STANDARD OPERATING PROCEDURE: CENTRIFUGAL PUMP BEARING MAINTENANCE",
          "Document ID: SOP-MAINT-PUMP-001",
          "Normal operating limit for Pump-03 bearing temperature is 80 degrees Celsius.",
          "If temperature exceeds 80 C: reduce load immediately and inspect lubrication.",
          "Critical limit: 95 degrees Celsius requires emergency shutdown.",
        ],
      ]);

      const res = await apiUpload(pdfBytes, "Pump_Bearing_SOP.pdf", "sop", tokenA);
      assert.equal(res.status, 200, "SOP upload must succeed with 200");
      assert.equal(res.data.success, true);
      assert.equal(res.data.documentType, "sop");
      assert.equal(res.data.status, "Indexed");
      assert(res.data.chunksStored > 0, "Must store at least 1 chunk");
      assert.equal(res.data.extractionMethod, "pdf-text");
      docSopAId = res.data.documentId;
    });

    // 2. Scanned PDF / OCR ingestion
    await runTest("Scanned PDF with image text triggering OCR extraction", async () => {
      const ocrPdfBytes = buildScannedIndustrialPdf([
        "SOP-OCR-TURBINE: STEAM TURBINE VIBRATION THRESHOLD",
        "CRITICAL LIMIT: VIBRATION EXCEEDING 4.5 MM/S REQUIRES IMMEDIATE TURBINE TRIP",
        "EXECUTE EMERGENCY LOCKOUT PROCEDURE IMMEDIATELY",
      ]);

      const res = await apiUpload(ocrPdfBytes, "Scanned_Turbine_SOP.pdf", "sop", tokenA);
      assert.equal(res.status, 200);
      assert.equal(res.data.documentType, "sop");
      assert.equal(res.data.status, "Indexed");
      assert.equal(res.data.extractionMethod, "ocr");
      docOcrAId = res.data.documentId;
    });

    // 3. Document metadata in PostgreSQL (documentType="sop")
    await runTest("Document metadata verified in PostgreSQL", async () => {
      const dbRes = await query("SELECT id, organization_id, filename, document_type, status, chunks_stored, extraction_method FROM documents WHERE id = $1", [docSopAId]);
      assert.equal(dbRes.rows.length, 1);
      const row = dbRes.rows[0];
      assert.equal(row.organization_id, orgAId);
      assert.equal(row.document_type, "sop");
      assert.equal(row.status, "Indexed");
      assert(row.chunks_stored > 0);
      assert.equal(row.extraction_method, "pdf-text");
    });

    // 4. Page-aware chunking with token offsets
    await runTest("Page-aware chunking with non-negative start/end offsets", async () => {
      const vec = await generateEmbedding("centrifugal pump bearing maintenance");
      const chunks = await searchSimilarChunks(vec, 5, docSopAId, { organizationId: orgAId });
      assert(chunks.length > 0);
      const chunk = chunks[0];
      assert(typeof chunk.pageStartOffset === "number" && chunk.pageStartOffset >= 0);
      assert(typeof chunk.pageEndOffset === "number" && chunk.pageEndOffset >= chunk.pageStartOffset);
    });

    // 5. Local 384D ONNX embeddings
    await runTest("Local 384D ONNX embeddings generated for each chunk", async () => {
      const vec = await generateEmbedding("Sample SOP text");
      assert.equal(vec.length, 384, "Embedding dimensions must be exactly 384");
    });

    // 6. Qdrant point storage and schema
    await runTest("Qdrant point storage and payload integrity", async () => {
      const vec = await generateEmbedding("bearing temperature 80 degrees");
      const chunks = await searchSimilarChunks(vec, 5, undefined, { organizationId: orgAId, documentType: "sop" });
      assert(chunks.length > 0);
      const match = chunks.find((c) => c.documentId === docSopAId);
      assert(match, "Qdrant must contain point with documentId matching uploaded SOP");
      assert.equal(match.organizationId, orgAId);
      assert.equal(match.documentType, "sop");
      assert(match.text.includes("80 degrees Celsius"));
    });

    // 7. Knowledge Base listing (GET /api/v1/documents?documentType=sop)
    await runTest("Knowledge Base listing queries exclusively SOP documents", async () => {
      const res = await apiJson("GET", "/api/v1/documents?documentType=sop", null, tokenA);
      assert.equal(res.status, 200);
      assert(Array.isArray(res.data.documents));
      const hasSopA = res.data.documents.some((d) => d.documentId === docSopAId);
      const hasOcrA = res.data.documents.some((d) => d.documentId === docOcrAId);
      assert(hasSopA, "Listing must include uploaded normal SOP");
      assert(hasOcrA, "Listing must include uploaded OCR SOP");
      for (const doc of res.data.documents) {
        assert.equal(doc.documentType, "sop");
      }
    });

    // 8. Interactive semantic search (POST /api/v1/knowledge/search)
    await runTest("Interactive semantic search retrieves grounded SOP evidence", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "Pump-03 bearing temperature reached 92°C" }, tokenA);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert(Array.isArray(res.data.results));
      assert(res.data.results.length > 0);
      const top = res.data.results[0];
      assert.equal(top.documentType, "sop");
      assert.equal(top.filename, "Pump_Bearing_SOP.pdf");
      assert(top.text.includes("80 degrees Celsius"));
    });

    // 9. Real Qdrant similarity score preservation
    await runTest("Real Qdrant cosine similarity score preserved in results", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "Pump-03 bearing temperature" }, tokenA);
      assert.equal(res.status, 200);
      const topScore = res.data.results[0].score;
      assert(typeof topScore === "number" && topScore > 0 && topScore <= 1.0);
    });

    // 10. Source metadata integrity (filename, page, chunkIndex, extractionMethod)
    await runTest("Source metadata integrity in search results", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "Steam turbine vibration 4.5 mm/s" }, tokenA);
      assert.equal(res.status, 200);
      const ocrMatch = res.data.results.find((r) => r.documentId === docOcrAId);
      assert(ocrMatch, "Must retrieve OCR turbine SOP");
      assert.equal(ocrMatch.extractionMethod, "ocr");
      assert.equal(ocrMatch.page, 1);
      assert.equal(typeof ocrMatch.chunkIndex, "number");
    });

    // 11. Zero-result safety without hallucinations
    await runTest("Zero-result query returns clean empty array without synthetic text", async () => {
      const emptyOrgToken = generateToken({ id: randomUUID(), email: "empty@demo.org", organizationId: orgEmptyId, role: "member" });
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "nuclear reactor core temperature" }, emptyOrgToken);
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.results, []);
      assert.equal(res.data.total, 0);
    });

    // Upload an inspection report and an "other" document for filter tests
    const inspPdfBytes = buildTextPdf([
      [
        "CRUDE DISTILLATION UNIT INSPECTION REPORT",
        "Unit: CDU-II, Equipment: Pump-03",
        "Pump-03 bearing temperature recorded at 92 degrees Celsius.",
      ],
    ]);
    const inspRes = await apiUpload(inspPdfBytes, "CDU_Inspection_Report.pdf", "inspection", tokenA);
    docInspAId = inspRes.data.documentId;

    const otherPdfBytes = buildTextPdf([
      [
        "EQUIPMENT VENDOR SPECIFICATIONS",
        "Pump bearing model numbers, mechanical seals, and shaft dimensions.",
      ],
    ]);
    const otherRes = await apiUpload(otherPdfBytes, "Vendor_Spec_Sheet.pdf", "other", tokenA);
    docOtherAId = otherRes.data.documentId;

    // 12. SOP-only filter enforced at Qdrant level
    await runTest("SOP-only filter enforced at Qdrant level", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "CDU inspection report or pump bearing" }, tokenA);
      assert.equal(res.status, 200);
      for (const r of res.data.results) {
        assert.equal(r.documentType, "sop", "No non-SOP document may be returned");
      }
    });

    // 13. Inspection documents exclusion from KB search
    await runTest("Inspection documents strictly excluded from Knowledge Search", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "CDU-II crude distillation unit inspection" }, tokenA);
      assert.equal(res.status, 200);
      const hasInsp = res.data.results?.some((r) => r.documentId === docInspAId || r.filename === "CDU_Inspection_Report.pdf");
      assert.equal(hasInsp, false, "Inspection report must not appear in KB search");
    });

    // 14. Other documents exclusion from KB search
    await runTest("Other non-SOP documents strictly excluded from Knowledge Search", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "equipment vendor specifications shaft dimensions" }, tokenA);
      assert.equal(res.status, 200);
      const hasOther = res.data.results?.some((r) => r.documentId === docOtherAId || r.filename === "Vendor_Spec_Sheet.pdf");
      assert.equal(hasOther, false, "Other documents must not appear in KB search");
    });

    // Upload SOP for Organization B
    const sopBPdfBytes = buildTextPdf([
      [
        "ORGANIZATION B CONFIDENTIAL PIPELINE SAFETY SOP",
        "Document ID: SOP-ORG-B-009",
        "Pipeline pressure threshold: Maximum allowable operating pressure is 45 bar.",
      ],
    ]);
    const sopBRes = await apiUpload(sopBPdfBytes, "OrgB_Pipeline_SOP.pdf", "sop", tokenB);
    const docSopBId = sopBRes.data.documentId;

    // 15. Tenant isolation (Org A -> Org B)
    await runTest("Tenant isolation (Org A cannot search Org B SOPs)", async () => {
      const resA = await apiJson("POST", "/api/v1/knowledge/search", { query: "maximum allowable operating pressure 45 bar" }, tokenA);
      assert.equal(resA.status, 200);
      const foundOrgB = resA.data.results?.some((r) => r.documentId === docSopBId || r.filename === "OrgB_Pipeline_SOP.pdf");
      assert.equal(foundOrgB, false, "Org A must not retrieve Org B's SOP");
    });

    // 16. Tenant isolation (Org B -> Org A)
    await runTest("Tenant isolation (Org B cannot search Org A SOPs)", async () => {
      const resB = await apiJson("POST", "/api/v1/knowledge/search", { query: "Pump-03 bearing temperature 80 degrees" }, tokenB);
      assert.equal(resB.status, 200);
      const foundOrgA = resB.data.results?.some((r) => r.documentId === docSopAId || r.filename === "Pump_Bearing_SOP.pdf");
      assert.equal(foundOrgA, false, "Org B must not retrieve Org A's SOP");
    });

    // 17. Client spoofing protection
    await runTest("Client spoofing protection (client-supplied organizationId ignored/rejected)", async () => {
      const resSpoof = await apiJson(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pipeline pressure threshold", organizationId: orgBId },
        tokenA
      );
      assert.equal(resSpoof.status, 200);
      const foundOrgB = resSpoof.data.results?.some((r) => r.documentId === docSopBId);
      assert.equal(foundOrgB, false, "Body-level organizationId spoofing must not cross tenant boundary");
    });

    // 18. Unauthenticated search rejection (401)
    await runTest("Unauthenticated search rejected with HTTP 401", async () => {
      const res = await apiJson("POST", "/api/v1/knowledge/search", { query: "bearing temperature" }, null);
      assert.equal(res.status, 401);
      assert.equal(res.data.success, false);
    });

    // 19. Unauthenticated upload and listing rejection (401)
    await runTest("Unauthenticated upload and listing rejected with HTTP 401", async () => {
      const resUpload = await apiUpload(inspPdfBytes, "test.pdf", "sop", null);
      assert.equal(resUpload.status, 401);

      const resList = await apiJson("GET", "/api/v1/documents", null, null);
      assert.equal(resList.status, 401);
    });

    // 20. Tenant-scoped document deletion
    await runTest("Tenant-scoped document deletion rejects foreign organization deletion", async () => {
      const crossDel = await apiJson("DELETE", `/api/v1/documents/${docSopAId}`, null, tokenB);
      assert.equal(crossDel.status, 403, "User B cannot delete User A's SOP");
    });

    // 21, 22, 23: Complete deletion lifecycle for a dedicated SOP
    const tempSopBytes = buildTextPdf([
      [
        "TEMPORARY TEST SOP FOR DELETION LIFECYCLE",
        "Document to be created, verified, and completely removed.",
      ],
    ]);
    const tempUpload = await apiUpload(tempSopBytes, "Temp_Delete_SOP.pdf", "sop", tokenA);
    const tempDocId = tempUpload.data.documentId;

    // Verify temp SOP is stored
    const checkDbBefore = await query("SELECT id FROM documents WHERE id = $1", [tempDocId]);
    assert.equal(checkDbBefore.rows.length, 1);

    // Delete temp SOP
    const deleteRes = await apiJson("DELETE", `/api/v1/documents/${tempDocId}`, null, tokenA);
    assert.equal(deleteRes.status, 200);

    // 21. Physical file cleanup on deletion
    await runTest("Physical file cleanup on deletion", async () => {
      const uploadPath = path.resolve(__dirname, `../uploads/${orgAId}/Temp_Delete_SOP.pdf`);
      assert.equal(fs.existsSync(uploadPath), false, "Physical file must be unlinked");
    });

    // 22. Qdrant vector cleanup on deletion
    await runTest("Qdrant vector cleanup on deletion", async () => {
      const vec = await generateEmbedding("TEMPORARY TEST SOP FOR DELETION");
      const chunks = await searchSimilarChunks(vec, 5, tempDocId, { organizationId: orgAId });
      assert.equal(chunks.length, 0, "Deleted document points must be removed from Qdrant");
    });

    // 23. PostgreSQL cleanup on deletion
    await runTest("PostgreSQL document record cleanup on deletion", async () => {
      const checkDbAfter = await query("SELECT id FROM documents WHERE id = $1", [tempDocId]);
      assert.equal(checkDbAfter.rows.length, 0, "PostgreSQL record must be deleted");
    });

    // 24. LangGraph Inspection Agent RAG integration
    await runTest("LangGraph Inspection Agent RAG retrieves uploaded SOP evidence", async () => {
      const finding = {
        finding: "Pump-03 bearing temperature reached 92 degrees Celsius during peak operation.",
        evidence: "Bearing temperature 92 C observed on outboard bracket exceeding 80 C threshold.",
        equipment: "Pump-03",
        observedValue: "92 C",
        limit: "80 C",
        severity: "HIGH",
      };

      const sopEvidence = await searchSop(finding.finding, {
        organizationId: orgAId,
        limit: 5,
        scoreThreshold: 0.1,
      });

      assert(sopEvidence.length > 0, "Inspection Agent flow must retrieve uploaded SOP evidence");
      assert.equal(sopEvidence[0].filename, "Pump_Bearing_SOP.pdf");

      const riskResult = await assessFindingRisk(finding, {
        organizationId: orgAId,
        sopOptions: { limit: 5, scoreThreshold: 0.1 },
      });

      assert(riskResult.riskAssessment, "Risk assessment must calculate severity from evidence");
      assert(riskResult.citations.length > 0, "Must contain SOP citations");
      assert.equal(riskResult.citations[0].filename, "Pump_Bearing_SOP.pdf");
      assert.equal(riskResult.grounded, true, "Risk assessment must be grounded in SOP evidence");
    });

    // 25. Citation integrity & no-evidence safety
    await runTest("Citation integrity & no-evidence safety verified", async () => {
      const unrelatedFinding = {
        finding: "Control room ergonomic chair swivel mechanism is squeaking.",
        evidence: "Operator noted squeaking sound when rotating chair.",
        equipment: "Chair-01",
      };

      const noEvidence = await searchSop(unrelatedFinding.finding, {
        organizationId: orgAId,
        limit: 5,
        scoreThreshold: 0.7, // Strict threshold
      });

      assert.equal(noEvidence.length, 0, "Unrelated finding must yield zero SOP evidence");

      const safeRisk = await assessFindingRisk(unrelatedFinding, {
        organizationId: orgAId,
        sopOptions: { limit: 5, scoreThreshold: 0.7 },
      });

      assert.equal(safeRisk.citations.length, 0, "Must not hallucinate SOP citations when no evidence exists");
      assert.equal(safeRisk.grounded, false, "Must report grounded: false when no SOP evidence exists");
      assert(safeRisk.riskAssessment.reason.includes("Insufficient") || safeRisk.recommendation.includes("Insufficient"));
    });

    console.log(`\n==================================================`);
    console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
    console.log(`==================================================\n`);
  } finally {
    if (server) {
      server.close();
    }
  }
}

main().catch((err) => {
  console.error("FATAL PHASE 4 TEST ERROR:", err);
  process.exit(1);
});
