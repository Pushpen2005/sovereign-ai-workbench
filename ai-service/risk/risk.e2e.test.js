/**
 * PR #15 — Risk Assessment + Recommendation E2E Test
 *
 * Requires:
 *   - Qdrant at http://localhost:6333
 *   - Local embedding model
 *   - Ollama
 *   - PR #14 SOP PDFs
 *
 * Run:
 *   node ai-service/risk/risk.e2e.test.js
 *
 * If already inside ai-service:
 *   node risk/risk.e2e.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";

import { createCollection } from "../vectorstore/qdrant.service.js";
import { ingestSop, searchSop } from "../knowledge/sop.service.js";
import { assessFindingRisk } from "./risk.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAINTENANCE_SOP = path.join(
    __dirname,
    "../knowledge/Demo_Maintenance_SOP.pdf"
);

const QDRANT_URL =
    process.env.QDRANT_URL ?? "http://localhost:6333";

async function assertQdrantRunning() {
    const response = await fetch(`${QDRANT_URL}/collections`);

    if (!response.ok) {
        throw new Error(
            `Qdrant is not healthy: HTTP ${response.status}`
        );
    }
}

async function test_sopRetrieval() {
    console.log(
        "  [1] Verifying PR #14 SOP retrieval..."
    );

    const results = await searchSop(
        "bearing temperature exceeds 80 degrees C",
        {
            limit: 5,
            scoreThreshold: 0.3,
        }
    );

    assert.ok(
        Array.isArray(results),
        "SOP search must return an array"
    );

    assert.ok(
        results.length > 0,
        "Expected relevant SOP evidence"
    );

    for (const result of results) {
        assert.equal(
            result.documentType,
            "sop",
            "Only SOP documents may be returned"
        );

        assert.ok(
            result.filename,
            "SOP filename must be present"
        );

        assert.ok(
            result.page !== null &&
            result.page !== undefined,
            "SOP page must be present"
        );

        assert.ok(
            typeof result.score === "number",
            "SOP score must be present"
        );

        assert.ok(
            result.text &&
            result.text.length > 0,
            "SOP text must be present"
        );
    }

    console.log(
        `    → ${results.length} SOP evidence chunk(s) found`
    );

    console.log(
        `    → Best source: ${results[0].filename}, page ${results[0].page}`
    );

    return results;
}

async function test_riskAssessmentWithRealServices() {
    console.log(
        "\n  [2] Running real PR #15 risk assessment..."
    );

    const finding = {
        finding:
            "Bearing temperature exceeded the documented operating limit.",
        equipment: "Pump-03",
        observedValue: "92 degrees C",
        limit: "80 degrees C",
        severity: null,
        evidence:
            "Bearing temperature was observed at 92 degrees C, exceeding the documented limit of 80 degrees C.",
        source: null,
    };

    const result = await assessFindingRisk(finding, {
        sopOptions: {
            limit: 5,
            scoreThreshold: 0.3,
        },
    });

    console.log(
        "\n    → Risk assessment:"
    );

    console.log(
        `       level: ${result.riskAssessment.level}`
    );

    console.log(
        `       reason: ${result.riskAssessment.reason}`
    );

    console.log(
        `       recommendation: ${result.recommendation}`
    );

    console.log(
        `       citations: ${result.citations.length}`
    );

    assert.ok(
        result &&
        typeof result === "object",
        "Risk result must be an object"
    );

    assert.ok(
        result.riskAssessment &&
        typeof result.riskAssessment === "object",
        "riskAssessment must be an object"
    );

    assert.ok(
        ["LOW", "MEDIUM", "HIGH", null].includes(
            result.riskAssessment.level
        ),
        "Risk level must be LOW, MEDIUM, HIGH, or null"
    );

    assert.ok(
        typeof result.riskAssessment.reason === "string" &&
        result.riskAssessment.reason.length > 0,
        "Risk reason must be present"
    );

    assert.ok(
        typeof result.recommendation === "string" &&
        result.recommendation.length > 0,
        "Recommendation must be present"
    );

    assert.ok(
        Array.isArray(result.citations),
        "Citations must be an array"
    );

    return result;
}

async function test_citationIntegrity(result) {
    console.log(
        "\n  [3] Verifying citation integrity..."
    );

    for (const citation of result.citations) {
        assert.ok(
            citation.documentId,
            "Citation documentId must be present"
        );

        assert.ok(
            citation.filename,
            "Citation filename must be present"
        );

        assert.ok(
            citation.page !== null &&
            citation.page !== undefined,
            "Citation page must be present"
        );

        assert.ok(
            citation.chunkIndex !== null &&
            citation.chunkIndex !== undefined,
            "Citation chunkIndex must be present"
        );

        assert.ok(
            citation.filename.toLowerCase().includes("sop"),
            "Citation must refer to an SOP"
        );
    }

    console.log(
        `    → ${result.citations.length} validated citation(s)`
    );

    if (result.citations.length > 0) {
        console.log(
            `    → ${result.citations[0].filename}, page ${result.citations[0].page}`
        );
    }
}

async function test_noEvidenceSafety() {
    console.log(
        "\n  [4] Verifying insufficient-evidence handling..."
    );

    let llmCalled = false;

    const finding = {
        finding:
            "Unknown equipment condition requiring investigation.",
        equipment: "Unknown-Equipment",
        observedValue: null,
        limit: null,
        severity: null,
        evidence:
            "An unexplained condition was observed.",
        source: null,
    };

    const result = await assessFindingRisk(finding, {
        searchSop: async () => [],
        generateAnswer: async () => {
            llmCalled = true;
            throw new Error(
                "LLM must not be called when SOP evidence is unavailable"
            );
        },
    });

    assert.equal(
        llmCalled,
        false,
        "LLM must not be called without SOP evidence"
    );

    assert.equal(
        result.riskAssessment.level,
        null
    );

    assert.equal(
        result.riskAssessment.reason,
        "Insufficient evidence to determine risk level."
    );

    assert.equal(
        result.recommendation,
        "Insufficient SOP evidence is available to provide a validated recommendation."
    );

    assert.deepEqual(
        result.citations,
        []
    );

    console.log(
        "    → No evidence correctly produces null risk and no recommendation"
    );
}

async function run() {
    console.log(
        "=== PR #15 — Risk Assessment + Recommendation E2E Test ===\n"
    );

    try {
        // 1. Check Qdrant
        await assertQdrantRunning();

        console.log(
            `✓ Qdrant is running at ${QDRANT_URL}\n`
        );

        // 2. Make sure collection exists
        await createCollection();

        console.log(
            "✓ Qdrant collection ready\n"
        );

        // 3. Make sure maintenance SOP exists in Qdrant.
        //
        // This makes the E2E test runnable on a clean database.
        console.log(
            "[Setup] Ingesting maintenance SOP..."
        );

        const ingestion = await ingestSop(
            MAINTENANCE_SOP
        );

        console.log(
            `  ✓ ${ingestion.filename}`
        );

        console.log(
            `  ✓ ${ingestion.chunksStored} chunks stored\n`
        );

        // Test 1
        await test_sopRetrieval();

        console.log(
            "  ✓ PR #14 SOP retrieval verified"
        );

        // Test 2
        const riskResult =
            await test_riskAssessmentWithRealServices();

        console.log(
            "\n  ✓ Real risk assessment completed"
        );

        // Test 3
        await test_citationIntegrity(
            riskResult
        );

        console.log(
            "  ✓ Citation integrity verified"
        );

        // Test 4
        await test_noEvidenceSafety();

        console.log(
            "  ✓ Insufficient-evidence safety verified"
        );

        console.log(
            "\n=============================================="
        );

        console.log(
            "✅ PR #15 E2E tests passed"
        );

        console.log(
            "=============================================="
        );
    } catch (error) {
        console.error(
            "\n❌ PR #15 E2E test failed"
        );

        console.error(error);

        process.exit(1);
    }
}

await run();