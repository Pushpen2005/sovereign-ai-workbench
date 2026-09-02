/**
 * Unit & Integration Test Suite for Structured LLM JSON Extraction & Retry Logic
 *
 * Covers:
 *   1. Valid JSON on first attempt (1 LLM call, no retry)
 *   2. First attempt returns prose ("Here are the findings..."), second attempt returns valid JSON (passes on retry, exactly 2 LLM calls)
 *   3. Both attempts return invalid JSON (fails gracefully with clean InspectionExtractionError, exactly 2 LLM calls)
 *   4. Valid JSON but wrong schema (triggers retry, fails gracefully if both invalid)
 *   5. Missing required fields (finding or evidence missing triggers validation error and retry)
 *   6. Schema parsing units (valid JSON, code fences, invalid types)
 *
 * Run with:
 *   node backend/tests/inspection.structured.test.js
 */

import assert from "node:assert/strict";
import {
    analyzeInspectionReport,
    InspectionExtractionError,
} from "../../ai-service/inspection/inspection.service.js";
import {
    parseInspectionLlmResponse,
    InspectionValidationError,
} from "../../ai-service/inspection/inspection.schema.js";

async function runTests() {
    console.log("=== Structured LLM Extraction & Retry Logic Test Suite ===\n");

    const sampleChunks = [
        {
            documentId: "doc-test-01",
            page: 1,
            chunkIndex: 0,
            score: 0.95,
            text: "Pump-03 bearing temperature was observed at 92 degrees C exceeding the continuous operating limit of 80 degrees C.",
        },
    ];

    const mockEmbedding = async () => new Array(384).fill(0.1);
    const mockSearch = async () => sampleChunks;

    const validJsonString = JSON.stringify({
        findings: [
            {
                finding: "Bearing temperature exceeds operating limit",
                equipment: "Pump-03",
                observedValue: "92 C",
                limit: "80 C",
                severity: "HIGH",
                evidence: "Pump-03 bearing temperature was observed at 92 degrees C exceeding the continuous operating limit of 80 degrees C.",
            },
        ],
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Valid JSON on first attempt
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 1] Valid JSON on first attempt...");
    let callCount1 = 0;
    const mockGenerate1 = async (prompt, model, options) => {
        callCount1++;
        assert.equal(options?.format, "json", "Must request format: json");
        return validJsonString;
    };

    const result1 = await analyzeInspectionReport(
        { documentId: "doc-test-01", task: "Extract findings" },
        {
            generateEmbedding: mockEmbedding,
            searchSimilarChunks: mockSearch,
            generateAnswer: mockGenerate1,
        }
    );

    assert.equal(callCount1, 1, "Must only invoke LLM once when first response is valid");
    assert.equal(result1.findings.length, 1);
    assert.equal(result1.findings[0].equipment, "Pump-03");
    console.log("    ✓ Passed (1 LLM call, 0 retries)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: First attempt returns prose, second attempt valid JSON (Retry success)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 2] First attempt prose, second attempt valid JSON...");
    let callCount2 = 0;
    const mockGenerate2 = async (prompt, model, options) => {
        callCount2++;
        if (callCount2 === 1) {
            return "Here are the findings for Pump-03: The temperature is too high at 92 C.";
        }
        assert.ok(prompt.includes("RETRY INSTRUCTION"), "Second prompt must include retry instruction");
        return validJsonString;
    };

    const result2 = await analyzeInspectionReport(
        { documentId: "doc-test-01", task: "Extract findings" },
        {
            generateEmbedding: mockEmbedding,
            searchSimilarChunks: mockSearch,
            generateAnswer: mockGenerate2,
        }
    );

    assert.equal(callCount2, 2, "Must invoke LLM exactly twice (1 attempt + 1 retry)");
    assert.equal(result2.findings.length, 1);
    console.log("    ✓ Passed (exactly 2 LLM calls, succeeded on retry)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Both attempts return invalid JSON (Graceful failure)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 3] Both attempts return invalid JSON...");
    let callCount3 = 0;
    const mockGenerate3 = async () => {
        callCount3++;
        return `Here are the findings (attempt ${callCount3}): pump is damaged.`;
    };

    let caughtError3 = null;
    try {
        await analyzeInspectionReport(
            { documentId: "doc-test-01", task: "Extract findings" },
            {
                generateEmbedding: mockEmbedding,
                searchSimilarChunks: mockSearch,
                generateAnswer: mockGenerate3,
            }
        );
    } catch (err) {
        caughtError3 = err;
    }

    assert.ok(caughtError3, "Must throw an error when both attempts fail");
    assert.ok(caughtError3 instanceof InspectionExtractionError, "Must throw InspectionExtractionError");
    assert.equal(
        caughtError3.message,
        "Inspection finding extraction failed because the local model did not return the required structured format."
    );
    assert.equal(callCount3, 2, "Must not retry more than once (2 attempts total)");
    console.log("    ✓ Passed (graceful failure with clean error message after 2 attempts)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Valid JSON but wrong schema (missing findings key)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 4] Valid JSON but wrong schema (missing findings array)...");
    let callCount4 = 0;
    const mockGenerate4 = async () => {
        callCount4++;
        if (callCount4 === 1) {
            return JSON.stringify({ result: "ok", data: "no findings array here" });
        }
        return validJsonString;
    };

    const result4 = await analyzeInspectionReport(
        { documentId: "doc-test-01", task: "Extract findings" },
        {
            generateEmbedding: mockEmbedding,
            searchSimilarChunks: mockSearch,
            generateAnswer: mockGenerate4,
        }
    );

    assert.equal(callCount4, 2, "Wrong schema must trigger retry");
    assert.equal(result4.findings.length, 1);
    console.log("    ✓ Passed (schema mismatch triggered retry and succeeded)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Missing required fields (evidence field missing)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 5] Missing required fields (evidence missing in finding)...");
    let callCount5 = 0;
    const mockGenerate5 = async () => {
        callCount5++;
        if (callCount5 === 1) {
            return JSON.stringify({
                findings: [
                    {
                        finding: "High temperature",
                        equipment: "Pump-03",
                        // missing evidence!
                    },
                ],
            });
        }
        return validJsonString;
    };

    const result5 = await analyzeInspectionReport(
        { documentId: "doc-test-01", task: "Extract findings" },
        {
            generateEmbedding: mockEmbedding,
            searchSimilarChunks: mockSearch,
            generateAnswer: mockGenerate5,
        }
    );

    assert.equal(callCount5, 2, "Missing evidence must trigger retry");
    assert.equal(result5.findings.length, 1);
    console.log("    ✓ Passed (missing evidence triggered retry and succeeded)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Schema parser direct unit tests
    // ─────────────────────────────────────────────────────────────────────────
    console.log("  [TEST 6] Schema parser unit tests...");
    // 6a: Markdown code fence stripping
    const markdownWrapped = `\`\`\`json\n${validJsonString}\n\`\`\``;
    const parsedFromMarkdown = parseInspectionLlmResponse(markdownWrapped);
    assert.equal(parsedFromMarkdown.findings.length, 1);

    // 6b: Empty string rejected
    assert.throws(
        () => parseInspectionLlmResponse(""),
        InspectionValidationError,
        "Empty string must throw InspectionValidationError"
    );

    // 6c: Array instead of object rejected
    assert.throws(
        () => parseInspectionLlmResponse("[]"),
        InspectionValidationError,
        "Array must throw InspectionValidationError"
    );

    // 6d: Invalid finding element rejected
    assert.throws(
        () => parseInspectionLlmResponse(JSON.stringify({ findings: ["not an object"] })),
        InspectionValidationError
    );

    console.log("    ✓ Passed (markdown fences stripped, invalid formats rejected)\n");

    console.log("=========================================================");
    console.log("✅ ALL STRUCTURED OUTPUT & RETRY TESTS PASSED");
    console.log("=========================================================");
}

runTests().catch((err) => {
    console.error("Test failure:", err);
    process.exit(1);
});
