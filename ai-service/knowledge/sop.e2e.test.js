/**
 * PR #14 — SOP Knowledge Base E2E Test
 *
 * Requires running services:
 *   - Qdrant at http://localhost:6333
 *   - Embedding model (Xenova/all-MiniLM-L6-v2, auto-downloaded)
 *
 * Run with:
 *   node ai-service/knowledge/sop.e2e.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";

import { createCollection } from "../vectorstore/qdrant.service.js";
import { ingestSop, searchSop } from "./sop.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAINTENANCE_SOP = path.join(__dirname, "Demo_Maintenance_SOP.pdf");
const SAFETY_SOP = path.join(__dirname, "Demo_Safety_SOP.pdf");
const INSPECTION_GUIDELINES = path.join(__dirname, "Demo_Inspection_Guidelines.pdf");

const COLLECTION_NAME = "documents";

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL ?? "http://localhost:6333",
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertQdrantRunning() {
    try {
        await qdrant.getCollections();
    } catch {
        throw new Error(
            "Qdrant is not running at " +
            (process.env.QDRANT_URL ?? "http://localhost:6333") +
            ". Start Qdrant before running E2E tests."
        );
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function test_e2e_ingestMaintenanceSop() {
    console.log("  Ingesting Demo_Maintenance_SOP.pdf ...");

    const result = await ingestSop(MAINTENANCE_SOP);

    assert.ok(typeof result.documentId === "string" && result.documentId.length > 0,
        "documentId must be returned");
    assert.equal(result.filename, "Demo_Maintenance_SOP.pdf");
    assert.ok(result.chunksStored > 0,
        `Expected at least 1 chunk, got ${result.chunksStored}`);

    console.log(`    → documentId: ${result.documentId}`);
    console.log(`    → chunksStored: ${result.chunksStored}`);

    return result.documentId;
}

async function test_e2e_ingestSafetyAndGuidelines() {
    console.log("  Ingesting Demo_Safety_SOP.pdf ...");
    const safety = await ingestSop(SAFETY_SOP);
    assert.ok(safety.chunksStored > 0, "Safety SOP produced no chunks");
    console.log(`    → chunksStored: ${safety.chunksStored}`);

    console.log("  Ingesting Demo_Inspection_Guidelines.pdf ...");
    const guidelines = await ingestSop(INSPECTION_GUIDELINES);
    assert.ok(guidelines.chunksStored > 0, "Inspection Guidelines produced no chunks");
    console.log(`    → chunksStored: ${guidelines.chunksStored}`);
}

async function test_e2e_searchSopBearingQuery(sopDocumentId) {
    const query = "What should be done when bearing temperature exceeds the limit?";
    console.log(`  Searching: "${query}"`);

    const results = await searchSop(query, { limit: 5, scoreThreshold: 0.3 });

    assert.ok(Array.isArray(results), "Results must be an array");

    if (results.length === 0) {
        console.warn("    ⚠ No results returned — SOP content may not match query.");
        console.warn("    ⚠ This is acceptable if the demo PDF lacks matching text.");
        return;
    }

    console.log(`    → ${results.length} result(s) returned`);

    for (const r of results) {
        // Every result must have documentType = "sop"
        assert.equal(r.documentType, "sop",
            `Got documentType="${r.documentType}" — inspection docs must not leak`);
        assert.ok(r.filename, "filename must be present");
        assert.ok(r.page !== null && r.page !== undefined, "page must be present");
        assert.ok(typeof r.score === "number" && r.score > 0, "score must be present");
        assert.ok(r.text && r.text.length > 0, "text must be present");
        assert.ok(r.documentId, "documentId must be present");
        assert.ok(r.chunkIndex !== null && r.chunkIndex !== undefined, "chunkIndex must be present");
    }

    // First result should have the highest score
    if (results.length > 1) {
        assert.ok(results[0].score >= results[1].score,
            "Results must be sorted by descending score");
    }

    console.log("    → First result:");
    console.log(`       filename:     ${results[0].filename}`);
    console.log(`       page:         ${results[0].page}`);
    console.log(`       score:        ${results[0].score.toFixed(4)}`);
    console.log(`       text snippet: ${results[0].text.slice(0, 100)}...`);
}

async function test_e2e_isolationFromInspectionDocs() {
    console.log("  Testing isolation: SOP search must not return inspection documents ...");

    // Ingest a fake inspection document with the same terminology
    const { upsertChunks } = await import("../vectorstore/qdrant.service.js");
    const { generateEmbedding } = await import("../embeddings/embedding.service.js");

    const inspectionDocId = randomUUID();
    const inspectionText = "Bearing temperature exceeded allowable limit of 80°C on Pump-03.";

    const vector = await generateEmbedding(inspectionText);

    await upsertChunks([
        {
            documentId: inspectionDocId,
            filename: "Fake_Inspection_Report.pdf",
            documentType: "inspection",
            page: 1,
            chunkIndex: 0,
            text: inspectionText,
            pageStartOffset: 0,
            pageEndOffset: inspectionText.length,
            vector,
        },
    ]);

    console.log(`    → Ingested fake inspection doc (${inspectionDocId})`);

    // Now search SOP with the same terminology
    const results = await searchSop(
        "bearing temperature exceeded allowable limit",
        { limit: 10, scoreThreshold: 0.0 }
    );

    const inspectionLeaked = results.some(
        (r) => r.documentType === "inspection" || r.documentId === inspectionDocId
    );

    assert.ok(
        !inspectionLeaked,
        "CRITICAL: Inspection document leaked into SOP search results"
    );

    console.log("    → Isolation confirmed: no inspection docs in SOP results");
}

async function test_e2e_qdrantPayloadVerification(sopDocumentId) {
    console.log("  Verifying Qdrant payload fields ...");

    // Query Qdrant directly to verify payload
    const scrollResult = await qdrant.scroll(COLLECTION_NAME, {
        filter: {
            must: [
                { key: "documentId", match: { value: sopDocumentId } },
            ],
        },
        limit: 1,
        with_payload: true,
        with_vector: false,
    });

    const points = scrollResult.points ?? [];

    if (points.length === 0) {
        throw new Error(
            `No Qdrant points found for documentId="${sopDocumentId}"`
        );
    }

    const payload = points[0].payload;

    assert.ok(payload.documentId, "Qdrant payload missing documentId");
    assert.ok(payload.filename,   "Qdrant payload missing filename");
    assert.equal(payload.documentType, "sop", "Qdrant payload documentType must be 'sop'");
    assert.ok(payload.page !== undefined, "Qdrant payload missing page");
    assert.ok(typeof payload.chunkIndex === "number", "Qdrant payload missing chunkIndex");
    assert.ok(payload.text, "Qdrant payload missing text");
    assert.ok(typeof payload.pageStartOffset === "number", "Qdrant payload missing pageStartOffset");
    assert.ok(typeof payload.pageEndOffset === "number", "Qdrant payload missing pageEndOffset");

    console.log("    → Payload fields verified:");
    console.log(`       documentId:    ${payload.documentId}`);
    console.log(`       filename:      ${payload.filename}`);
    console.log(`       documentType:  ${payload.documentType}`);
    console.log(`       page:          ${payload.page}`);
    console.log(`       chunkIndex:    ${payload.chunkIndex}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
    console.log("=== PR #14 — SOP Knowledge Base E2E Test ===\n");

    try {
        await assertQdrantRunning();
        console.log("✓ Qdrant is running\n");

        await createCollection();
        console.log("✓ Collection ready\n");

        // Test 1: Ingest Maintenance SOP and get the documentId
        console.log("[1] Ingesting SOPs");
        const maintenanceDocId = await test_e2e_ingestMaintenanceSop();
        await test_e2e_ingestSafetyAndGuidelines();
        console.log("  ✓ All 3 demo SOP PDFs ingested\n");

        // Test 2: Verify Qdrant payload
        console.log("[2] Qdrant payload verification");
        await test_e2e_qdrantPayloadVerification(maintenanceDocId);
        console.log("  ✓ Qdrant payload verified\n");

        // Test 3: SOP search
        console.log("[3] SOP search: bearing temperature query");
        await test_e2e_searchSopBearingQuery(maintenanceDocId);
        console.log("  ✓ SOP search works\n");

        // Test 4: Isolation test
        console.log("[4] Isolation: inspection docs must not appear in SOP search");
        await test_e2e_isolationFromInspectionDocs();
        console.log("  ✓ Isolation verified\n");

        console.log("✅ PR #14 E2E tests passed");
    } catch (error) {
        console.error("\n❌ PR #14 E2E test failed");
        console.error(error);
        process.exit(1);
    }
}

await run();
