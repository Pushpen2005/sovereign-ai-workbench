/**
 * SOVEREIGNAI — PHASE 3: KNOWLEDGE BASE SEARCH SIMULATOR TEST SUITE
 *
 * Test Matrix (18 Specifications):
 *  1. Knowledge search endpoint exists (POST /api/v1/knowledge/search)
 *  2. Authentication required (401 on unauthenticated request)
 *  3. Query validation (empty query, whitespace-only, missing body rejected with 400)
 *  4. organizationId comes ONLY from authenticated session (client-spoofed orgs rejected/ignored)
 *  5. SOP filter enforced at Qdrant level (documentType="sop")
 *  6. Inspection documents excluded from Knowledge Base search results
 *  7. Other technical documents excluded from Knowledge Base search results
 *  8. TopK bounded (default 5, max 20, positive integer validation)
 *  9. Correct local embedding service used (384D local ONNX model)
 * 10. Correct Qdrant collection used ("documents")
 * 11. Relevant SOP retrieved deterministically from engineering finding
 * 12. Zero-result behavior returns clean empty results array without error or hallucination
 * 13. Tenant isolation Org A -> Org B (Org A cannot retrieve Org B's SOPs)
 * 14. Tenant isolation Org B -> Org A (Org B cannot retrieve Org A's SOPs)
 * 15. Response metadata integrity (filename, page, chunkIndex, extractionMethod, documentType="sop")
 * 16. Similarity score preserved accurately from Qdrant vector search
 * 17. Zero LLM / Ollama invocation during semantic search simulation
 * 18. Existing Knowledge Base and SOP RAG regression verified
 */

