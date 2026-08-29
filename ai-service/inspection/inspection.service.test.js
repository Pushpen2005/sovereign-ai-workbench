import assert from "node:assert/strict";
import { analyzeInspectionReport } from "./inspection.service.js";

function createMockDependencies(overrides = {}) {
    const calls = {
        generateEmbedding: [],
        searchSimilarChunks: [],
        generateAnswer: [],
    };

    const generateEmbeddingOverride = overrides.generateEmbedding;
    const searchSimilarChunksOverride = overrides.searchSimilarChunks;
    const generateAnswerOverride = overrides.generateAnswer;

    return {
        calls,
        generateEmbedding: async (text) => {
            calls.generateEmbedding.push(text);
            if (typeof generateEmbeddingOverride === "function") {
                return generateEmbeddingOverride(text);
            }

            return new Array(384).fill(0.25);
        },
        searchSimilarChunks: async (queryVector, limit, documentId) => {
            calls.searchSimilarChunks.push({ queryVector, limit, documentId });
            if (typeof searchSimilarChunksOverride === "function") {
                return searchSimilarChunksOverride(queryVector, limit, documentId);
            }

            return [];
        },
        generateAnswer: async (prompt) => {
            calls.generateAnswer.push(prompt);
            if (typeof generateAnswerOverride === "function") {
                return generateAnswerOverride(prompt);
            }

            return JSON.stringify({ findings: [] });
        },
    };
}

async function expectReject(promise, messageFragment) {
    try {
        await promise;
        assert.fail("Expected promise to reject");
    } catch (error) {
        assert.match(error.message, new RegExp(messageFragment));
    }
}

async function testValidInspectionRequest() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [],
    });

    const result = await analyzeInspectionReport(
        {
            documentId: "abc-123",
            task: "Analyze this inspection report and extract all significant findings.",
        },
        mocks
    );

    assert.deepEqual(result, { findings: [] });
    assert.equal(mocks.calls.generateEmbedding.length, 1);
    assert.equal(mocks.calls.searchSimilarChunks.length, 1);
    assert.equal(mocks.calls.searchSimilarChunks[0].documentId, "abc-123");
    assert.equal(mocks.calls.searchSimilarChunks[0].limit, 10);
}

async function testMissingDocumentId() {
    await expectReject(
        analyzeInspectionReport({ task: "Analyze" }, createMockDependencies()),
        "documentId"
    );
}

async function testEmptyTask() {
    await expectReject(
        analyzeInspectionReport({ documentId: "abc-123", task: "   " }, createMockDependencies()),
        "task"
    );
}

async function testRetrievalReturnsRelevantChunks() {
    const chunks = [
        {
            documentId: "abc-123",
            page: 4,
            chunkIndex: 17,
            text: "Bearing temperature was recorded at 95°C.",
            score: 0.78,
        },
        {
            documentId: "abc-123",
            page: 4,
            chunkIndex: 18,
            text: "The limit for the bearing temperature is 80°C.",
            score: 0.74,
        },
    ];
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => chunks,
        generateAnswer: async () => JSON.stringify({
            findings: [
                {
                    finding: "Bearing temperature exceeded permissible limit",
                    equipment: "Pump-03",
                    observedValue: "95°C",
                    limit: "80°C",
                    severity: "High",
                    evidence: "Bearing temperature was recorded at 95°C.",
                },
            ],
        }),
    });

    const result = await analyzeInspectionReport(
        { documentId: "abc-123", task: "Analyze findings" },
        mocks
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].source.documentId, "abc-123");
    assert.equal(result.findings[0].source.page, 4);
    assert.equal(result.findings[0].source.chunkIndex, 17);
    assert.equal(result.findings[0].source.score, 0.78);
    assert.equal(mocks.calls.generateAnswer.length, 1);
    assert.match(mocks.calls.generateAnswer[0], /CONTEXT:/);
    assert.match(mocks.calls.generateAnswer[0], /SOURCE 1/);
}

async function testRetrievalReturnsNoRelevantChunks() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 2,
                chunkIndex: 4,
                text: "Irrelevant text.",
                score: 0.2,
            },
        ],
    });

    const result = await analyzeInspectionReport(
        { documentId: "abc-123", task: "Analyze findings" },
        mocks
    );

    assert.deepEqual(result, { findings: [] });
    assert.equal(mocks.calls.generateAnswer.length, 0);
}

