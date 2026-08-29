/**
 * PR #16 — Approval Note DOCX Generation Unit Tests
 *
 * Run with:
 *   node ai-service/reports/approval-note.test.js
 */

import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { generateApprovalNote, validateApprovalNoteInput } from "./approval-note.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT_DIR = path.join(__dirname, "test-output");

function readDocxContent(filePath) {
    const pythonCode = `
import sys
from docx import Document
doc = Document(sys.argv[1])
paragraphs = [p.text for p in doc.paragraphs]
tables = []
for t in doc.tables:
    for row in t.rows:
        tables.append(" | ".join(c.text.strip() for c in row.cells))
print("PARAGRAPHS_START")
print("\\n".join(paragraphs))
print("TABLES_START")
print("\\n".join(tables))
`;
    const output = execFileSync("python3", ["-c", pythonCode, filePath], {
        encoding: "utf8",
    });
    return output;
}

async function expectReject(promise, pattern) {
    try {
        await promise;
        assert.fail("Expected promise to reject");
    } catch (error) {
        assert.match(error.message, new RegExp(pattern, "i"));
    }
}

const sampleFinding1 = {
    finding: "Bearing temperature exceeded operating limit",
    equipment: "Pump-03",
    observedValue: "92°C",
    limit: "80°C",
    severity: "HIGH",
    evidence: "Bearing temperature recorded at 92°C during inspection routine.",
    source: {
        documentId: "insp-001",
        page: 4,
        chunkIndex: 12,
    },
};

const sampleFinding2 = {
    finding: "High casing vibration detected",
    equipment: "Pump-03",
    observedValue: "7.1 mm/s",
    limit: "4.5 mm/s",
    severity: "MEDIUM",
    evidence: "Casing overall velocity vibration was recorded at 7.1 mm/s RMS.",
    source: null,
};

const sampleRiskAssessment = {
    level: "HIGH",
    reason: "Bearing temperature of 92°C exceeds maximum allowable threshold of 80°C, risking catastrophic mechanical seizure.",
};

const sampleRecommendation =
    "Inspect the bearing assembly, verify lubrication quantity and condition, and perform vibration spectral analysis before restarting equipment.";

const sampleCitations = [
    {
        documentId: "sop-001",
        filename: "Demo_Maintenance_SOP.pdf",
        page: 1,
        chunkIndex: 2,
    },
    {
        documentId: "sop-002",
        filename: "Demo_Safety_SOP.pdf",
        page: 3,
        chunkIndex: 5,
    },
];

// Clean up test output directory
function cleanupTestDir() {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
        fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
}

// ─── Test 1: Valid input generates DOCX ───────────────────────────────────────
async function testValidInputGeneratesDocx() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_valid.docx");

    const filePath = await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    assert.equal(filePath, path.resolve(outputPath));
    assert.ok(fs.existsSync(filePath), "Output file must exist");
}

// ─── Test 2: Output file exists and is non-empty ─────────────────────────────
async function testOutputFileExistsAndNonEmpty() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_non_empty.docx");

    await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    const stats = fs.statSync(outputPath);
    assert.ok(stats.size > 0, "DOCX file size must be greater than 0 bytes");
    assert.ok(stats.size > 1000, "DOCX file size should be substantial");
}

// ─── Test 3: Missing findings is rejected ────────────────────────────────────
async function testMissingFindingsRejected() {
    await expectReject(
        generateApprovalNote({
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        }),
        "findings must be an array"
    );

    await expectReject(
        generateApprovalNote({
            findings: "not an array",
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        }),
        "findings must be an array"
    );
}

// ─── Test 4: Invalid riskAssessment is rejected ──────────────────────────────
async function testInvalidRiskAssessmentRejected() {
    // Missing riskAssessment
    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        }),
        "riskAssessment must be an object"
    );

    // Invalid level
    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            riskAssessment: {
                level: "CRITICAL",
                reason: "Extreme heat",
            },
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        }),
        "Invalid risk level"
    );

    // Missing reason
    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            riskAssessment: {
                level: "HIGH",
                reason: "   ",
            },
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        }),
        "riskAssessment.reason must be a non-empty string"
    );
}

// ─── Test 5: Missing recommendation is rejected ──────────────────────────────
async function testMissingRecommendationRejected() {
    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            citations: sampleCitations,
        }),
        "recommendation must be a non-empty string"
    );

    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: "   ",
            citations: sampleCitations,
        }),
        "recommendation must be a non-empty string"
    );
}

// ─── Test 6: Missing citations is rejected ───────────────────────────────────
async function testMissingCitationsRejected() {
    await expectReject(
        generateApprovalNote({
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: "invalid",
        }),
        "citations must be an array"
    );
}

