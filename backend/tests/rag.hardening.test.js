import assert from "node:assert";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";

import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { generateEmbedding, EMBEDDING_DIMENSIONS } from "../../ai-service/embeddings/embedding.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { upsertChunks } from "../../ai-service/vectorstore/qdrant.service.js";
import { chunkText } from "../../ai-service/chunking/chunk.service.js";
import { extractPdfText } from "../../ai-service/extraction/pdf.service.js";
import { extractTextFromImage } from "../../ai-service/extraction/ocr.service.js";
import { answerQuestion, validateRagCitation } from "../../ai-service/rag/rag.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "../src/uploads");

/**
 * Generates a valid multi-page PDF buffer in memory using PDF 1.4 syntax.
 */
function createMinimalPdf(pages) {
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

  const catalogObjStr = `<< /Type /Catalog\n/Pages 2 0 R\n>>`;
  writeObj(1, catalogObjStr);

  const xrefOffset = pos;
  const totalObjs = nextId;
  write(`xref\n0 ${totalObjs}\n`);
  write("0000000000 65535 f \n");
  for (let id = 1; id < totalObjs; id++) {
    const off = String(offsets[id] || 0).padStart(10, "0");
    write(`${off} 00000 n \n`);
  }

  write(`trailer\n<< /Size ${totalObjs}\n/Root 1 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function runRagHardeningTests() {
  console.log("==================================================");
  console.log("Phase 4: Document Intelligence & RAG Hardening Suite");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];
  const cleanupFilePaths = [];

  const evaluationMetrics = {
    top3Hits: 0,
    top5Hits: 0,
    top10Hits: 0,
    totalEvaluations: 0,
    retrievalLatencies: [],
    ragTotalLatencies: [],
  };

  try {
    // ----------------------------------------------------
    // [1] Embedding Consistency & Dimension Validation
    // ----------------------------------------------------
    console.log("\n[1] Verifying Embedding Consistency & Vector Dimensions");
    assert.equal(EMBEDDING_DIMENSIONS, 384, "Embedding dimensions must be exactly 384");

    const sampleQuery = "Bearing temperature monitoring procedure";
    const sampleDocText = "Standard operating limit for centrifugal pump bearings is 80 degrees Celsius.";

    const queryVec = await generateEmbedding(sampleQuery);
    assert.equal(Array.isArray(queryVec), true);
    assert.equal(queryVec.length, 384, "Query vector must have 384 dimensions");

    const docVec = await generateEmbedding(sampleDocText);
    assert.equal(Array.isArray(docVec), true);
    assert.equal(docVec.length, 384, "Document chunk vector must have 384 dimensions");

    // Incompatible vector dimension rejection test
    let rejectedIncompatible = false;
    try {
      await upsertChunks([
        {
          documentId: "dim_test_doc",
          chunkIndex: 0,
          text: "Dimension test chunk",
          page: 1,
          pageStartOffset: 0,
          pageEndOffset: 20,
          vector: new Array(512).fill(0.1), // Wrong dimension (512 vs 384)
        },
      ]);
    } catch (err) {
      rejectedIncompatible = err.message.includes("384 dimensions");
    }
    assert.equal(rejectedIncompatible, true, "Qdrant upsert must strictly reject incompatible vector dimensions");
    console.log("  ✅ PASS: Query (384D) and Document (384D) embeddings are consistent; invalid dimensions rejected");

    // ----------------------------------------------------
    // [2] Qdrant Collection Health & Required Payload
    // ----------------------------------------------------
    console.log("\n[2] Verifying Qdrant Collection Health & Payload Schema");
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const colRes = await fetch(`${qdrantUrl}/collections/documents`);
    assert.equal(colRes.status, 200, "Collection 'documents' must be reachable");
    const colData = await colRes.json();
    assert.equal(colData.result.config.params.vectors.size, 384);
    assert.equal(colData.result.config.params.vectors.distance, "Cosine");
    assert.ok(colData.result.points_count > 0, "Collection must contain active points");
    console.log(`  ✅ PASS: Qdrant 'documents' collection healthy (${colData.result.points_count} points, Cosine, 384D)`);

    // ----------------------------------------------------
    // [3] Chunking Quality & Boundary Preservation
    // ----------------------------------------------------
    console.log("\n[3] Auditing Chunking Quality & Offsets");
    const testPages = [
      { page: 1, text: "Page 1: Section 1.1 Equipment Overview. The CDU-II section handles continuous crude distillation." },
      { page: 2, text: "Page 2: Section 1.2 Operational Limits. Maximum continuous bearing temperature limit is 80 degrees C." },
      { page: 3, text: "" }, // Empty page simulation
      { page: 4, text: "Page 4: Section 1.3 Vibration Analysis. Excessive vibration indicates bearing race degradation." },
    ];
    const testChunks = chunkText(testPages, "chunk_audit_doc");
    assert.ok(testChunks.length >= 3, "Must chunk multi-page input");
    assert.equal(testChunks[0].page, 1);
    assert.equal(testChunks[0].chunkIndex, 0);
    assert.equal(testChunks[1].page, 2);
    assert.equal(testChunks[1].chunkIndex, 1);
    assert.equal(testChunks[2].page, 4); // Page 3 was empty and skipped
    assert.equal(testChunks[2].chunkIndex, 2);
    console.log("  ✅ PASS: Page boundaries, empty page skipping, and monotonic chunk indices verified");

    // ----------------------------------------------------
    // [4] PDF & OCR Extraction Validation
    // ----------------------------------------------------
    console.log("\n[4] Validating PDF Text Extraction & Local Tesseract OCR");
    const pdfBuf = createMinimalPdf([
      ["REFINERY TECHNICAL DOCUMENTATION", "Unit: Hydrocracker HCU-01", "Operating pressure: 145 bar gauge."],
    ]);
    const pdfPath = path.resolve(UPLOADS_DIR, `temp_pdf_${randomUUID().slice(0, 8)}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuf);
    cleanupFilePaths.push(pdfPath);

    const pdfExtracted = await extractPdfText(pdfPath);
    assert.equal(pdfExtracted.pageCount, 1);
    assert.ok(pdfExtracted.text.includes("Hydrocracker HCU-01"));
    console.log("  ✅ PASS: PDF.js extracted vector text successfully");

    // OCR Test: synthesize image with text and pass through local Tesseract
    const canvas = createCanvas(500, 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 500, 100);
    ctx.fillStyle = "black";
    ctx.font = "28px sans-serif";
    ctx.fillText("CRITICAL SENSOR CALIBRATION 42 PSI", 20, 60);

    const ocrImgPath = path.resolve(UPLOADS_DIR, `test_ocr_${randomUUID().slice(0, 8)}.png`);
    fs.writeFileSync(ocrImgPath, canvas.toBuffer("image/png"));
    cleanupFilePaths.push(ocrImgPath);

    const ocrText = await extractTextFromImage(ocrImgPath);
    console.log("    [DEBUG] OCR extracted:", JSON.stringify(ocrText));
    assert.ok(ocrText.toUpperCase().includes("42") || ocrText.toUpperCase().includes("SENSOR"), "OCR must extract text from image");
    console.log(`  ✅ PASS: Local Tesseract OCR extracted text: "${ocrText.trim()}"`);

    // ----------------------------------------------------
    // [5] Setting Up Multi-Tenant Evaluation Corpus
    // ----------------------------------------------------
    console.log("\n[5] Setting Up Synthetic Industrial Test Corpus & Multi-Tenant Boundaries");

    // Org Alpha (Demo Target)
    const orgAlphaId = randomUUID();
    cleanupOrgIds.push(orgAlphaId);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAlphaId, `Refinery Operations Alpha ${orgAlphaId.slice(0, 8)}`]);

    const userAlphaId = randomUUID();
    cleanupUserIds.push(userAlphaId);
    await query(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [userAlphaId, orgAlphaId, "Lead Alpha", `lead_alpha_${orgAlphaId.slice(0, 6)}@alpha.local`, "mock_hash", "admin"]
    );
    const tokenAlpha = generateToken({
      userId: userAlphaId,
      organizationId: orgAlphaId,
      email: `lead_alpha_${orgAlphaId.slice(0, 6)}@alpha.local`,
      role: "admin",
    });

    // Org Beta (Isolated Alien Organization)
    const orgBetaId = randomUUID();
    cleanupOrgIds.push(orgBetaId);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBetaId, `Competitor Petrochemicals Beta ${orgBetaId.slice(0, 8)}`]);

    const userBetaId = randomUUID();
    cleanupUserIds.push(userBetaId);
    await query(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [userBetaId, orgBetaId, "Engineer Beta", `engineer_beta_${orgBetaId.slice(0, 6)}@beta.local`, "mock_hash", "engineer"]
    );
    const tokenBeta = generateToken({
      userId: userBetaId,
      organizationId: orgBetaId,
      email: `engineer_beta_${orgBetaId.slice(0, 6)}@beta.local`,
      role: "engineer",
    });

    // Ingest Synthetic Documents for Org Alpha
    const corpusFiles = [
      {
        filename: "Maintenance_SOP.pdf",
        documentType: "sop",
        pages: [
          [
            "REFINERY STANDARD OPERATING PROCEDURE",
            "Document ID: SOP-MAINT-001 Version: 2.1",
            "1. Rotating Equipment Bearing Temperature Monitoring",
            "Normal bearing operating temperature for pumps and motors is up to 80 degrees C.",
            "Maximum continuous operating limit is 80 degrees C.",
            "If bearing temperature exceeds 80 degrees C, record temperature and inspect bearing immediately.",
          ],
        ],
      },
      {
        filename: "Safety_SOP.pdf",
        documentType: "sop",
        pages: [
          [
            "PLANT SAFETY STANDARD OPERATING PROCEDURE",
            "Document ID: SOP-SAFETY-001 Version: 1.5",
            "1. Emergency Shutdown Procedure",
            "In case of abnormal heating or fire: press the nearest emergency stop button, evacuate personnel, and notify the central control room immediately.",
          ],
        ],
      },
      {
        filename: "Inspection_Report_Pump03.pdf",
        documentType: "inspection",
        pages: [
          [
            "EQUIPMENT INSPECTION REPORT — PUMP-03",
            "Asset ID: Pump-03 Main Cooling Water Circulation Pump",
            "Section: CDU-II Cracking and Pumping Section",
            "Observed Bearing Temperature: 92 degrees C under full operating load.",
            "Condition: Abnormal heating observed during routine daily round.",
            "Heavy casing vibration detected on bearing housing.",
          ],
        ],
      },
      {
        filename: "Inspection_Report_Pump07.pdf",
        documentType: "inspection",
        pages: [
          [
            "EQUIPMENT INSPECTION REPORT — PUMP-07",
            "Asset ID: Pump-07 Feed Injection Booster Pump",
            "Section: CDU-II Section",
            "Observed Bearing Temperature: 71 degrees C under normal load.",
            "Condition: Normal operation with zero leakage and steady bearing temperature.",
          ],
        ],
      },
      {
        filename: "Equipment_Manual.pdf",
        documentType: "knowledge",
        pages: [
          [
            "CENTRIFUGAL PUMP EQUIPMENT MANUAL",
            "Manual ID: MAN-ROT-002",
            "Maintenance Guidelines: Routine inspection of rotating equipment must be conducted daily.",
            "Check lubricant level and verify bearing casing temperature on each daily shift.",
          ],
        ],
      },
    ];

    const orgAlphaDocIds = [];
    for (const item of corpusFiles) {
      const docId = `doc_${randomUUID().slice(0, 8)}`;
      orgAlphaDocIds.push(docId);
      cleanupDocIds.push(docId);

      const pdfBuffer = createMinimalPdf(item.pages);
      const filePath = path.resolve(UPLOADS_DIR, `${docId}.pdf`);
      fs.writeFileSync(filePath, pdfBuffer);
      cleanupFilePaths.push(filePath);

      await query(
        "INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored) VALUES ($1, $2, $3, $4, $5, $6)",
        [docId, orgAlphaId, `${docId}.pdf`, item.filename, "Indexed", item.pages.length]
      );

      const rawChunks = chunkText(
        item.pages.map((lines, idx) => ({ page: idx + 1, text: lines.join(" ") })),
        docId
      );

      const chunksWithVectors = [];
      for (const ch of rawChunks) {
        const vec = await generateEmbedding(ch.text);
        chunksWithVectors.push({
          ...ch,
          filename: item.filename,
          documentType: item.documentType,
          organizationId: orgAlphaId,
          vector: vec,
        });
      }
      await upsertChunks(chunksWithVectors);
    }
    console.log(`  ✅ PASS: 5 synthetic evaluation documents indexed for Org Alpha (${orgAlphaId.slice(0, 8)})`);

    // Ingest Confidential Document for Org Beta
    const orgBetaDocId = `doc_beta_${randomUUID().slice(0, 8)}`;
    cleanupDocIds.push(orgBetaDocId);
    const betaPdfBuffer = createMinimalPdf([
      [
        "ORGANIZATION BETA CONFIDENTIAL FORMULA",
        "Document ID: BETA-SEC-999",
        "Proprietary chemical catalyst composition is 65% cobalt molybdate and 35% silica alumina carrier.",
      ],
    ]);
    const betaFilePath = path.resolve(UPLOADS_DIR, `${orgBetaDocId}.pdf`);
    fs.writeFileSync(betaFilePath, betaPdfBuffer);
    cleanupFilePaths.push(betaFilePath);

    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored) VALUES ($1, $2, $3, $4, $5, $6)",
      [orgBetaDocId, orgBetaId, `${orgBetaDocId}.pdf`, "Confidential_OrgB_Specs.pdf", "Indexed", 1]
    );

    const betaChunks = chunkText(
      [{ page: 1, text: "Proprietary chemical catalyst composition is 65% cobalt molybdate and 35% silica alumina carrier." }],
      orgBetaDocId
    );
    const betaChunksWithVectors = [];
    for (const ch of betaChunks) {
      const vec = await generateEmbedding(ch.text);
      betaChunksWithVectors.push({
        ...ch,
        filename: "Confidential_OrgB_Specs.pdf",
        documentType: "knowledge",
        organizationId: orgBetaId,
        vector: vec,
      });
    }
    await upsertChunks(betaChunksWithVectors);
    console.log(`  ✅ PASS: 1 confidential document indexed for Org Beta (${orgBetaId.slice(0, 8)})`);

    // ----------------------------------------------------
    // [6] Multi-Tenant Isolation & Document Ownership Enforcement
    // ----------------------------------------------------
    console.log("\n[6] Testing Multi-Tenant Isolation & Document Ownership Enforcement");

    // 6a. Org Alpha queries for Org Beta confidential data
    const leakCheckRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({
        question: "What is the chemical catalyst composition in BETA-SEC-999?",
      }),
    });
    assert.equal(leakCheckRes.status, 200);
    const leakCheckData = await leakCheckRes.json();
    assert.equal(leakCheckData.sources.some((s) => s.documentId === orgBetaDocId), false, "Org Beta document must NEVER appear in Org Alpha query");
    assert.equal(leakCheckData.sources.some((s) => s.filename === "Confidential_OrgB_Specs.pdf"), false);
    console.log("  ✅ PASS: Org Alpha query strictly isolated from Org Beta confidential documents");

    // 6b. Org Alpha attempts direct query with documentId belonging to Org Beta
    const forbiddenDocRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({
        question: "What does this document describe?",
        documentId: orgBetaDocId,
      }),
    });
    assert.equal(forbiddenDocRes.status, 403, "Accessing document of another organization must return HTTP 403");
    console.log("  ✅ PASS: Cross-organization document targeting rejected with HTTP 403 Forbidden");

    // 6c. Non-existent document targeting
    const missingDocRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({
        question: "Summarize this document",
        documentId: "non_existent_doc_id_12345",
      }),
    });
    assert.equal(missingDocRes.status, 404, "Targeting non-existent document must return HTTP 404");
    console.log("  ✅ PASS: Non-existent document query returns HTTP 404 Not Found");

    // 6d. Header spoofing attempt
    const spoofHeaderRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
        "x-organization-id": orgBetaId,
      },
      body: JSON.stringify({
        question: "What is the bearing limit?",
      }),
    });
    assert.equal(spoofHeaderRes.status, 403, "Mismatched x-organization-id header must return HTTP 403");
    console.log("  ✅ PASS: Cross-organization header spoofing blocked (HTTP 403 Forbidden)");

    // 6e. Unauthorized RAG request with strict auth header
    const unauthRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-require-auth": "true",
      },
      body: JSON.stringify({
        question: "What is the bearing limit?",
      }),
    });
    assert.equal(unauthRes.status, 401, "Missing token on protected RAG request must return HTTP 401");
    console.log("  ✅ PASS: Unauthenticated RAG request rejected with HTTP 401 Unauthorized");

    // ----------------------------------------------------
    // [7] Document Type Filtering (documentType = 'sop')
    // ----------------------------------------------------
    console.log("\n[7] Validating Document Type Filtering (documentType='sop')");
    const sopQueryEmbedding = await generateEmbedding("bearing temperature threshold limit");
    const sopResults = await searchSimilarChunks(sopQueryEmbedding, 10, undefined, {
      documentType: "sop",
      allowedDocumentIds: orgAlphaDocIds,
    });
    assert.ok(sopResults.length > 0, "SOP search must return results");
    for (const r of sopResults) {
      assert.equal(r.documentType, "sop", "All chunks returned must have documentType='sop'");
      assert.notEqual(r.filename, "Inspection_Report_Pump03.pdf", "Inspection reports must not appear in SOP query");
    }
    console.log(`  ✅ PASS: documentType='sop' filter strictly returned ${sopResults.length} SOP chunks`);

    // ----------------------------------------------------
    // [8] Automated Retrieval Evaluation & Quality Benchmarking
    // ----------------------------------------------------
    console.log("\n[8] Running Automated Retrieval Evaluation (Recall@3, Recall@5, Recall@10)");

    const benchmarkQuestions = [
      {
        question: "What was the bearing temperature of Pump-03?",
        expectedFilename: "Inspection_Report_Pump03.pdf",
      },
      {
        question: "What is the normal bearing temperature limit?",
        expectedFilename: "Maintenance_SOP.pdf",
      },
      {
        question: "Which SOP defines the bearing temperature threshold?",
        expectedFilename: "Maintenance_SOP.pdf",
      },
      {
        question: "Why is Pump-03 considered abnormal?",
        expectedFilename: "Inspection_Report_Pump03.pdf",
      },
      {
        question: "What information is available about Pump-07?",
        expectedFilename: "Inspection_Report_Pump07.pdf",
      },
      {
        question: "What is the emergency shutdown procedure in the plant?",
        expectedFilename: "Safety_SOP.pdf",
      },
    ];

    for (const item of benchmarkQuestions) {
      evaluationMetrics.totalEvaluations++;
      const tStart = Date.now();
      const qVec = await generateEmbedding(item.question);
      const topChunks = await searchSimilarChunks(qVec, 10, undefined, {
        allowedDocumentIds: orgAlphaDocIds,
      });
      const tRetrieval = Date.now() - tStart;
      evaluationMetrics.retrievalLatencies.push(tRetrieval);

      const top3 = topChunks.slice(0, 3).map((c) => c.filename);
      const top5 = topChunks.slice(0, 5).map((c) => c.filename);
      const top10 = topChunks.slice(0, 10).map((c) => c.filename);

      const hitTop3 = top3.includes(item.expectedFilename);
      const hitTop5 = top5.includes(item.expectedFilename);
      const hitTop10 = top10.includes(item.expectedFilename);

      if (hitTop3) evaluationMetrics.top3Hits++;
      if (hitTop5) evaluationMetrics.top5Hits++;
      if (hitTop10) evaluationMetrics.top10Hits++;

      console.log(
        `  • Q: "${item.question.slice(0, 45)}..." -> Expected: ${item.expectedFilename} | Top3: ${hitTop3 ? "✅" : "❌"} | Latency: ${tRetrieval}ms`
      );
    }

    const recallAt3 = (evaluationMetrics.top3Hits / evaluationMetrics.totalEvaluations) * 100;
    const recallAt5 = (evaluationMetrics.top5Hits / evaluationMetrics.totalEvaluations) * 100;
    const recallAt10 = (evaluationMetrics.top10Hits / evaluationMetrics.totalEvaluations) * 100;
    const avgRetrievalLatency = Math.round(
      evaluationMetrics.retrievalLatencies.reduce((a, b) => a + b, 0) / evaluationMetrics.retrievalLatencies.length
    );

    console.log(`\n  Retrieval Quality Summary:`);
    console.log(`    Recall@3:  ${recallAt3.toFixed(1)}%`);
    console.log(`    Recall@5:  ${recallAt5.toFixed(1)}%`);
    console.log(`    Recall@10: ${recallAt10.toFixed(1)}%`);
    console.log(`    Average Retrieval Latency: ${avgRetrievalLatency} ms`);
    assert.ok(recallAt3 >= 80, "Recall@3 must be at least 80%");
    assert.ok(recallAt10 >= 90, "Recall@10 must be at least 90%");

    // ----------------------------------------------------
    // [9] No-Answer Safety & Non-Fabrication Behavior
    // ----------------------------------------------------
    console.log("\n[9] Validating No-Answer Behavior on Absent Information");
    const absentQuestion = "What is the chemical composition of Pump-03 lubricant?";
    const absentRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({ question: absentQuestion }),
    });
    assert.equal(absentRes.status, 200);
    const absentData = await absentRes.json();
    const answerLower = absentData.answer.toLowerCase();
    const safelyRejected =
      answerLower.includes("not find relevant information") ||
      answerLower.includes("not found") ||
      answerLower.includes("does not contain") ||
      answerLower.includes("not mentioned") ||
      answerLower.includes("no information");
    assert.equal(safelyRejected, true, "Model must acknowledge missing information rather than fabricating values");
    console.log(`  ✅ PASS: Model safely reported absence of data: "${absentData.answer.slice(0, 65)}..."`);

    // ----------------------------------------------------
    // [10] Grounded Generation & Distinct Entity Disambiguation
    // ----------------------------------------------------
    console.log("\n[10] Validating Grounded Generation & Disambiguation (Pump-03 vs Pump-07)");
    const tRagStart = Date.now();
    const p3Res = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({ question: "What was the bearing temperature of Pump-03?" }),
    });
    assert.equal(p3Res.status, 200);
    const p3Data = await p3Res.json();
    const ragMs = Date.now() - tRagStart;
    evaluationMetrics.ragTotalLatencies.push(ragMs);

    assert.ok(p3Data.answer.includes("92"), "Answer must cite 92 degrees C for Pump-03");
    assert.ok(p3Data.sources.length > 0, "Must return sources");
    assert.equal(p3Data.sources[0].filename, "Inspection_Report_Pump03.pdf");
    console.log(`  ✅ PASS: Grounded answer cites 92°C with source ${p3Data.sources[0].filename} (Page ${p3Data.sources[0].page})`);

    const p7Res = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenAlpha}`,
      },
      body: JSON.stringify({ question: "What was the bearing temperature of Pump-07?" }),
    });
    assert.equal(p7Res.status, 200);
    const p7Data = await p7Res.json();
    assert.ok(p7Data.answer.includes("71"), "Answer must cite 71 degrees C for Pump-07");
    assert.equal(p7Data.sources[0].filename, "Inspection_Report_Pump07.pdf");
    console.log(`  ✅ PASS: Grounded answer cites 71°C for Pump-07 without confounding with Pump-03`);

    // ----------------------------------------------------
    // [11] Citation Validation & Anti-Hallucination Integrity
    // ----------------------------------------------------
    console.log("\n[11] Validating Citation Integrity & Rejecting Fabrications");
    const retrievedMockEvidence = [
      { documentId: orgAlphaDocIds[0], filename: "Maintenance_SOP.pdf", page: 1, chunkIndex: 0, score: 0.85 },
      { documentId: orgAlphaDocIds[2], filename: "Inspection_Report_Pump03.pdf", page: 1, chunkIndex: 0, score: 0.91 },
    ];

    // Valid citation
    const validCheck = validateRagCitation(
      { documentId: orgAlphaDocIds[0], filename: "Maintenance_SOP.pdf", page: 1 },
      retrievedMockEvidence
    );
    assert.equal(validCheck.isValid, true);
    assert.equal(validCheck.status, "VALID");
    console.log("  ✅ PASS: Authentic citation correctly verified");

    // Fabricated page
    const badPageCheck = validateRagCitation(
      { documentId: orgAlphaDocIds[0], filename: "Maintenance_SOP.pdf", page: 99 },
      retrievedMockEvidence
    );
    assert.equal(badPageCheck.isValid, false);
    assert.equal(badPageCheck.status, "INVALID");
    console.log("  ✅ PASS: Fabricated page citation (Page 99) rejected");

    // Fabricated document
    const badDocCheck = validateRagCitation(
      { filename: "Secret_Unindexed_Manual.pdf", page: 1 },
      retrievedMockEvidence
    );
    assert.equal(badDocCheck.isValid, false);
    assert.equal(badDocCheck.status, "INVALID");
    console.log("  ✅ PASS: Hallucinated document citation rejected");

    // ----------------------------------------------------
    // [12] Evidence Traceability & Chain Audit
    // ----------------------------------------------------
    console.log("\n[12] Auditing End-to-End Evidence Traceability Chain");
    // Verify chain: Answer -> Source -> Qdrant chunk -> Database document -> Page
    const primarySource = p3Data.sources[0];
    assert.ok(primarySource.documentId, "Source must contain documentId");
    assert.ok(primarySource.filename, "Source must contain filename");
    assert.ok(primarySource.page >= 1, "Source must contain valid page number");

    const dbDoc = await query("SELECT id, organization_id, filename FROM documents WHERE id = $1", [
      primarySource.documentId,
    ]);
    assert.equal(dbDoc.rows.length, 1);
    assert.equal(dbDoc.rows[0].organization_id, orgAlphaId);
    console.log(`  ✅ PASS: Traceable chain verified (Answer -> ${primarySource.filename} -> DB Doc ${primarySource.documentId} -> Org ${orgAlphaId.slice(0, 8)})`);

    console.log("\n==================================================");
    console.log("✅ ALL PHASE 4 RAG HARDENING & RETRIEVAL TESTS PASSED");
    console.log("==================================================");
    console.log("Evaluation Results:", {
      recallAt3: `${recallAt3.toFixed(1)}%`,
      recallAt5: `${recallAt5.toFixed(1)}%`,
      recallAt10: `${recallAt10.toFixed(1)}%`,
      avgRetrievalLatencyMs: avgRetrievalLatency,
      avgTotalRagLatencyMs: evaluationMetrics.ragTotalLatencies[0] || 0,
    });
  } finally {
    server.close();

    // Clean up test documents in DB
    for (const docId of cleanupDocIds) {
      try {
        await query("DELETE FROM documents WHERE id = $1", [docId]);
      } catch {}
    }
    // Clean up users
    for (const uId of cleanupUserIds) {
      try {
        await query("DELETE FROM users WHERE id = $1", [uId]);
      } catch {}
    }
    // Clean up conversations and messages
    for (const oId of cleanupOrgIds) {
      try {
        await query("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = $1)", [oId]);
        await query("DELETE FROM conversations WHERE organization_id = $1", [oId]);
      } catch {}
    }
    // Clean up orgs
    for (const oId of cleanupOrgIds) {
      try {
        await query("DELETE FROM organizations WHERE id = $1", [oId]);
      } catch {}
    }
    // Clean up disk files
    for (const fPath of cleanupFilePaths) {
      try {
        if (fs.existsSync(fPath)) fs.unlinkSync(fPath);
      } catch {}
    }
  }
}

runRagHardeningTests().catch((err) => {
  console.error("RAG hardening test failed:", err);
  process.exit(1);
});