async function testStructuredValidLlmResponse() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 4,
                chunkIndex: 17,
                text: "Bearing temperature was recorded at 95°C.",
                score: 0.78,
            },
        ],
        generateAnswer: async () => JSON.stringify({
            findings: [
                {
                    finding: "Bearing temperature exceeded permissible limit",
                    equipment: "Pump-03",
                    observedValue: "95°C",
                    limit: "80°C",
                    severity: "High",
                    evidence: "Bearing temperature was recorded at 95°C.",
                },
            ],
        }),
    });

    const result = await analyzeInspectionReport(
        { documentId: "abc-123", task: "Analyze findings" },
        mocks
    );

    assert.equal(result.findings[0].finding, "Bearing temperature exceeded permissible limit");
    assert.equal(result.findings[0].equipment, "Pump-03");
    assert.equal(result.findings[0].observedValue, "95°C");
    assert.equal(result.findings[0].limit, "80°C");
    assert.equal(result.findings[0].severity, "High");
    assert.equal(result.findings[0].evidence, "Bearing temperature was recorded at 95°C.");
}

async function testMalformedLlmJson() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 4,
                chunkIndex: 17,
                text: "Bearing temperature was recorded at 95°C.",
                score: 0.78,
            },
        ],
        generateAnswer: async () => "{not valid json",
    });

    await expectReject(
        analyzeInspectionReport({ documentId: "abc-123", task: "Analyze findings" }, mocks),
        "invalid JSON"
    );
}

async function testMissingRequiredFindingEvidence() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 4,
                chunkIndex: 17,
                text: "Bearing temperature was recorded at 95°C.",
                score: 0.78,
            },
        ],
        generateAnswer: async () => JSON.stringify({
            findings: [
                {
                    finding: "Bearing temperature exceeded permissible limit",
                    equipment: "Pump-03",
                    observedValue: "95°C",
                    limit: "80°C",
                    severity: "High",
                },
            ],
        }),
    });

    await expectReject(
        analyzeInspectionReport({ documentId: "abc-123", task: "Analyze findings" }, mocks),
        "evidence"
    );
}

async function testMissingOptionalValuesBecomeNull() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 4,
                chunkIndex: 17,
                text: "The inspection noted minor wear on the coupling.",
                score: 0.78,
            },
        ],
        generateAnswer: async () => JSON.stringify({
            findings: [
                {
                    finding: "Minor wear noted on the coupling",
                    evidence: "The inspection noted minor wear on the coupling.",
                },
            ],
        }),
    });

    const result = await analyzeInspectionReport(
        { documentId: "abc-123", task: "Analyze findings" },
        mocks
    );

    assert.equal(result.findings[0].equipment, null);
    assert.equal(result.findings[0].observedValue, null);
    assert.equal(result.findings[0].limit, null);
    assert.equal(result.findings[0].severity, null);
}

async function testSourceMetadataComesFromRetrievedChunks() {
    const mocks = createMockDependencies({
        searchSimilarChunks: async () => [
            {
                documentId: "abc-123",
                page: 9,
                chunkIndex: 31,
                text: "Pump-03 bearing temperature was recorded at 95°C.",
                score: 0.91,
            },
            {
                documentId: "abc-123",
                page: 10,
                chunkIndex: 32,
                text: "Pump-03 bearing temperature was recorded at 95°C.",
                score: 0.88,
            },
        ],
        generateAnswer: async () => JSON.stringify({
            findings: [
                {
                    finding: "Bearing temperature exceeded permissible limit",
                    equipment: "Pump-03",
                    observedValue: "95°C",
                    limit: "80°C",
                    severity: "High",
                    evidence: "Pump-03 bearing temperature was recorded at 95°C.",
                },
            ],
        }),
    });

    const result = await analyzeInspectionReport(
        { documentId: "abc-123", task: "Analyze findings" },
        mocks
    );

    assert.ok(Array.isArray(result.findings[0].source));
    assert.equal(result.findings[0].source.length, 2);
    assert.equal(result.findings[0].source[0].documentId, "abc-123");
    assert.equal(result.findings[0].source[0].page, 9);
    assert.equal(result.findings[0].source[1].page, 10);
}

async function run() {
    const tests = [
        ["valid inspection request", testValidInspectionRequest],
        ["missing documentId", testMissingDocumentId],
        ["empty task", testEmptyTask],
        ["retrieval returns relevant chunks", testRetrievalReturnsRelevantChunks],
        ["retrieval returns no relevant chunks", testRetrievalReturnsNoRelevantChunks],
        ["structured valid LLM response", testStructuredValidLlmResponse],
        ["malformed LLM JSON", testMalformedLlmJson],
        ["missing required finding evidence", testMissingRequiredFindingEvidence],
        ["missing optional values become null", testMissingOptionalValuesBecomeNull],
        ["source metadata comes from retrieved chunks", testSourceMetadataComesFromRetrievedChunks],
    ];

    for (const [name, test] of tests) {
        await test();
        console.log(`✓ ${name}`);
    }

    console.log("\n✅ Inspection analysis tests passed");
}

await run();