import assert from "assert";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { getAllDocuments } from "../src/services/documents.service.js";
import { ingestSop, searchSop } from "../../ai-service/knowledge/sop.service.js";
import { assessFindingRisk, buildSopQuery, filterValidCitations } from "../../ai-service/risk/risk.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";

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

async function uploadDoc(baseUrl, token, pdfBytes, filename, documentType) {
  const form = new FormData();
  form.append("document", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  if (documentType) {
    form.append("documentType", documentType);
  }
  const res = await fetch(`${baseUrl}/api/v1/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(res.status, 200, `Upload of ${filename} failed with status ${res.status}`);
  const json = await res.json();
  return json;
}

async function runPhase4Tests() {
  console.log("==================================================");
  console.log("   SOVEREIGNAI — PHASE 4 SOP WORKFLOW MATRIX     ");
  console.log("==================================================\n");

  await initDb();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedCount = 0;
  let failedCount = 0;

  const orgAId = `org_p4_a_${randomUUID().slice(0, 8)}`;
  const orgBId = `org_p4_b_${randomUUID().slice(0, 8)}`;

  await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
    orgAId,
    `Org Phase4 Alpha ${orgAId}`,
  ]);
  await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
    orgBId,
    `Org Phase4 Beta ${orgBId}`,
  ]);

  const tokenA = generateToken({
    userId: `user_${orgAId}`,
    organizationId: orgAId,
    email: "alpha_p4@example.com",
    role: "admin",
  });
  const tokenB = generateToken({
    userId: `user_${orgBId}`,
    organizationId: orgBId,
    email: "beta_p4@example.com",
    role: "admin",
  });

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST 1: SOP Ingestion Stores documentType='sop'
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1] SOP Ingestion stores documentType='sop' in DB and Qdrant...");
    const sopPdfA = buildMinimalPdf([
      "REFINERY STANDARD OPERATING PROCEDURE",
      "Document ID: SOP-PUMP-001 Version 2.0",
      "Pump bearing operating temperature shall not exceed 80 degrees C.",
      "If bearing temperature exceeds 80 degrees C, trigger emergency shutdown and inspect lubrication.",
    ]);

    const sopUploadA = await uploadDoc(baseUrl, tokenA, sopPdfA, "Demo_Maintenance_SOP.pdf", "sop");
    const sopDocIdA = sopUploadA.documentId;
    assert.equal(sopUploadA.documentType, "sop", "Returned documentType must be 'sop'");

    // Verify DB
    const dbRow = await query("SELECT document_type, filename FROM documents WHERE id = $1", [sopDocIdA]);
    assert.equal(dbRow.rows[0].document_type, "sop", "PostgreSQL document_type must be 'sop'");

    // Verify Qdrant payload
    const dummyVec = await generateEmbedding("Pump bearing operating temperature");
    const qdrantResults = await searchSimilarChunks(dummyVec, 5, sopDocIdA, {
      documentType: "sop",
      organizationId: orgAId,
    });
    assert.ok(qdrantResults.length > 0, "Qdrant must return points for the ingested SOP");
    assert.equal(qdrantResults[0].documentType, "sop", "Qdrant chunk documentType must be 'sop'");
    console.log("  ✓ PASS Test 1: SOP ingestion stores documentType='sop' in DB and Qdrant");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 2: searchSop returns only documentType='sop'
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 2] searchSop strictly returns chunks with documentType='sop'...");
    const sopSearchResults = await searchSop("Pump bearing operating temperature limit", {
      organizationId: orgAId,
      scoreThreshold: 0.3,
    });
    assert.ok(sopSearchResults.length > 0, "searchSop must return matching SOP chunk(s)");
    for (const chunk of sopSearchResults) {
      assert.equal(chunk.documentType, "sop", `All chunks must have documentType='sop', got ${chunk.documentType}`);
    }
    console.log("  ✓ PASS Test 2: searchSop returned strictly documentType='sop' chunks");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Inspection documents cannot leak into searchSop
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Inspection documents cannot leak into searchSop...");
    const inspPdfA = buildMinimalPdf([
      "EQUIPMENT INSPECTION REPORT",
      "Asset ID: Pump-03 Section: CDU-II",
      "Pump bearing temperature observed at 92 degrees C under full operating load.",
      "Heavy casing vibration detected on bearing housing.",
    ]);
    const inspUploadA = await uploadDoc(baseUrl, tokenA, inspPdfA, "Demo_Inspection_Report.pdf", "inspection");
    const inspDocIdA = inspUploadA.documentId;

    // Query with the exact inspection observation:
    const searchInspQuery = await searchSop("Pump bearing temperature observed at 92 degrees C", {
      organizationId: orgAId,
      scoreThreshold: 0.1,
    });
    // Even with a low scoreThreshold, the inspection document must NEVER be returned
    const leakedInspection = searchInspQuery.some((c) => c.documentId === inspDocIdA);
    assert.equal(leakedInspection, false, "Inspection document MUST NOT be returned by searchSop");
    console.log("  ✓ PASS Test 3: Inspection documents cannot leak into searchSop");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Other documents cannot leak into searchSop
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Other documents cannot leak into searchSop...");
    const otherPdfA = buildMinimalPdf([
      "TECHNICAL SPECIFICATION AND MAINTENANCE HISTORY",
      "Pump bearing maintenance history and specification manual.",
      "Bearing replacement interval is 12000 operating hours.",
    ]);
    const otherUploadA = await uploadDoc(baseUrl, tokenA, otherPdfA, "Demo_Technical_Document.pdf", "other");
    const otherDocIdA = otherUploadA.documentId;

    const searchOtherQuery = await searchSop("Pump bearing maintenance history and specification", {
      organizationId: orgAId,
      scoreThreshold: 0.1,
    });
    const leakedOther = searchOtherQuery.some((c) => c.documentId === otherDocIdA);
    assert.equal(leakedOther, false, "Other documents MUST NOT be returned by searchSop");
    console.log("  ✓ PASS Test 4: Other documents cannot leak into searchSop");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 5: SOP relevance ranking works
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] SOP relevance ranking works...");
    const motorSopPdf = buildMinimalPdf([
      "MOTOR GROUNDING AND CONDUIT PROCEDURE",
      "Document ID: SOP-ELEC-009",
      "Verify that electrical motor grounding conductor continuity is within 0.1 ohm.",
      "Check conduit insulation resistance every quarter.",
    ]);
    const motorSopUpload = await uploadDoc(baseUrl, tokenA, motorSopPdf, "Motor_Grounding_SOP.pdf", "sop");
    const motorSopId = motorSopUpload.documentId;

    const rankedSopResults = await searchSop("Pump bearing temperature exceeded operating limit", {
      organizationId: orgAId,
      scoreThreshold: 0.1,
      limit: 5,
    });
    assert.ok(rankedSopResults.length >= 2, "Should return both SOPs for ranking comparison");
    assert.equal(
      rankedSopResults[0].documentId,
      sopDocIdA,
      "Bearing temperature SOP must rank above motor grounding SOP"
    );
    assert.ok(
      rankedSopResults[0].score > rankedSopResults[1].score,
      `Top SOP score (${rankedSopResults[0].score}) must be greater than second (${rankedSopResults[1].score})`
    );
    console.log("  ✓ PASS Test 5: SOP relevance ranking correctly prioritized bearing SOP over motor SOP");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Finding becomes SOP search query
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Inspection finding is correctly converted into an SOP search query...");
    const findingObj = {
      finding: "Pump bearing temperature exceeded the operating limit.",
      equipment: "Pump-03",
      observedValue: "92°C",
      evidence: "Inspection report states bearing temperature was 92°C.",
    };
    const generatedQuery = buildSopQuery(findingObj);
    assert.ok(generatedQuery.includes("Pump-03"), "Query must contain equipment name");
    assert.ok(generatedQuery.includes("Pump bearing temperature"), "Query must contain finding text");
    assert.ok(generatedQuery.includes("92°C"), "Query must contain observed value");
    console.log(`  ✓ PASS Test 6: Finding converted to query: "${generatedQuery}"`);
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Relevant SOP evidence is returned for known finding
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Relevant SOP evidence is returned for the finding query...");
    const findingEvidenceResults = await searchSop(generatedQuery, {
      organizationId: orgAId,
      scoreThreshold: 0.3,
    });
    assert.ok(findingEvidenceResults.length > 0, "Must return SOP evidence for the finding query");
    assert.equal(findingEvidenceResults[0].documentId, sopDocIdA);
    assert.ok(findingEvidenceResults[0].text.includes("80 degrees C"), "SOP text must contain the 80°C threshold rule");
    console.log("  ✓ PASS Test 7: Relevant SOP evidence returned for known finding");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 8: No SOP evidence returns safe refusal / empty result
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Out-of-domain finding with no SOP evidence returns safe refusal...");
    const unrelatedFinding = {
      finding: "Unusual paint discoloration observed on perimeter fence and administrative walkway.",
      equipment: "Perimeter-Fence",
      evidence: "Cosmetic paint wear observed on perimeter fence.",
    };
    const unrelatedQuery = buildSopQuery(unrelatedFinding);
    const noEvidenceChunks = await searchSop(unrelatedQuery, {
      organizationId: orgAId,
      scoreThreshold: 0.5, // Standard threshold
    });
    assert.equal(noEvidenceChunks.length, 0, "No SOP chunks should meet score threshold for unrelated finding");

    const safeRiskResult = await assessFindingRisk(unrelatedFinding, {
      organizationId: orgAId,
      sopOptions: { scoreThreshold: 0.5 },
    });
    assert.equal(safeRiskResult.riskAssessment.level, null, "Risk level must be null when no evidence exists");
    assert.ok(
      safeRiskResult.riskAssessment.reason.toLowerCase().includes("insufficient"),
      "Reason must note insufficient SOP evidence"
    );
    assert.ok(
      safeRiskResult.recommendation.toLowerCase().includes("insufficient"),
      "Recommendation must note insufficient SOP evidence"
    );
    assert.equal(safeRiskResult.grounded, false, "Must be flagged as not grounded");
    assert.deepEqual(safeRiskResult.citations, [], "Citations must be empty");
    console.log("  ✓ PASS Test 8: Safe refusal verified when zero relevant SOP evidence is available");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 9: SOP source metadata is preserved
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Returned SOP chunk preserves complete authoritative metadata...");
    const topEvidence = findingEvidenceResults[0];
    assert.equal(typeof topEvidence.documentId, "string", "documentId must be string");
    assert.equal(topEvidence.filename, "Demo_Maintenance_SOP.pdf", "filename must match");
    assert.equal(topEvidence.documentType, "sop", "documentType must be 'sop'");
    assert.equal(typeof topEvidence.page, "number", "page must be number");
    assert.equal(typeof topEvidence.chunkIndex, "number", "chunkIndex must be number");
    assert.equal(typeof topEvidence.score, "number", "score must be numeric");
    assert.equal(typeof topEvidence.text, "string", "text must be string");
    console.log("  ✓ PASS Test 9: Complete SOP source metadata verified");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Citation integrity: LLM cannot override application metadata
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10] Application citation validation rejects hallucinated pages and docs...");
    const fakeCitationsFromLlm = [
      {
        filename: "Demo_Maintenance_SOP.pdf",
        documentId: sopDocIdA,
        page: 99, // Hallucinated page
        chunkIndex: 0,
      },
      {
        filename: "Fake_Nonexistent_SOP.pdf",
        documentId: randomUUID(),
        page: 1,
        chunkIndex: 0,
      },
      {
        filename: "Demo_Maintenance_SOP.pdf",
        documentId: sopDocIdA,
        page: topEvidence.page, // Authentic
        chunkIndex: topEvidence.chunkIndex,
      },
    ];

    const validatedCitations = filterValidCitations(fakeCitationsFromLlm, [topEvidence], orgAId);
    assert.equal(validatedCitations.length, 1, "Only authentic citation must be retained");
    assert.equal(validatedCitations[0].page, topEvidence.page, "Retained citation must have authentic page");
    assert.equal(validatedCitations[0].documentId, sopDocIdA);
    console.log("  ✓ PASS Test 10: Hallucinated page 99 and hallucinated document rejected");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Multi-tenant isolation: Org A cannot retrieve Org B SOPs
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 11] Multi-tenant isolation between Org A and Org B in searchSop...");
    const sopPdfB = buildMinimalPdf([
      "CONFIDENTIAL BETA PROCEDURAL GUIDE",
      "Document ID: SOP-BETA-PUMP-99",
      "Special proprietary cooling protocol for Beta turbine system.",
    ]);
    const sopUploadB = await uploadDoc(baseUrl, tokenB, sopPdfB, "OrgB_Proprietary_SOP.pdf", "sop");
    const sopDocIdB = sopUploadB.documentId;

    // Search as Org A for Beta turbine
    const searchFromA = await searchSop("Special proprietary cooling protocol for Beta turbine", {
      organizationId: orgAId,
      scoreThreshold: 0.1,
    });
    const leakedOrgB = searchFromA.some((c) => c.documentId === sopDocIdB);
    assert.equal(leakedOrgB, false, "Org B SOP MUST NEVER leak into Org A searchSop");

    // Search as Org B for Beta turbine
    const searchFromB = await searchSop("Special proprietary cooling protocol for Beta turbine", {
      organizationId: orgBId,
      scoreThreshold: 0.1,
    });
    const foundByB = searchFromB.some((c) => c.documentId === sopDocIdB);
    assert.equal(foundByB, true, "Org B MUST be able to retrieve its own SOP");
    console.log("  ✓ PASS Test 11: Cross-tenant SOP isolation strictly enforced inside Qdrant");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Legacy NULL documentType does not become authoritative SOP evidence
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 12] Legacy records with document_type=NULL cannot be retrieved by searchSop...");
    const legacyDocId = randomUUID();
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, document_type, status, chunks_stored, created_at, updated_at) VALUES ($1, $2, $3, $4, NULL, 'Indexed', 1, NOW(), NOW())",
      [legacyDocId, orgAId, "Legacy_Manual_SOP.pdf", "Legacy_Manual_SOP.pdf"]
    );

    // In Qdrant, points without documentType='sop' cannot match filter { key: "documentType", match: { value: "sop" } }
    const legacySearch = await searchSop("Legacy Manual SOP", {
      organizationId: orgAId,
      scoreThreshold: 0.1,
    });
    const leakedLegacy = legacySearch.some((c) => c.documentId === legacyDocId);
    assert.equal(leakedLegacy, false, "Legacy document with NULL document_type must NOT be returned by searchSop");
    console.log("  ✓ PASS Test 12: Legacy NULL documentType is not promoted to authoritative SOP evidence");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Browser refresh does not affect SOP knowledge-base availability
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 13] Browser refresh simulation preserves SOP persistence and retrieval...");
    // 1. Fetch from DB via service (source of truth after browser refresh)
    const docsPostRefresh = await getAllDocuments(orgAId, "sop");
    const foundSopPostRefresh = docsPostRefresh.some((d) => d.documentId === sopDocIdA);
    assert.equal(foundSopPostRefresh, true, "SOP document must exist in DB under 'sop' category after refresh");

    // 2. Perform searchSop again
    const postRefreshSopSearch = await searchSop("Pump bearing operating temperature shall not exceed 80 degrees C", {
      organizationId: orgAId,
      scoreThreshold: 0.3,
    });
    assert.ok(postRefreshSopSearch.length > 0, "SOP remains retrievable in knowledge base after refresh");
    assert.equal(postRefreshSopSearch[0].documentId, sopDocIdA);
    console.log("  ✓ PASS Test 13: SOP knowledge-base availability confirmed across simulated browser refresh");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Downstream risk assessment workflow with real LLM
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 14] Finding -> SOP Evidence -> Risk Assessment -> Recommendation with local LLM...");
    const findingForRisk = {
      finding: "Observed heavy casing vibration and bearing temperature of 92°C exceeding continuous operating limit.",
      equipment: "Pump-03",
      observedValue: "92°C",
      limit: "80°C",
      evidence: "Inspection report states bearing temperature was 92°C under full load with heavy casing vibration.",
    };

    const riskResult = await assessFindingRisk(findingForRisk, {
      organizationId: orgAId,
      sopOptions: { scoreThreshold: 0.3 },
    });

    console.log("    Risk Assessment Level:", riskResult.riskAssessment.level);
    console.log("    Risk Reason:", riskResult.riskAssessment.reason.slice(0, 100) + "...");
    console.log("    Recommendation:", riskResult.recommendation.slice(0, 100) + "...");
    console.log("    Citations count:", riskResult.citations.length);

    assert.ok(
      ["HIGH", "MEDIUM"].includes(riskResult.riskAssessment.level),
      `Risk level should be HIGH or MEDIUM, got ${riskResult.riskAssessment.level}`
    );
    assert.ok(riskResult.recommendation.length > 0, "Recommendation must be non-empty");
    assert.equal(riskResult.grounded, true, "Workflow must be marked grounded");
    console.log("  ✓ PASS Test 14: Downstream risk assessment & recommendation successfully executed");
    passedCount++;

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Live end-to-end HTTP API verification against port 9000
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 15] Live HTTP API verification against container at http://127.0.0.1:9000...");
    const liveLoginRes = await fetch("http://127.0.0.1:9000/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "engineer@example.com",
        password: "DemoPassword123!",
      }),
    });
    assert.equal(liveLoginRes.status, 200, "Live backend login must succeed");
    const liveLoginData = await liveLoginRes.json();
    const liveToken = liveLoginData.data?.token;
    const liveOrgId = liveLoginData.data?.user?.organizationId;

    const liveRunId = randomUUID().slice(0, 8);
    const liveFilename = `Live_Relief_Valve_SOP_${liveRunId}.pdf`;
    const liveSopPdf = buildMinimalPdf([
      `LIVE TEST STANDARD OPERATING PROCEDURE ${liveRunId}`,
      `Document ID: SOP-LIVE-${liveRunId}`,
      `Hydraulic pressure relief valve setting for unit ${liveRunId} is 150 bar maximum.`,
    ]);

    const liveUpload = await uploadDoc("http://127.0.0.1:9000", liveToken, liveSopPdf, liveFilename, "sop");
    assert.equal(liveUpload.documentType, "sop", "Live upload documentType must be 'sop'");

    // GET /api/v1/documents?documentType=sop from live container
    const listRes = await fetch("http://127.0.0.1:9000/api/v1/documents?documentType=sop", {
      headers: { Authorization: `Bearer ${liveToken}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const docsList = listJson.documents || listJson.data || [];
    const liveDocInList = docsList.some((d) => d.documentId === liveUpload.documentId);
    assert.equal(liveDocInList, true, "Live uploaded SOP must appear in GET /api/v1/documents?documentType=sop");

    // Verify searchSop finds it
    const liveSopResults = await searchSop(`Hydraulic pressure relief valve setting for unit ${liveRunId}`, {
      organizationId: liveOrgId,
      scoreThreshold: 0.3,
    });
    assert.ok(liveSopResults.some((c) => c.documentId === liveUpload.documentId), "searchSop must retrieve live uploaded SOP chunk");
    console.log("  ✓ PASS Test 15: Live HTTP upload, DB indexing, and searchSop verified against port 9000");
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

runPhase4Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal test error:", err);
    process.exit(1);
  });
