/**
 * PR #15 — Risk Assessment + Recommendation Service Unit Tests
 *
 * All external dependencies (SOP retrieval, Ollama LLM)
 * are mocked so these tests run completely offline without
 * live services.
 *
 * Run with:
 *   node ai-service/risk/risk.service.test.js
 */

import assert from "node:assert/strict";
import { assessFindingRisk } from "./risk.service.js";
import { buildSopQuery } from "./risk.prompt.js";

function createMockDependencies(overrides = {}) {
    const calls = {
        searchSop: [],
        generateAnswer: [],
    };

    const searchSopOverride = overrides.searchSop;
    const generateAnswerOverride = overrides.generateAnswer;

    return {
        calls,
        searchSop: async (query, options) => {
            calls.searchSop.push({ query, options });
            if (typeof searchSopOverride === "function") {
                return searchSopOverride(query, options);
            }
            return [];
        },
        generateAnswer: async (prompt, model) => {
            calls.generateAnswer.push({ prompt, model });
            if (typeof generateAnswerOverride === "function") {
                return generateAnswerOverride(prompt, model);
            }
            return JSON.stringify({
                riskAssessment: {
                    level: "HIGH",
                    reason: "Operating limit exceeded.",
                },
                recommendation: "Inspect bearing assembly immediately.",
                citations: [],
            });
        },
    };
}

async function expectReject(promise, messagePattern) {
    try {
        await promise;
        assert.fail("Expected promise to reject");
    } catch (error) {
        assert.match(error.message, new RegExp(messagePattern, "i"));
    }
}

const sampleFinding = {
    finding: "Bearing temperature exceeded operating limit",
    equipment: "Bearing",
    observedValue: "92°C",
    limit: "80°C",
    severity: "HIGH",
    evidence: "Temperature reading recorded during inspection",
    source: {
        documentId: "insp-001",
        page: 4,
        chunkIndex: 12,
    },
};

const sampleSopChunks = [
    {
        documentId: "sop-001",
        filename: "Demo_Maintenance_SOP.pdf",
        documentType: "sop",
        page: 1,
        chunkIndex: 2,
        score: 0.89,
        text: "Normal bearing operating temperature is up to 80°C. If temperature exceeds 80°C, inspect the bearing, verify lubrication, and check for abnormal vibration.",
    },
    {
        documentId: "sop-002",
        filename: "Demo_Safety_SOP.pdf",
        documentType: "sop",
        page: 3,
        chunkIndex: 5,
        score: 0.75,
        text: "Any component exceeding 90°C poses a thermal safety hazard. Secure area before inspection.",
    },
];

// ─── Test 1: Normal risk assessment ──────────────────────────────────────────
async function testNormalRiskAssessment() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => JSON.stringify({
            riskAssessment: {
                level: "HIGH",
                reason: "The observed bearing temperature of 92°C exceeds the documented operating limit of 80°C.",
            },
            recommendation: "Inspect the bearing assembly, verify lubrication, and check for abnormal vibration before returning the equipment to service.",
            citations: [
                {
                    documentId: "sop-001",
                    filename: "Demo_Maintenance_SOP.pdf",
                    page: 1,
                    chunkIndex: 2,
                },
            ],
        }),
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    // Verify searchSop was called with query built from finding
    assert.equal(mocks.calls.searchSop.length, 1);
    assert.match(mocks.calls.searchSop[0].query, /bearing/i);
    assert.match(mocks.calls.searchSop[0].query, /92°C/i);

    // Verify LLM received finding and SOP evidence in prompt
    assert.equal(mocks.calls.generateAnswer.length, 1);
    assert.match(mocks.calls.generateAnswer[0].prompt, /OBSERVED FINDING/);
    assert.match(mocks.calls.generateAnswer[0].prompt, /SOP EVIDENCE/);
    assert.match(mocks.calls.generateAnswer[0].prompt, /Demo_Maintenance_SOP\.pdf/);

    // Verify structured JSON result
    assert.equal(result.riskAssessment.level, "HIGH");
    assert.equal(
        result.riskAssessment.reason,
        "The observed bearing temperature of 92°C exceeds the documented operating limit of 80°C."
    );
    assert.match(result.recommendation, /Inspect the bearing assembly/);

    // Verify citations preserved
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].documentId, "sop-001");
    assert.equal(result.citations[0].filename, "Demo_Maintenance_SOP.pdf");
    assert.equal(result.citations[0].page, 1);
    assert.equal(result.citations[0].chunkIndex, 2);
}

// ─── Test 2: SOP retrieval returns no evidence ──────────────────────────────
async function testZeroRetrievedSopResults() {
    const mocks = createMockDependencies({
        searchSop: async () => [],
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    assert.equal(result.riskAssessment.level, null);
    assert.match(result.riskAssessment.reason, /insufficient evidence/i);
    assert.match(result.recommendation, /insufficient sop evidence/i);
    assert.deepEqual(result.citations, []);
    // LLM should not be called when zero SOP evidence is available
    assert.equal(mocks.calls.generateAnswer.length, 0);
}

// ─── Test 3: LLM returns malformed JSON ─────────────────────────────────────
async function testMalformedLlmJson() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => "This is not JSON",
    });

    await expectReject(
        assessFindingRisk(sampleFinding, {
            searchSop: mocks.searchSop,
            generateAnswer: mocks.generateAnswer,
        }),
        "invalid JSON"
    );
}

// ─── Test 4: Invalid risk level ─────────────────────────────────────────────
async function testInvalidRiskLevelRejected() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => JSON.stringify({
            riskAssessment: {
                level: "CRITICAL",
                reason: "Very high vibration observed",
            },
            recommendation: "Emergency shutdown required",
            citations: [],
        }),
    });

    await expectReject(
        assessFindingRisk(sampleFinding, {
            searchSop: mocks.searchSop,
            generateAnswer: mocks.generateAnswer,
        }),
        "Invalid risk level"
    );
}

