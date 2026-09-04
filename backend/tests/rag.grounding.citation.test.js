import assert from "node:assert";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { upsertChunks } from "../../ai-service/vectorstore/qdrant.service.js";
import {
  answerQuestion,
  validateRagCitation,
} from "../../ai-service/rag/rag.service.js";
import { assessFindingRisk } from "../../ai-service/risk/risk.service.js";

async function runPhase5Suite() {
  console.log("==================================================");
  console.log("Phase 5: RAG Quality, Grounding Guardrails & Citations Suite");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];

  try {
    // ----------------------------------------------------
    // Setup Organizations & Test Users
    // ----------------------------------------------------
    const orgAId = randomUUID();
    const orgBId = randomUUID();
    cleanupOrgIds.push(orgAId, orgBId);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAId, `Refinery Corp A ${orgAId.slice(0, 8)}`]);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBId, `Chemicals Corp B ${orgBId.slice(0, 8)}`]);

    const userAId = randomUUID();
    cleanupUserIds.push(userAId);
    await query(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [userAId, orgAId, "Engineer A", `eng_a_${orgAId.slice(0, 6)}@company-a.com`, "hash_a", "engineer"]
    );
    const tokenA = generateToken({
      userId: userAId,
      organizationId: orgAId,
      email: `eng_a_${orgAId.slice(0, 6)}@company-a.com`,
      role: "engineer",
    });

    const userBId = randomUUID();
    cleanupUserIds.push(userBId);
    await query(
      "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [userBId, orgBId, "Engineer B", `eng_b_${orgBId.slice(0, 6)}@company-b.com`, "hash_b", "engineer"]
    );

    // ----------------------------------------------------
    // Seed Company A Knowledge Base
    // ----------------------------------------------------
    // Doc 1: Inspection Report
    const docA1Id = randomUUID();
    cleanupDocIds.push(docA1Id);
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored) VALUES ($1, $2, $3, $4, $5, $6)",
      [docA1Id, orgAId, `${docA1Id}.pdf`, "Inspection_Report_Pump03.pdf", "Indexed", 2]
    );

    const docA1Chunks = [
      {
        documentId: docA1Id,
        filename: "Inspection_Report_Pump03.pdf",
        documentType: "inspection",
        organizationId: orgAId,
        page: 1,
        chunkIndex: 0,
        text: "EQUIPMENT INSPECTION REPORT: Process Pump-03 observed bearing temperature was 92 °C during full operating load. This exceeds normal range.",
      },
      {
        documentId: docA1Id,
        filename: "Inspection_Report_Pump03.pdf",
        documentType: "inspection",
        organizationId: orgAId,
        page: 2,
        chunkIndex: 1,
        text: "PUMP-03 ROOT CAUSE ANALYSIS: Root cause of Pump-03 abnormal vibration was determined to be mechanical seal misalignment and bearing cage fatigue.",
      },
    ];

    // Doc 2: Maintenance SOP
    const docA2Id = randomUUID();
    cleanupDocIds.push(docA2Id);
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored) VALUES ($1, $2, $3, $4, $5, $6)",
      [docA2Id, orgAId, `${docA2Id}.pdf`, "Maintenance_SOP_001.pdf", "Indexed", 1]
    );

    const docA2Chunks = [
      {
        documentId: docA2Id,
        filename: "Maintenance_SOP_001.pdf",
        documentType: "sop",
        organizationId: orgAId,
        page: 4,
        chunkIndex: 0,
        text: "STANDARD OPERATING PROCEDURE: Maximum allowable bearing operating temperature for rotating equipment is 80 °C. Temperatures exceeding 80 °C mandate immediate shutdown and lubrication check.",
      },
    ];

    // Seed Company B Confidential Document (Highly similar semantic match)
    const docB1Id = randomUUID();
    cleanupDocIds.push(docB1Id);
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored) VALUES ($1, $2, $3, $4, $5, $6)",
      [docB1Id, orgBId, `${docB1Id}.pdf`, "Secret_Beta_Financials.pdf", "Indexed", 1]
    );

    const docB1Chunks = [
      {
        documentId: docB1Id,
        filename: "Secret_Beta_Financials.pdf",
        documentType: "inspection",
        organizationId: orgBId,
        page: 1,
        chunkIndex: 0,
        text: "CONFIDENTIAL BETA DATA: Contractor invoice amount for maintenance overhaul was exactly $4,250,000 approved by Beta Executive Board.",
      },
    ];

    // Upsert vectors to Qdrant
    const allChunksToUpsert = [...docA1Chunks, ...docA2Chunks, ...docB1Chunks];
    const pointsWithVectors = [];
    for (const ch of allChunksToUpsert) {
      const vec = await generateEmbedding(ch.text);
      pointsWithVectors.push({
        ...ch,
        pageStartOffset: 0,
        pageEndOffset: ch.text.length,
        vector: vec,
      });
    }
    await upsertChunks(pointsWithVectors);

    // ----------------------------------------------------
    // TEST 1 — Directly Supported Question
    // ----------------------------------------------------
    console.log("\n[TEST 1] Directly supported question");
    const test1Res = await answerQuestion("What was the recorded bearing temperature of Pump-03?", {
      organizationId: orgAId,
      generateAnswer: async (prompt) => {
        assert.ok(prompt.includes("92 °C"), "Prompt must contain retrieved 92 °C evidence");
        return "The recorded bearing temperature of Pump-03 was 92 °C. [Source: Inspection_Report_Pump03.pdf, Page: 1]";
      },
    });

    assert.equal(test1Res.grounded, true, "Answer must be marked grounded");
    assert.ok(test1Res.answer.includes("92 °C"));
    assert.ok(test1Res.sources.length > 0, "Must return sources");
    assert.equal(test1Res.sources[0].filename, "Inspection_Report_Pump03.pdf");
    console.log("  ✅ PASS: TEST 1 — Directly supported question returned grounded answer");

    // ----------------------------------------------------
    // TEST 2 — Supported Question with Citation
    // ----------------------------------------------------
    console.log("\n[TEST 2] Supported question with citation metadata");
    const source0 = test1Res.sources[0];
    assert.equal(source0.filename, "Inspection_Report_Pump03.pdf");
    assert.equal(source0.page, 1);
    assert.equal(source0.documentId, docA1Id);
    assert.equal(source0.chunkIndex, 0);
    assert.equal(source0.organizationId, orgAId);
    console.log(`  ✅ PASS: TEST 2 — Valid filename (${source0.filename}), page (${source0.page}), documentId (${source0.documentId.slice(0, 8)})`);

    // ----------------------------------------------------
    // TEST 3 — Unsupported Question (Grounded Refusal)
    // ----------------------------------------------------
    console.log("\n[TEST 3] Unsupported question");
    let llmCalledTest3 = false;
    const test3Res = await answerQuestion("What was the contractor invoice amount?", {
      organizationId: orgAId, // Company A does not have invoice data
      generateAnswer: async () => {
        llmCalledTest3 = true;
        return "The invoice was $100.";
      },
    });

    assert.equal(llmCalledTest3, false, "LLM must NOT be called for unsupported question when evidence is absent");
    assert.equal(test3Res.grounded, false, "Must be marked grounded: false");
    assert.equal(test3Res.sources.length, 0, "Sources must be empty");
    assert.equal(test3Res.reason, "insufficient_retrieval_evidence");
    assert.ok(
      test3Res.answer.includes("sufficient relevant information") ||
      test3Res.answer.includes("not find relevant information")
    );
    console.log("  ✅ PASS: TEST 3 — Grounded refusal returned; LLM not called");

    // ----------------------------------------------------
    // TEST 4 — Low Similarity Retrieval Rejection
    // ----------------------------------------------------
    console.log("\n[TEST 4] Low similarity retrieval rejected by evidence gate");
    let llmCalledTest4 = false;
    const test4Res = await answerQuestion("Who is the prime minister of Mars?", {
      organizationId: orgAId,
      scoreThreshold: 0.38,
      generateAnswer: async () => {
        llmCalledTest4 = true;
        return "Alien PM";
      },
    });

    assert.equal(llmCalledTest4, false, "Evidence gate must block low similarity before LLM");
    assert.equal(test4Res.grounded, false);
    assert.equal(test4Res.sources.length, 0);
    console.log("  ✅ PASS: TEST 4 — Evidence gate rejected low similarity retrieval");

    // ----------------------------------------------------
    // TEST 5 — Partial Evidence Handling
    // ----------------------------------------------------
    console.log("\n[TEST 5] Partial evidence handling");
    const test5Res = await answerQuestion("What was the exact root cause of Pump-03 and who approved the repair?", {
      organizationId: orgAId,
      generateAnswer: async (prompt) => {
        assert.ok(prompt.includes("CRITICAL RULES"));
        assert.ok(prompt.includes("If only partial evidence is available, answer ONLY what is directly supported"));
        return "The root cause of Pump-03 was mechanical seal misalignment and bearing cage fatigue. [Source: Inspection_Report_Pump03.pdf, Page: 2]. Information regarding who approved the repair was not found in the provided documents.";
      },
    });

    assert.equal(test5Res.grounded, true);
    assert.ok(test5Res.answer.includes("mechanical seal misalignment"));
    assert.ok(test5Res.answer.toLowerCase().includes("not found"));
    console.log("  ✅ PASS: TEST 5 — Model answers only supported facts and explicitly states missing approval details");

    // ----------------------------------------------------
    // TEST 6 — Citation References Unknown Document
    // ----------------------------------------------------
    console.log("\n[TEST 6] Citation references unknown document");
    const retrievedMock = [
      { documentId: docA1Id, filename: "Inspection_Report_Pump03.pdf", page: 1, chunkIndex: 0, score: 0.85, organizationId: orgAId },
      { documentId: docA2Id, filename: "Maintenance_SOP_001.pdf", page: 4, chunkIndex: 0, score: 0.78, organizationId: orgAId },
    ];

    const unknownDocCheck = validateRagCitation(
      { filename: "Non_Existent_Report.pdf", page: 1 },
      retrievedMock,
      orgAId
    );
    assert.equal(unknownDocCheck.isValid, false);
    assert.equal(unknownDocCheck.status, "INVALID");
    assert.ok(unknownDocCheck.reason.includes("not in retrieved evidence"));
    console.log("  ✅ PASS: TEST 6 — Citation referencing unknown document strictly rejected");

    // ----------------------------------------------------
    // TEST 7 — Citation References Wrong Page
    // ----------------------------------------------------
    console.log("\n[TEST 7] Citation references wrong page");
    const wrongPageCheck = validateRagCitation(
      { filename: "Inspection_Report_Pump03.pdf", page: 99 },
      retrievedMock,
      orgAId
    );
    assert.equal(wrongPageCheck.isValid, false);
    assert.equal(wrongPageCheck.status, "INVALID");
    assert.ok(wrongPageCheck.reason.includes("page 99"));
    console.log("  ✅ PASS: TEST 7 — Citation referencing wrong page rejected");

    // ----------------------------------------------------
    // TEST 8 — Citation References Chunk Not in Context
    // ----------------------------------------------------
    console.log("\n[TEST 8] Citation references chunk not in context");
    const wrongChunkCheck = validateRagCitation(
      { filename: "Inspection_Report_Pump03.pdf", page: 1, chunkIndex: 999 },
      retrievedMock,
      orgAId
    );
    assert.equal(wrongChunkCheck.isValid, false);
    assert.equal(wrongChunkCheck.status, "INVALID");
    assert.ok(wrongChunkCheck.reason.includes("chunk index"));
    console.log("  ✅ PASS: TEST 8 — Citation referencing non-existent chunk index rejected");

    // ----------------------------------------------------
    // TEST 9 — Company A Query with Company B Highly Similar Content
    // ----------------------------------------------------
    console.log("\n[TEST 9] Company A query with Company B highly similar content");
    // Company B has exact invoice data. Company A asks for contractor invoice.
    const crossTenantRAG = await answerQuestion("What was the contractor invoice amount for maintenance overhaul?", {
      organizationId: orgAId,
    });

    assert.equal(crossTenantRAG.grounded, false, "Company A must receive grounded refusal");
    assert.equal(crossTenantRAG.sources.length, 0, "No Company B chunks can be returned to Company A");
    const leakedDoc = crossTenantRAG.sources.some((s) => s.documentId === docB1Id || s.filename === "Secret_Beta_Financials.pdf");
    assert.equal(leakedDoc, false, "Zero Company B evidence in Company A RAG");
    console.log("  ✅ PASS: TEST 9 — Company B confidential content completely shielded from Company A");

    // ----------------------------------------------------
    // TEST 10 — Inspection Finding + Company A SOP (Risk Assessment)
    // ----------------------------------------------------
    console.log("\n[TEST 10] Inspection finding + Company A SOP");
    const sampleFinding = {
      finding: "Pump-03 bearing temperature was measured at 92 °C",
      equipment: "Pump-03",
      observedValue: "92 °C",
      limit: "80 °C",
      severity: "ABNORMAL",
      evidence: "Bearing temperature 92 °C exceeds 80 °C limit.",
    };

    const riskResult = await assessFindingRisk(sampleFinding, {
      organizationId: orgAId,
      generateAnswer: async (prompt) => {
        assert.ok(prompt.includes("Maintenance_SOP_001.pdf"));
        return JSON.stringify({
          riskAssessment: {
            level: "HIGH",
            reason: "Observed bearing temperature 92 °C exceeds documented limit of 80 °C in Maintenance_SOP_001.pdf.",
          },
          recommendation: "Perform immediate shutdown and inspect bearing lubrication per SOP.",
          citations: [
            {
              documentId: docA2Id,
              filename: "Maintenance_SOP_001.pdf",
              page: 4,
              chunkIndex: 0,
            },
          ],
        });
      },
    });

    assert.equal(riskResult.grounded, true);
    assert.equal(riskResult.riskAssessment.level, "HIGH");
    assert.equal(riskResult.citations.length, 1);
    assert.equal(riskResult.citations[0].filename, "Maintenance_SOP_001.pdf");
    console.log("  ✅ PASS: TEST 10 — Inspection risk analysis grounded on Company A SOP evidence");

    // ----------------------------------------------------
    // TEST 11 — Inspection Finding with No Relevant SOP
    // ----------------------------------------------------
    console.log("\n[TEST 11] Inspection finding with no relevant SOP");
    let riskLlmCalled = false;
    const unknownFinding = {
      finding: "Unidentified cosmic radiation detected in vacuum chamber",
      equipment: "Chamber-99",
      evidence: "Unknown radiation detected",
    };

    const emptyRiskResult = await assessFindingRisk(unknownFinding, {
      organizationId: orgAId,
      searchSop: async () => [], // Simulates zero relevant SOP evidence
      generateAnswer: async () => {
        riskLlmCalled = true;
        return "Fake compliance";
      },
    });

    assert.equal(riskLlmCalled, false, "LLM must NOT be called when SOP evidence is absent");
    assert.equal(emptyRiskResult.riskAssessment.level, null, "Risk level must be null when SOP is absent");
    assert.ok(emptyRiskResult.riskAssessment.reason.includes("Insufficient"));
    assert.equal(emptyRiskResult.citations.length, 0);
    assert.equal(emptyRiskResult.grounded, false);
    console.log("  ✅ PASS: TEST 11 — No fabricated SOP requirements; risk level is null with zero citations");

    // ----------------------------------------------------
    // TEST 12 — Multi-Source Answer (Inspection + SOP)
    // ----------------------------------------------------
    console.log("\n[TEST 12] Multi-source answer");
    const multiSourceRes = await answerQuestion("How does Pump-03 observed temperature compare with the maintenance SOP limit?", {
      organizationId: orgAId,
      generateAnswer: async (prompt) => {
        assert.ok(prompt.includes("Inspection_Report_Pump03.pdf"));
        assert.ok(prompt.includes("Maintenance_SOP_001.pdf"));
        return "Pump-03 observed temperature was 92 °C [Source: Inspection_Report_Pump03.pdf, Page: 1], which exceeds the 80 °C maximum limit specified in [Source: Maintenance_SOP_001.pdf, Page: 4].";
      },
    });

    assert.equal(multiSourceRes.grounded, true);
    assert.ok(multiSourceRes.sources.some((s) => s.filename === "Inspection_Report_Pump03.pdf"));
    assert.ok(multiSourceRes.sources.some((s) => s.filename === "Maintenance_SOP_001.pdf"));
    assert.equal(multiSourceRes.citationIntegrity.isValid, true);
    assert.equal(multiSourceRes.citationIntegrity.validCitations.length, 2);
    console.log("  ✅ PASS: TEST 12 — Multi-source synthesis verified with citations for each supporting source");

    // ----------------------------------------------------
    // TEST 13 — LLM is NOT Called When Evidence Gate Fails
    // ----------------------------------------------------
    console.log("\n[TEST 13] LLM is NOT called when evidence gate fails");
    let spyCallCount = 0;
    await answerQuestion("Query that will yield no results in Org A", {
      organizationId: orgAId,
      scoreThreshold: 0.99, // Artificially high to trigger evidence gate refusal
      generateAnswer: async () => {
        spyCallCount++;
        return "Spied answer";
      },
    });

    assert.equal(spyCallCount, 0, "generateAnswer must have 0 invocations when evidence gate fails");
    console.log("  ✅ PASS: TEST 13 — Verified: 0 calls to LLM when evidence gate determines insufficient evidence");

    // ----------------------------------------------------
    // TEST 14 — organizationId Missing (Fail Closed)
    // ----------------------------------------------------
    console.log("\n[TEST 14] organizationId missing fails closed");
    let caughtMissingOrg = false;
    try {
      await answerQuestion("Valid question", { organizationId: null });
    } catch (err) {
      caughtMissingOrg = err.message.includes("organizationId is required");
    }
    assert.equal(caughtMissingOrg, true, "Must fail closed if organizationId is missing");
    console.log("  ✅ PASS: TEST 14 — Missing organizationId immediately fails closed");

    // ----------------------------------------------------
    // TEST 15 — LLM Attempts to Cite a Document Not Present in Context
    // ----------------------------------------------------
    console.log("\n[TEST 15] LLM attempts to cite a document not present in context");
    const test15Res = await answerQuestion("What was the bearing temperature?", {
      organizationId: orgAId,
      generateAnswer: async () => {
        return "The temperature was 92 °C. [Source: Fabricated_Secret_Manual.pdf, Page: 1]";
      },
    });

    assert.equal(test15Res.citationIntegrity.isValid, false, "Citation integrity check must detect fabricated document");
    assert.equal(test15Res.citationIntegrity.invalidCitations.length, 1);
    assert.equal(test15Res.citationIntegrity.invalidCitations[0].filename, "Fabricated_Secret_Manual.pdf");
    console.log("  ✅ PASS: TEST 15 — Fabricated document citation detected and flagged invalid");

    // ----------------------------------------------------
    // TEST 16 — LLM Attempts to Invent a Page Number
    // ----------------------------------------------------
    console.log("\n[TEST 16] LLM attempts to invent a page number");
    const test16Res = await answerQuestion("What was the bearing temperature?", {
      organizationId: orgAId,
      generateAnswer: async () => {
        return "The temperature was 92 °C. [Source: Inspection_Report_Pump03.pdf, Page: 555]";
      },
    });

    assert.equal(test16Res.citationIntegrity.isValid, false, "Citation integrity check must detect fabricated page number");
    assert.equal(test16Res.citationIntegrity.invalidCitations.length, 1);
    assert.equal(test16Res.citationIntegrity.invalidCitations[0].page, 555);
    console.log("  ✅ PASS: TEST 16 — Fabricated page number detected and flagged invalid");

    // ----------------------------------------------------
    // STEP 15: PERFORMANCE BASELINE MEASUREMENT
    // ----------------------------------------------------
    console.log("\n[PERFORMANCE BASELINE] Timing breakdown for representative RAG query:");
    const perfRes = await answerQuestion("What is the normal operating limit for bearing temperature?", {
      organizationId: orgAId,
    });

    console.log("  Timing Breakdown:");
    console.log(`    1. Embedding Time:          ${perfRes.timings.embeddingMs} ms`);
    console.log(`    2. Qdrant Retrieval Time:    ${perfRes.timings.searchMs} ms`);
    console.log(`    3. Evidence Filtering Time:  ${perfRes.timings.contextMs} ms`);
    console.log(`    4. LLM Generation Time:      ${perfRes.timings.generationMs} ms`);
    console.log(`    5. Total RAG Latency:        ${perfRes.timings.totalMs} ms`);
    assert.ok(perfRes.timings.totalMs >= 0);

    // ----------------------------------------------------
    // API Endpoint Integration Check via HTTP
    // ----------------------------------------------------
    console.log("\n[HTTP API CHECK] POST /api/v1/chat/ask grounding contract verification");
    const httpRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        question: "What was the bearing temperature of Pump-03?",
      }),
    });

    assert.equal(httpRes.status, 200);
    const httpData = await httpRes.json();
    assert.equal(httpData.success, true);
    assert.equal(httpData.grounded, true);
    assert.ok(Array.isArray(httpData.sources));
    assert.ok(httpData.sources.length > 0);
    console.log("  ✅ PASS: HTTP API successfully returned grounded: true, sources, and citations");

    console.log("\n==================================================");
    console.log("✅ ALL 16 PHASE 5 RAG QUALITY & CITATION TESTS PASSED (16/16)");
    console.log("==================================================\n");
    process.exit(0);
  } finally {
    server.close();
    // Cleanup database test entities
    for (const d of cleanupDocIds) {
      try {
        await query("DELETE FROM documents WHERE id = $1", [d]);
      } catch {}
    }
    for (const u of cleanupUserIds) {
      try {
        await query("DELETE FROM users WHERE id = $1", [u]);
      } catch {}
    }
    for (const o of cleanupOrgIds) {
      try {
        await query("DELETE FROM organizations WHERE id = $1", [o]);
      } catch {}
    }
  }
}

runPhase5Suite().catch((err) => {
  console.error("Phase 5 test failed:", err);
  process.exit(1);
});
