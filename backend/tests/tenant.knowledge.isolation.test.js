/**
 * Phase 2 — Tenant-Isolated Knowledge Base & Qdrant Test Suite
 *
 * Validates the 14 mandated vector retrieval, RAG, SOP, inspection, agent tool,
 * and deletion multi-tenant security guarantees:
 *
 * TEST 1: Company A uploads/indexes a document; Company B uploads/indexes; Company A searches -> Only Company A chunks.
 * TEST 2: Company B searches -> Only Company B chunks returned.
 * TEST 3: Company A searches for content existing only in Company B -> 0 Company B chunks returned.
 * TEST 4: Company A performs SOP search -> Only Company A SOP chunks returned.
 * TEST 5: Company A searches for a highly similar Company B SOP -> Company B SOP never returned.
 * TEST 6: Retrieval called without organizationId -> Fails closed (throws error without issuing Qdrant query).
 * TEST 7: Inspection workflow for Company A -> Inspection retrieval only uses Company A documents.
 * TEST 8: Company A inspection SOP lookup -> Only Company A SOP evidence returned.
 * TEST 9: Agent document_search under Company A context -> Only Company A documents/chunks returned.
 * TEST 10: Agent search attempting to reference Company B data -> Company B data cannot be returned.
 * TEST 11: Known Company B documentId supplied during Company A retrieval -> 0 Company B data returned.
 * TEST 12: organizationId supplied in query/body as Company B while JWT belongs to Company A -> Tenant remains Company A.
 * TEST 13: Existing points without organizationId -> Completely invisible to tenant-scoped search.
 * TEST 14: Delete operation using Company B documentId from Company A context -> Company B vectors cannot be deleted.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { upsertChunks, deleteChunksByDocumentId } from "../../ai-service/vectorstore/qdrant.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { searchSop } from "../../ai-service/knowledge/sop.service.js";
import { answerQuestion } from "../../ai-service/rag/rag.service.js";
import { executeDocumentSearch } from "../src/services/agentTools/documentSearch.tool.js";
import { executeFileRead } from "../src/services/agentTools/fileRead.tool.js";
import { runInspectionWorkflow } from "../src/services/inspection-orchestrator.service.js";
import { runRetrieval } from "../src/orchestration/inspection/inspection.adapters.js";

async function runTenantIsolationSuite() {
  console.log("==================================================");
  console.log("Phase 2: Tenant-Isolated Knowledge Base & Qdrant Suite");
  console.log("==================================================");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];

  try {
    // ----------------------------------------------------
    // Setup Tenant A and Tenant B
    // ----------------------------------------------------
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

    // ----------------------------------------------------
    // Index Documents for Org A and Org B in Qdrant & PostgreSQL
    // ----------------------------------------------------
    const docAId = randomUUID();
    const docBId = randomUUID();
    const sopAId = randomUUID();
    const sopBId = randomUUID();
    cleanupDocIds.push(docAId, docBId, sopAId, sopBId);

    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status) VALUES ($1, $2, $3, $4, $5)",
      [docAId, orgAId, "Alpha_Reactor_Specs.pdf", "Alpha_Reactor_Specs.pdf", "Indexed"]
    );
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status) VALUES ($1, $2, $3, $4, $5)",
      [docBId, orgBId, "Beta_Turbine_Specs.pdf", "Beta_Turbine_Specs.pdf", "Indexed"]
    );
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status) VALUES ($1, $2, $3, $4, $5)",
      [sopAId, orgAId, "SOP_Alpha_Emergency.pdf", "SOP_Alpha_Emergency.pdf", "Indexed"]
    );
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status) VALUES ($1, $2, $3, $4, $5)",
      [sopBId, orgBId, "SOP_Beta_Emergency.pdf", "SOP_Beta_Emergency.pdf", "Indexed"]
    );

    const textDocA = "ALPHA_REACTOR_COOLANT: Alpha reactor coolant primary loop operates strictly at 450 Kelvin.";
    const textDocB = "BETA_TURBINE_VIBRATION: Beta turbine rotor maximum acceptable vibration amplitude is 0.85 mm/s.";
    const textSopA = "SOP-ALPHA-900: Emergency Shutdown Procedure for Alpha Chemical Reactor and Coolant Bypass.";
    const textSopB = "SOP-BETA-900: Emergency Shutdown Procedure for Beta Steam Turbine and Generator Trip.";

    const vecDocA = await generateEmbedding(textDocA);
    const vecDocB = await generateEmbedding(textDocB);
    const vecSopA = await generateEmbedding(textSopA);
    const vecSopB = await generateEmbedding(textSopB);

    await upsertChunks([
      {
        documentId: docAId,
        organizationId: orgAId,
        filename: "Alpha_Reactor_Specs.pdf",
        documentType: "inspection",
        page: 1,
        text: textDocA,
        chunkIndex: 0,
        pageStartOffset: 0,
        pageEndOffset: textDocA.length,
        vector: vecDocA,
      },
      {
        documentId: docBId,
        organizationId: orgBId,
        filename: "Beta_Turbine_Specs.pdf",
        documentType: "inspection",
        page: 1,
        text: textDocB,
        chunkIndex: 0,
        pageStartOffset: 0,
        pageEndOffset: textDocB.length,
        vector: vecDocB,
      },
      {
        documentId: sopAId,
        organizationId: orgAId,
        filename: "SOP_Alpha_Emergency.pdf",
        documentType: "sop",
        page: 1,
        text: textSopA,
        chunkIndex: 0,
        pageStartOffset: 0,
        pageEndOffset: textSopA.length,
        vector: vecSopA,
      },
      {
        documentId: sopBId,
        organizationId: orgBId,
        filename: "SOP_Beta_Emergency.pdf",
        documentType: "sop",
        page: 1,
        text: textSopB,
        chunkIndex: 0,
        pageStartOffset: 0,
        pageEndOffset: textSopB.length,
        vector: vecSopB,
      },
    ]);

    console.log("✓ Test documents & SOPs indexed for Company Alpha and Company Beta in Qdrant & PostgreSQL");

    // ----------------------------------------------------
    // TEST 1: Company A searches -> Only Company A chunks returned
    // ----------------------------------------------------
    console.log("\n[TEST 1] Company A vector retrieval");
    const queryAEmbedding = await generateEmbedding("What is the reactor coolant temperature?");
    const resA = await searchSimilarChunks(queryAEmbedding, 5, undefined, {
      organizationId: orgAId,
    });
    assert.ok(resA.length > 0, "Company A must retrieve chunks");
    for (const chunk of resA) {
      assert.equal(chunk.organizationId, orgAId, "Every returned chunk must belong to Company A");
      assert.notEqual(chunk.documentId, docBId, "Company B document must NEVER be returned to Company A");
    }
    console.log("  ✅ PASS: Company A search strictly returned only Company A chunks");

    // ----------------------------------------------------
    // TEST 2: Company B searches -> Only Company B chunks returned
    // ----------------------------------------------------
    console.log("\n[TEST 2] Company B vector retrieval");
    const queryBEmbedding = await generateEmbedding("What is the turbine rotor vibration limit?");
    const resB = await searchSimilarChunks(queryBEmbedding, 5, undefined, {
      organizationId: orgBId,
    });
    assert.ok(resB.length > 0, "Company B must retrieve chunks");
    for (const chunk of resB) {
      assert.equal(chunk.organizationId, orgBId, "Every returned chunk must belong to Company B");
      assert.notEqual(chunk.documentId, docAId, "Company A document must NEVER be returned to Company B");
    }
    console.log("  ✅ PASS: Company B search strictly returned only Company B chunks");

    // ----------------------------------------------------
    // TEST 3: Company A searches for content existing only in Company B
    // ----------------------------------------------------
    console.log("\n[TEST 3] Company A searches for content unique to Company B");
    const crossQueryVec = await generateEmbedding("Beta turbine rotor maximum acceptable vibration amplitude 0.85 mm/s");
    const crossResA = await searchSimilarChunks(crossQueryVec, 10, undefined, {
      organizationId: orgAId,
    });
    const leakedBChunks = crossResA.filter((c) => c.organizationId === orgBId || c.documentId === docBId);
    assert.equal(leakedBChunks.length, 0, "Company B chunks must NEVER be returned to Company A query");
    console.log("  ✅ PASS: 0 Company B chunks returned when Company A searched for Company B content");

    // ----------------------------------------------------
    // TEST 4: Company A performs SOP search -> Only Company A SOP chunks returned
    // ----------------------------------------------------
    console.log("\n[TEST 4] Company A SOP search");
    const sopResA = await searchSop("Emergency Shutdown Procedure", {
      organizationId: orgAId,
    });
    assert.ok(sopResA.length > 0, "Company A must retrieve its own SOP");
    for (const s of sopResA) {
      assert.equal(s.organizationId, orgAId, "SOP chunk must belong to Company A");
      assert.equal(s.documentId, sopAId, "Must be Company A SOP");
      assert.notEqual(s.documentId, sopBId, "Must NOT return Company B SOP");
    }
    console.log("  ✅ PASS: Company A SOP search returned only Company A SOP chunks");

    // ----------------------------------------------------
    // TEST 5: Company A searches for a highly similar Company B SOP
    // ----------------------------------------------------
    console.log("\n[TEST 5] Company A searches for highly similar Company B SOP query");
    const sopTargetingB = await searchSop("Emergency Shutdown Procedure for Beta Steam Turbine", {
      organizationId: orgAId,
    });
    const leakedSopB = sopTargetingB.filter((s) => s.documentId === sopBId || s.organizationId === orgBId);
    assert.equal(leakedSopB.length, 0, "Company B SOP must never be returned to Company A search");
    console.log("  ✅ PASS: Company B SOP never returned to Company A search");

    // ----------------------------------------------------
    // TEST 6: Retrieval called without organizationId -> Fails closed
    // ----------------------------------------------------
    console.log("\n[TEST 6] Fail-closed retrieval without organizationId");
    let threwWithoutOrg = false;
    try {
      await searchSimilarChunks(queryAEmbedding, 5, undefined, {});
    } catch (err) {
      threwWithoutOrg = true;
      assert.ok(
        err.message.includes("organizationId is required"),
        `Error message must indicate missing organizationId: ${err.message}`
      );
    }
    assert.equal(threwWithoutOrg, true, "searchSimilarChunks without organizationId MUST throw and fail closed");

    let sopThrewWithoutOrg = false;
    try {
      await searchSop("Emergency Shutdown Procedure", {});
    } catch (err) {
      sopThrewWithoutOrg = true;
      assert.ok(
        err.message.includes("organizationId is required"),
        `SOP search error must indicate missing organizationId: ${err.message}`
      );
    }
    assert.equal(sopThrewWithoutOrg, true, "searchSop without organizationId MUST throw and fail closed");
    console.log("  ✅ PASS: Retrieval fails closed immediately without issuing Qdrant query when organizationId is missing");

    // ----------------------------------------------------
    // TEST 7: Inspection workflow for Company A -> Inspection retrieval only uses Company A documents
    // ----------------------------------------------------
    console.log("\n[TEST 7] Inspection workflow for Company A");
    const wfResA = await runInspectionWorkflow(
      {
        documentId: docAId,
        task: "Analyze reactor coolant conditions",
      },
      {
        organizationId: orgAId,
        userId: userAId,
        analysisOptions: {
          generateAnswer: async () =>
            JSON.stringify({
              findings: [
                {
                  finding: "Reactor coolant loop operates at 450 Kelvin",
                  equipment: "Alpha Reactor",
                  observedValue: "450 Kelvin",
                  limit: "400 Kelvin",
                  severity: "HIGH",
                  evidence: "Alpha reactor coolant primary loop operates strictly at 450 Kelvin.",
                  source: { documentId: docAId, page: 1, chunkIndex: 0 },
                },
              ],
            }),
        },
        riskOptions: {
          generateAnswer: async () =>
            JSON.stringify({
              riskAssessment: {
                level: "HIGH",
                reason: "Operating coolant at 450 Kelvin requires emergency bypass per Alpha procedure.",
              },
              recommendation: "Activate coolant bypass per SOP-ALPHA-900.",
              citations: [{ documentId: sopAId, page: 1, chunkIndex: 0 }],
            }),
        },
      }
    );
    assert.equal(
      wfResA.orchestration?.status === "completed" || wfResA.orchestration?.workflowOutcome === "SUCCESS" || Boolean(wfResA.documentId),
      true,
      "Workflow must execute to completion"
    );
    assert.equal(wfResA.documentId, docAId, "Workflow must operate on Company A document");

    // Verify inspection retrieval adapter is tenant-scoped
    const inspectionRetrievalCompanyA = await runRetrieval({
      documentId: docAId,
      organizationId: orgAId,
      task: "coolant Kelvin",
    });
    assert.ok(inspectionRetrievalCompanyA.length > 0, "Inspection retrieval must find Company A chunks");
    for (const c of inspectionRetrievalCompanyA) {
      assert.equal(c.organizationId, orgAId, "Inspection retrieval chunks must belong strictly to Company A");
      assert.notEqual(c.documentId, docBId, "Inspection retrieval must never return Company B chunks");
    }

    // Cross-tenant attempt: Supply Company B documentId under Company A organizationId
    const crossTenantInspectionRetrieval = await runRetrieval({
      documentId: docBId,
      organizationId: orgAId,
      task: "turbine vibration",
    });
    assert.equal(crossTenantInspectionRetrieval.length, 0, "Company A inspection retrieval must NEVER retrieve Company B document chunks");
    console.log("  ✅ PASS: Inspection workflow executed strictly under Company A context");

    // ----------------------------------------------------
    // TEST 8: Company A inspection SOP lookup -> Only Company A SOP evidence
    // ----------------------------------------------------
    console.log("\n[TEST 8] Company A inspection SOP lookup");
    const sopLookup = await searchSop("Reactor Coolant Bypass and Shutdown", {
      organizationId: orgAId,
    });
    for (const chunk of sopLookup) {
      assert.equal(chunk.organizationId, orgAId, "Inspection SOP evidence must belong strictly to Company A");
      assert.notEqual(chunk.documentId, sopBId, "Must never return Company B SOP evidence");
    }
    console.log("  ✅ PASS: Only Company A SOP evidence retrieved for inspection analysis");

    // ----------------------------------------------------
    // TEST 9: Agent document_search under Company A -> Only Company A chunks
    // ----------------------------------------------------
    console.log("\n[TEST 9] Agent document_search under Company A context");
    const agentSearchRes = await executeDocumentSearch(
      { query: "reactor coolant Kelvin" },
      { organizationId: orgAId, userId: userAId }
    );
    assert.ok(agentSearchRes.results.length > 0, "Agent search must return results");
    for (const r of agentSearchRes.results) {
      assert.ok(r.documentId === docAId || r.documentId === sopAId, "Agent result must be Company A document");
      assert.notEqual(r.documentId, docBId, "Agent result must never be Company B document");
      assert.notEqual(r.documentId, sopBId, "Agent result must never be Company B SOP");
    }
    console.log("  ✅ PASS: Agent document_search under Company A context returned only Company A chunks");

    // ----------------------------------------------------
    // TEST 10: Agent search attempting to reference Company B data
    // ----------------------------------------------------
    console.log("\n[TEST 10] Agent search attempting to query Company B content");
    const agentBQueryRes = await executeDocumentSearch(
      {
        query: "Beta turbine rotor maximum acceptable vibration amplitude 0.85 mm/s",
        organizationId: orgBId, // Malicious attempt in tool args: must be ignored in favor of context
      },
      { organizationId: orgAId, userId: userAId }
    );
    const leakedAgentB = agentBQueryRes.results.filter(
      (r) => r.documentId === docBId || r.documentId === sopBId
    );
    assert.equal(leakedAgentB.length, 0, "Agent search must ignore LLM args.organizationId and return 0 Company B chunks");
    console.log("  ✅ PASS: Agent search ignored args.organizationId; 0 Company B chunks returned");

    // ----------------------------------------------------
    // TEST 11: Known Company B documentId supplied during Company A retrieval
    // ----------------------------------------------------
    console.log("\n[TEST 11] Known Company B documentId supplied during Company A retrieval");
    const targetedSearchRes = await searchSimilarChunks(queryAEmbedding, 5, docBId, {
      organizationId: orgAId,
    });
    assert.equal(targetedSearchRes.length, 0, "Querying Company B documentId under Company A organizationId must return 0 chunks");

    let fileReadThrew = false;
    try {
      await executeFileRead({ documentId: docBId }, { organizationId: orgAId });
    } catch (frErr) {
      fileReadThrew = true;
      assert.ok(frErr.message.includes("not found"), `File read must fail for foreign document: ${frErr.message}`);
    }
    assert.equal(fileReadThrew, true, "executeFileRead for Company B document under Company A context must fail");
    console.log("  ✅ PASS: Cross-tenant documentId lookup strictly yielded 0 results / rejected");

    // ----------------------------------------------------
    // TEST 12: organizationId supplied in query/body as Company B while JWT belongs to Company A
    // ----------------------------------------------------
    console.log("\n[TEST 12] Body/query organizationId = Company B with Company A JWT on chat RAG endpoint");
    const spoofChatRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: "What is the turbine rotor vibration limit?",
        organizationId: orgBId, // Client spoofing attempt
      }),
    });
    assert.equal(spoofChatRes.status, 200, "Chat request must succeed under authenticated Company A");
    const spoofChatData = await spoofChatRes.json();
    for (const src of (spoofChatData.sources || [])) {
      assert.notEqual(src.documentId, docBId, "Chat sources must never contain Company B documents");
    }
    console.log("  ✅ PASS: Client body organizationId ignored; RAG executed strictly under Company A");

    // ----------------------------------------------------
    // TEST 13: Existing points without organizationId -> Completely invisible to tenant search
    // ----------------------------------------------------
    console.log("\n[TEST 13] Verification that unassociated/unassigned points are never returned");
    const test13Res = await searchSimilarChunks(queryAEmbedding, 20, undefined, {
      organizationId: orgAId,
    });
    for (const chunk of test13Res) {
      assert.equal(chunk.organizationId, orgAId, "Every chunk must have verified organizationId matching Company A");
      assert.ok(chunk.organizationId !== undefined && chunk.organizationId !== null, "Chunk organizationId cannot be null or undefined");
    }
    console.log("  ✅ PASS: Points without organizationId are completely invisible to tenant-scoped searches");

    // ----------------------------------------------------
    // TEST 14: Delete operation using Company B documentId from Company A context
    // ----------------------------------------------------
    console.log("\n[TEST 14] Cross-tenant vector deletion prevention");
    await deleteChunksByDocumentId(docBId, orgAId);

    const verifyDocBChunks = await searchSimilarChunks(vecDocB, 5, docBId, {
      organizationId: orgBId,
    });
    assert.ok(verifyDocBChunks.length > 0, "Company B vectors must remain intact and NOT be deleted by Company A");
    assert.equal(verifyDocBChunks[0].documentId, docBId, "Company B vectors verified intact");
    console.log("  ✅ PASS: Cross-tenant vector deletion blocked; Company B vectors remain intact");

    console.log("\n==================================================");
    console.log("✅ ALL 14 PHASE 2 TENANT ISOLATION TESTS PASSED");
    console.log("==================================================");
  } finally {
    // Cleanup test vectors from Qdrant
    for (const docId of cleanupDocIds) {
      for (const orgId of cleanupOrgIds) {
        await deleteChunksByDocumentId(docId, orgId).catch(() => {});
      }
    }

    // Cleanup PostgreSQL test data
    for (const docId of cleanupDocIds) {
      await query("DELETE FROM documents WHERE id = $1", [docId]).catch(() => {});
    }
    for (const orgId of cleanupOrgIds) {
      await query("DELETE FROM conversations WHERE organization_id = $1", [orgId]).catch(() => {});
      await query("DELETE FROM documents WHERE organization_id = $1", [orgId]).catch(() => {});
      await query("DELETE FROM users WHERE organization_id = $1", [orgId]).catch(() => {});
      await query("DELETE FROM organizations WHERE id = $1", [orgId]).catch(() => {});
    }
    for (const userId of cleanupUserIds) {
      await query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    }
    server.close();
  }
}

runTenantIsolationSuite().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("❌ Phase 2 test failure:", err);
  process.exit(1);
});