// ─── Test 5: Hallucinated citation filtered out ─────────────────────────────
async function testHallucinatedCitationFilteredOut() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => JSON.stringify({
            riskAssessment: {
                level: "MEDIUM",
                reason: "Moderate risk based on SOP.",
            },
            recommendation: "Perform scheduled lubrication.",
            citations: [
                {
                    documentId: "unknown-doc-999",
                    filename: "Fabricated_Guide.pdf",
                    page: 99,
                    chunkIndex: 42,
                },
            ],
        }),
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    // Untrusted hallucinated citation must NOT be preserved
    assert.deepEqual(result.citations, []);
}

// ─── Test 6: Valid citation preserved from retrieved chunk ──────────────────
async function testValidCitationPreserved() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => JSON.stringify({
            riskAssessment: {
                level: "HIGH",
                reason: "Thermal hazard identified.",
            },
            recommendation: "Secure area immediately.",
            citations: [
                {
                    documentId: "sop-002",
                    filename: "Demo_Safety_SOP.pdf",
                    page: 3,
                    chunkIndex: 5,
                },
            ],
        }),
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].documentId, "sop-002");
    assert.equal(result.citations[0].filename, "Demo_Safety_SOP.pdf");
    assert.equal(result.citations[0].page, 3);
    assert.equal(result.citations[0].chunkIndex, 5);
}

// ─── Test 7: Markdown-wrapped JSON response ─────────────────────────────────
async function testMarkdownWrappedJsonResponse() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () =>
            "```json\n" +
            JSON.stringify({
                riskAssessment: {
                    level: "LOW",
                    reason: "Operating within normal safety thresholds.",
                },
                recommendation: "Continue routine monitoring.",
                citations: [],
            }) +
            "\n```",
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    assert.equal(result.riskAssessment.level, "LOW");
    assert.match(result.recommendation, /Continue routine monitoring/);
}

// ─── Test 8: Missing required finding fields ────────────────────────────────
async function testMissingRequiredFindingFields() {
    const mocks = createMockDependencies();

    await expectReject(
        assessFindingRisk(null, { searchSop: mocks.searchSop }),
        "Finding input must be an object"
    );

    await expectReject(
        assessFindingRisk({ evidence: "Some evidence" }, { searchSop: mocks.searchSop }),
        "finding must be a non-empty string"
    );

    await expectReject(
        assessFindingRisk({ finding: "Some finding" }, { searchSop: mocks.searchSop }),
        "evidence must be a non-empty string"
    );
}

// ─── Test 9: Mixed citations (one valid, one hallucinated) ──────────────────
async function testMixedCitationsKeepsOnlyValid() {
    const mocks = createMockDependencies({
        searchSop: async () => sampleSopChunks,
        generateAnswer: async () => JSON.stringify({
            riskAssessment: {
                level: "HIGH",
                reason: "Bearing temperature exceeded limit.",
            },
            recommendation: "Check lubrication.",
            citations: [
                {
                    documentId: "sop-001",
                    filename: "Demo_Maintenance_SOP.pdf",
                    page: 1,
                    chunkIndex: 2,
                },
                {
                    documentId: "sop-fake",
                    filename: "Imaginary_Doc.pdf",
                    page: 12,
                    chunkIndex: 0,
                },
            ],
        }),
    });

    const result = await assessFindingRisk(sampleFinding, {
        searchSop: mocks.searchSop,
        generateAnswer: mocks.generateAnswer,
    });

    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].documentId, "sop-001");
}

// ─── Test 10: SOP query builder handles different findings ──────────────────
function testBuildSopQuery() {
    const query1 = buildSopQuery({
        equipment: "Bearing",
        finding: "Bearing temperature exceeded operating limit",
        observedValue: "92°C",
        limit: "80°C",
    });
    assert.equal(query1, "Bearing temperature exceeded operating limit 92°C 80°C");

    const query2 = buildSopQuery({
        equipment: "Pump-03",
        finding: "Excessive vibration detected",
        observedValue: "7.2 mm/s",
        limit: "4.5 mm/s",
    });
    assert.equal(query2, "Pump-03 Excessive vibration detected 7.2 mm/s 4.5 mm/s");

    const query3 = buildSopQuery({
        finding: "Oil discolored and viscous",
    });
    assert.equal(query3, "Oil discolored and viscous");
}

async function run() {
    const tests = [
        ["Normal risk assessment", testNormalRiskAssessment],
        ["SOP retrieval returns zero evidence", testZeroRetrievedSopResults],
        ["LLM returns malformed JSON", testMalformedLlmJson],
        ["Invalid risk level rejected", testInvalidRiskLevelRejected],
        ["Hallucinated citation filtered out", testHallucinatedCitationFilteredOut],
        ["Valid citation preserved from retrieved chunk", testValidCitationPreserved],
        ["Markdown-wrapped JSON handled properly", testMarkdownWrappedJsonResponse],
        ["Missing required finding fields rejected", testMissingRequiredFindingFields],
        ["Mixed citations keeps only valid", testMixedCitationsKeepsOnlyValid],
        ["SOP query builder handles different findings", testBuildSopQuery],
    ];

    console.log("Running PR #15 Risk Assessment tests...\n");

    for (const [name, test] of tests) {
        await test();
        console.log(`  ✓ ${name}`);
    }

    console.log(`\n${tests.length} passed, 0 failed`);
    console.log("\n✅ PR #15 unit tests passed");
}

await run();