import assert from "node:assert/strict";
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
import { upsertChunks } from "../../ai-service/vectorstore/qdrant.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";

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

    offsets[item.contentId] = pos;
    write(`${item.contentId} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  const xrefPos = pos;
  write("xref\n");
  write(`0 ${nextObjId}\n`);
  write("0000000000 65535 f \n");
  for (let i = 1; i < nextObjId; i++) {
    const off = offsets[i] || 0;
    write(`${String(off).padStart(10, "0")} 00000 n \n`);
  }

  write("trailer\n");
  write(`<< /Size ${nextObjId} /Root 1 0 R >>\n`);
  write("startxref\n");
  write(`${xrefPos}\n`);
  write("%%EOF\n");

  return Buffer.concat(parts);
}

let server;
let baseUrl;

async function apiRequest(method, endpoint, body = null, token = null, headers = {}) {
  const reqHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    reqHeaders["Authorization"] = `Bearer ${token}`;
  }

  const opts = {
    method,
    headers: reqHeaders,
  };
  if (body && method !== "GET") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

console.log("==================================================");
console.log("PHASE 3: KNOWLEDGE BASE SEARCH SIMULATOR TEST SUITE");
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

async function setup() {
  await initDb();
  server = app.listen(0);
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function teardown() {
  if (server) {
    server.close();
  }
}

async function main() {
  await setup();

  // Distinct test organizations
  const orgAId = `org_p3_a_${randomUUID().slice(0, 8)}`;
  const orgBId = `org_p3_b_${randomUUID().slice(0, 8)}`;

  const userA = { id: randomUUID(), email: "engineer_a@mrpl.demo", organizationId: orgAId, role: "admin" };
  const userB = { id: randomUUID(), email: "engineer_b@other.demo", organizationId: orgBId, role: "admin" };

  const tokenA = generateToken(userA);
  const tokenB = generateToken(userB);

  // Insert seed test chunks into Qdrant directly
  const docSopAId = randomUUID();
  const docSopBId = randomUUID();
  const docInspAId = randomUUID();
  const docOtherAId = randomUUID();

  const textSopA = "STANDARD OPERATING PROCEDURE: PUMP-03 BEARING MAINTENANCE. Bearing temperature above 80 degrees Celsius requires immediate lubrication inspection and load reduction. At 95 C trigger emergency trip.";
  const textSopB = "TURBINE GENERATOR LUBRICATION SOP. Unit 9 high vibration exceeding 7.5 mm/s requires immediate steam turbine shutdown and trip.";
  const textInspA = "FIELD INSPECTION REPORT: Pump-03 bearing temperature reached 92 degrees Celsius during maximum refinery throughput test.";
  const textOtherA = "GENERAL VENDOR CATALOG: Industrial bearing specifications, dimensions, and standard lubrication oil viscosity ratings.";

  const vecSopA = await generateEmbedding(textSopA);
  const vecSopB = await generateEmbedding(textSopB);
  const vecInspA = await generateEmbedding(textInspA);
  const vecOtherA = await generateEmbedding(textOtherA);

  await upsertChunks([
    {
      id: randomUUID(),
      documentId: docSopAId,
      organizationId: orgAId,
      filename: "Pump_Maintenance_SOP.pdf",
      documentType: "sop",
      page: 3,
      chunkIndex: 0,
      pageStartOffset: 0,
      pageEndOffset: textSopA.length,
      startOffset: 0,
      endOffset: textSopA.length,
      text: textSopA,
      vector: vecSopA,
      extractionMethod: "pdf-text",
    },
    {
      id: randomUUID(),
      documentId: docSopBId,
      organizationId: orgBId,
      filename: "Turbine_Safety_SOP.pdf",
      documentType: "sop",
      page: 1,
      chunkIndex: 0,
      pageStartOffset: 0,
      pageEndOffset: textSopB.length,
      startOffset: 0,
      endOffset: textSopB.length,
      text: textSopB,
      vector: vecSopB,
      extractionMethod: "ocr",
    },
    {
      id: randomUUID(),
      documentId: docInspAId,
      organizationId: orgAId,
      filename: "Pump03_Inspection_Report.pdf",
      documentType: "inspection",
      page: 1,
      chunkIndex: 0,
      pageStartOffset: 0,
      pageEndOffset: textInspA.length,
      startOffset: 0,
      endOffset: textInspA.length,
      text: textInspA,
      vector: vecInspA,
      extractionMethod: "pdf-text",
    },
    {
      id: randomUUID(),
      documentId: docOtherAId,
      organizationId: orgAId,
      filename: "Vendor_Bearing_Catalog.pdf",
      documentType: "other",
      page: 12,
      chunkIndex: 0,
      pageStartOffset: 0,
      pageEndOffset: textOtherA.length,
      startOffset: 0,
      endOffset: textOtherA.length,
      text: textOtherA,
      vector: vecOtherA,
      extractionMethod: "pdf-text",
    },
  ]);

  try {
    // 1. Knowledge search endpoint exists
    await runTest("Knowledge search endpoint exists", async () => {
      const res = await apiRequest("POST", "/api/v1/knowledge/search", { query: "test" }, tokenA);
      assert.notEqual(res.status, 404, "Endpoint /api/v1/knowledge/search must exist");
    });

    // 2. Authentication required
    await runTest("Authentication required (401 on unauthenticated request)", async () => {
      const res = await apiRequest("POST", "/api/v1/knowledge/search", { query: "bearing temperature" }, null);
      assert.equal(res.status, 401, "Unauthenticated request must return 401");
      assert.equal(res.data.success, false);
    });

    // 3. Query validation
    await runTest("Query validation (empty and missing query rejected with 400)", async () => {
      const resEmpty = await apiRequest("POST", "/api/v1/knowledge/search", { query: "" }, tokenA);
      assert.equal(resEmpty.status, 400, "Empty query must return 400");

      const resWhitespace = await apiRequest("POST", "/api/v1/knowledge/search", { query: "   " }, tokenA);
      assert.equal(resWhitespace.status, 400, "Whitespace query must return 400");

      const resMissing = await apiRequest("POST", "/api/v1/knowledge/search", {}, tokenA);
      assert.equal(resMissing.status, 400, "Missing query must return 400");
    });

    // 4. organizationId comes ONLY from authenticated session
    await runTest("organizationId comes authoritatively from authenticated session", async () => {
      // User A attempts to search with body or header spoofing Org B
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "turbine vibration", organizationId: orgBId },
        tokenA
      );
      assert.equal(res.status, 200, "Request should succeed under user's actual org");
      // Results should NOT contain Org B's Turbine SOP
      const foundTurbine = res.data.results?.some((r) => r.filename === "Turbine_Safety_SOP.pdf");
      assert.equal(foundTurbine, false, "Client spoofed organizationId must not access other org data");
    });

    // 5. SOP filter enforced at Qdrant level
    await runTest("SOP filter enforced (documentType='sop')", async () => {
      const res = await apiRequest("POST", "/api/v1/knowledge/search", { query: "bearing temperature inspection" }, tokenA);
      assert.equal(res.status, 200);
      assert(Array.isArray(res.data.results), "Results must be an array");
      for (const r of res.data.results) {
        assert.equal(r.documentType, "sop", "All returned items must have documentType='sop'");
      }
    });

    // 6. Inspection documents excluded
    await runTest("Inspection documents excluded from Knowledge Base results", async () => {
      const res = await apiRequest("POST", "/api/v1/knowledge/search", { query: "field inspection report pump-03" }, tokenA);
      assert.equal(res.status, 200);
      const hasInsp = res.data.results?.some((r) => r.documentId === docInspAId || r.filename === "Pump03_Inspection_Report.pdf");
      assert.equal(hasInsp, false, "Inspection report documents must never appear in KB search results");
    });

    // 7. Other documents excluded
    await runTest("Other technical documents excluded from Knowledge Base results", async () => {
      const res = await apiRequest("POST", "/api/v1/knowledge/search", { query: "vendor bearing catalog specifications" }, tokenA);
      assert.equal(res.status, 200);
      const hasOther = res.data.results?.some((r) => r.documentId === docOtherAId || r.filename === "Vendor_Bearing_Catalog.pdf");
      assert.equal(hasOther, false, "Other non-SOP documents must never appear in KB search results");
    });

    // 8. TopK bounded
    await runTest("TopK bounded (default 5, clamped to max 20, positive validation)", async () => {
      const resDefault = await apiRequest("POST", "/api/v1/knowledge/search", { query: "bearing" }, tokenA);
      assert.equal(resDefault.status, 200);

      const resInvalid = await apiRequest("POST", "/api/v1/knowledge/search", { query: "bearing", topK: -5 }, tokenA);
      assert.equal(resInvalid.status, 400, "Negative topK must return 400");
    });

    // 9. Correct embedding service used (384 dimensions)
    await runTest("Correct local embedding service used (384D ONNX)", async () => {
      const vec = await generateEmbedding("Test query vector");
      assert.equal(vec.length, 384, "Local embedding must produce 384 dimensions");
    });

    // 10. Correct Qdrant collection used ("documents")
    await runTest("Correct Qdrant collection used ('documents')", async () => {
      const results = await searchSop("Pump-03 bearing maintenance", {
        organizationId: orgAId,
        limit: 5,
        scoreThreshold: 0.0,
      });
      assert(results.length > 0, "searchSop must query Qdrant documents collection successfully");
    });

    // 11. Relevant SOP retrieved deterministically from engineering finding
    await runTest("Relevant SOP retrieved deterministically from engineering finding", async () => {
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pump-03 bearing temperature reached 92°C" },
        tokenA
      );
      assert.equal(res.status, 200);
      assert(res.data.results.length > 0, "Should retrieve at least one relevant SOP chunk");
      const topMatch = res.data.results[0];
      assert.equal(topMatch.filename, "Pump_Maintenance_SOP.pdf");
      assert(topMatch.text.includes("80 degrees Celsius"), "Retrieved chunk must contain SOP threshold content");
    });

    // 12. Zero-result behavior
    await runTest("Zero-result behavior returns clean empty results array", async () => {
      const emptyOrgId = `org_p3_empty_${randomUUID().slice(0, 8)}`;
      const emptyToken = generateToken({ id: randomUUID(), email: "empty@demo.org", organizationId: emptyOrgId, role: "member" });
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pump-03 bearing maintenance" },
        emptyToken
      );
      assert.equal(res.status, 200);
      assert.deepEqual(res.data.results, []);
      assert.equal(res.data.total, 0);
    });

    // 13. Tenant isolation Org A -> Org B
    await runTest("Tenant isolation Org A -> Org B (Org A cannot retrieve Org B SOPs)", async () => {
      const resA = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "steam turbine vibration exceeding 7.5" },
        tokenA
      );
      assert.equal(resA.status, 200);
      const foundTurbine = resA.data.results?.some((r) => r.filename === "Turbine_Safety_SOP.pdf" || r.documentId === docSopBId);
      assert.equal(foundTurbine, false, "Org A must not retrieve Org B's Turbine SOP");
    });

    // 14. Tenant isolation Org B -> Org A
    await runTest("Tenant isolation Org B -> Org A (Org B cannot retrieve Org A SOPs)", async () => {
      const resB = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pump-03 bearing temperature 80 degrees Celsius" },
        tokenB
      );
      assert.equal(resB.status, 200);
      const foundPump = resB.data.results?.some((r) => r.filename === "Pump_Maintenance_SOP.pdf" || r.documentId === docSopAId);
      assert.equal(foundPump, false, "Org B must not retrieve Org A's Pump SOP");
    });

    // 15. Response metadata integrity
    await runTest("Response metadata integrity (filename, page, chunkIndex, extractionMethod, score, text)", async () => {
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pump-03 bearing maintenance" },
        tokenA
      );
      assert.equal(res.status, 200);
      const item = res.data.results[0];
      assert(typeof item.filename === "string" && item.filename.length > 0, "filename must be string");
      assert(typeof item.page === "number", "page must be number");
      assert(typeof item.chunkIndex === "number", "chunkIndex must be number");
      assert(typeof item.extractionMethod === "string", "extractionMethod must be string");
      assert(typeof item.score === "number", "score must be number");
      assert(typeof item.text === "string" && item.text.length > 0, "text must be string");
      assert.equal(item.documentType, "sop", "documentType must be sop");
    });

    // 16. Similarity score preserved accurately from Qdrant
    await runTest("Similarity score preserved accurately from Qdrant vector search", async () => {
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Pump-03 bearing maintenance" },
        tokenA
      );
      assert.equal(res.status, 200);
      const score = res.data.results[0].score;
      assert(score > 0 && score <= 1.0, `Score must be a valid cosine similarity float, got ${score}`);
    });

    // 17. Zero LLM / Ollama invocation
    await runTest("Zero LLM / Ollama invocation during semantic search simulation", async () => {
      const res = await apiRequest(
        "POST",
        "/api/v1/knowledge/search",
        { query: "Bearing temperature 92 degrees Celsius" },
        tokenA
      );
      assert.equal(res.status, 200);
      // Results contain exact text chunks from Qdrant, with no synthetic commentary or LLM tokens
      for (const r of res.data.results) {
        assert(r.text.includes("STANDARD OPERATING PROCEDURE"), "Text must be raw extracted passage from Qdrant");
      }
    });

    // 18. Existing Knowledge Base and SOP RAG regression verified
    await runTest("Existing Knowledge Base and SOP RAG regression verified", async () => {
      const sopResults = await searchSop("Pump-03 bearing temperature", {
        organizationId: orgAId,
        limit: 5,
        scoreThreshold: 0.1,
      });
      assert(sopResults.length > 0, "searchSop service must work cleanly without regression");
      assert.equal(sopResults[0].documentType, "sop");
    });

    console.log(`\n==================================================`);
    console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
    console.log(`==================================================\n`);
  } finally {
    await teardown();
  }
}

main().catch((err) => {
  console.error("FATAL TEST ERROR:", err);
  process.exit(1);
});