// ─── Test 7: Null optional fields do not produce "undefined" ─────────────────
async function testNullOptionalFieldsSafe() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_null_safety.docx");

    const findingWithNulls = {
        finding: "Minor vibration observed",
        equipment: null,
        observedValue: null,
        limit: null,
        severity: null,
        evidence: "Vibration was noted during walk-around.",
        source: null,
    };

    await generateApprovalNote(
        {
            findings: [findingWithNulls],
            riskAssessment: {
                level: null,
                reason: "Insufficient data to establish risk level.",
            },
            recommendation: "Conduct secondary inspection.",
            citations: [],
        },
        { outputPath }
    );

    const docxContent = readDocxContent(outputPath);

    // Document must NEVER contain "undefined"
    assert.equal(
        docxContent.includes("undefined"),
        false,
        "Document must not contain 'undefined'"
    );

    // Document should display N/A or Not Determined gracefully
    assert.ok(docxContent.includes("N/A") || docxContent.includes("Not Determined"));
}

// ─── Test 8: Multiple findings are rendered ──────────────────────────────────
async function testMultipleFindingsRendered() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_multiple_findings.docx");

    await generateApprovalNote(
        {
            findings: [sampleFinding1, sampleFinding2],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    const docxContent = readDocxContent(outputPath);

    assert.ok(docxContent.includes("Bearing temperature exceeded operating limit"));
    assert.ok(docxContent.includes("High casing vibration detected"));
    assert.ok(docxContent.includes("92°C"));
    assert.ok(docxContent.includes("7.1 mm/s"));
    assert.ok(docxContent.includes("Finding 1"));
    assert.ok(docxContent.includes("Finding 2"));
}

// ─── Test 9: Risk level and reason are rendered ──────────────────────────────
async function testRiskLevelAndReasonRendered() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_risk_rendered.docx");

    await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    const docxContent = readDocxContent(outputPath);

    assert.ok(docxContent.includes("5. Risk Assessment"));
    assert.ok(docxContent.includes("HIGH"));
    assert.ok(docxContent.includes(sampleRiskAssessment.reason));
}

// ─── Test 10: Recommendation is rendered ────────────────────────────────────
async function testRecommendationRendered() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_rec_rendered.docx");

    await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    const docxContent = readDocxContent(outputPath);

    assert.ok(docxContent.includes("6. Recommendation"));
    assert.ok(docxContent.includes(sampleRecommendation));
}

// ─── Test 11: Citations are rendered ─────────────────────────────────────────
async function testCitationsRendered() {
    const outputPath = path.join(TEST_OUTPUT_DIR, "test_citations_rendered.docx");

    await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath }
    );

    const docxContent = readDocxContent(outputPath);

    assert.ok(docxContent.includes("7. References"));
    assert.ok(docxContent.includes("Demo_Maintenance_SOP.pdf"));
    assert.ok(docxContent.includes("Demo_Safety_SOP.pdf"));
    assert.ok(docxContent.includes("Page: 1"));
    assert.ok(docxContent.includes("Page: 3"));
}

// ─── Test 12: Custom output path and auto directory creation ────────────────
async function testCustomOutputPathAutoDir() {
    const customNestedPath = path.join(
        TEST_OUTPUT_DIR,
        "nested",
        "deep",
        "custom_approval_note.docx"
    );

    const resultPath = await generateApprovalNote(
        {
            findings: [sampleFinding1],
            riskAssessment: sampleRiskAssessment,
            recommendation: sampleRecommendation,
            citations: sampleCitations,
        },
        { outputPath: customNestedPath }
    );

    assert.equal(resultPath, path.resolve(customNestedPath));
    assert.ok(fs.existsSync(resultPath), "Nested output file must exist");
}

async function run() {
    cleanupTestDir();
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

    const tests = [
        ["Valid input generates DOCX", testValidInputGeneratesDocx],
        ["Output file exists and is non-empty", testOutputFileExistsAndNonEmpty],
        ["Missing findings is rejected", testMissingFindingsRejected],
        ["Invalid riskAssessment is rejected", testInvalidRiskAssessmentRejected],
        ["Missing recommendation is rejected", testMissingRecommendationRejected],
        ["Missing citations is rejected", testMissingCitationsRejected],
        ["Null optional fields do not produce 'undefined'", testNullOptionalFieldsSafe],
        ["Multiple findings are rendered", testMultipleFindingsRendered],
        ["Risk level and reason are rendered", testRiskLevelAndReasonRendered],
        ["Recommendation is rendered", testRecommendationRendered],
        ["Citations are rendered", testCitationsRendered],
        ["Custom output path with auto directory creation", testCustomOutputPathAutoDir],
    ];

    console.log("Running PR #16 Approval Note unit tests...\n");

    try {
        for (const [name, test] of tests) {
            await test();
            console.log(`  ✓ ${name}`);
        }

        console.log(`\n${tests.length} passed, 0 failed`);
        console.log("\n✅ PR #16 unit tests passed");
    } finally {
        cleanupTestDir();
    }
}

await run();
