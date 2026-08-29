/**
 * PR #16 — Approval Note DOCX Generation E2E Test
 *
 * Assembles realistic demo data from PR #13 (inspection finding)
 * and PR #15 (risk assessment + recommendation + SOP citation),
 * generates Approval_Note.docx, and verifies its contents via python-docx.
 *
 * Run with:
 *   node ai-service/reports/approval-note.e2e.test.js
 */

import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { generateApprovalNote } from "./approval-note.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E2E_OUTPUT_FILE = path.join(__dirname, "Approval_Note.docx");

function inspectDocxStructure(filePath) {
    const pythonCode = `
import sys
import json
from docx import Document

doc = Document(sys.argv[1])

paragraphs = [p.text for p in doc.paragraphs]
tables_text = []
for t in doc.tables:
    for row in t.rows:
        tables_text.append([c.text.strip() for c in row.cells])

result = {
    "paragraphs": paragraphs,
    "tables": tables_text,
    "sections_count": len(doc.sections)
}

print(json.dumps(result))
`;
    const stdout = execFileSync("python3", ["-c", pythonCode, filePath], {
        encoding: "utf8",
    });
    return JSON.parse(stdout);
}

async function run() {
    console.log("=== PR #16 — Approval Note DOCX Generation E2E Test ===\n");

    try {
        // 1. Prepare realistic industrial demo data (PR #13 + PR #15)
        const realisticData = {
            subject: "Inspection Report Analysis and Approval Recommendation — Pump-03",
            background:
                "Routine operational inspection of Pump-03 identified high bearing temperature exceeding normal design thresholds. Technical evaluation was conducted against authoritative SOPs.",
            findings: [
                {
                    finding: "Bearing temperature exceeded operating limit",
                    equipment: "Pump-03",
                    observedValue: "92 degrees C",
                    limit: "80 degrees C",
                    severity: "HIGH",
                    evidence:
                        "Pump-03 bearing temperature was recorded at 92 degrees C during thermographic and contact probe inspection.",
                    source: {
                        documentId: "insp-pump-03",
                        page: 2,
                        chunkIndex: 4,
                    },
                },
            ],
            technicalAnalysis:
                "Comparison of observed telemetry against Demo_Maintenance_SOP.pdf confirms the operating limit of 80 degrees C was exceeded by 12 degrees C. Continued operation at this temperature degrades lubricant viscosity and induces accelerated bearing raceway spalling.",
            riskAssessment: {
                level: "HIGH",
                reason:
                    "The observed bearing temperature of 92 degrees C significantly exceeds the documented operating limit of 80 degrees C, creating immediate risk of thermal seizure and catastrophic mechanical failure.",
            },
            recommendation:
                "Immediately inspect the bearing assembly, verify lubrication condition, check for abnormal vibration, and isolate equipment until cleared by mechanical maintenance.",
            citations: [
                {
                    documentId: "sop-001",
                    filename: "Demo_Maintenance_SOP.pdf",
                    page: 1,
                    chunkIndex: 2,
                },
            ],
        };

        // 2. Generate Approval Note DOCX
        console.log("  [1] Generating Approval_Note.docx...");
        const generatedPath = await generateApprovalNote(realisticData, {
            outputPath: E2E_OUTPUT_FILE,
        });

        console.log(`    → Generated file path: ${generatedPath}`);

        // 3. Verify file exists and has content
        console.log("\n  [2] Verifying physical file properties...");
        assert.ok(fs.existsSync(generatedPath), "Generated DOCX file must exist");

        const stats = fs.statSync(generatedPath);
        console.log(`    → File size: ${stats.size} bytes`);
        assert.ok(stats.size > 0, "File size must be greater than 0 bytes");
        assert.ok(stats.size > 2000, "File size indicates full structured document");

        // 4. Verify document structure and content via python-docx
        console.log("\n  [3] Inspecting document contents with python-docx...");
        const docStructure = inspectDocxStructure(generatedPath);

        const allParagraphs = docStructure.paragraphs.join("\n");
        const allTableCells = docStructure.tables
            .flat(2)
            .join(" ");
        const completeDocumentText = `${allParagraphs}\n${allTableCells}`;

        // Verify Title and Numbered Headings
        console.log("    → Checking required headings...");
        assert.ok(
            allParagraphs.includes("APPROVAL NOTE"),
            "Title 'APPROVAL NOTE' must be present"
        );
        assert.ok(
            allParagraphs.includes("1. Subject"),
            "Heading '1. Subject' must be present"
        );
        assert.ok(
            allParagraphs.includes("2. Background"),
            "Heading '2. Background' must be present"
        );
        assert.ok(
            allParagraphs.includes("3. Inspection Findings"),
            "Heading '3. Inspection Findings' must be present"
        );
        assert.ok(
            allParagraphs.includes("4. Technical Analysis"),
            "Heading '4. Technical Analysis' must be present"
        );
        assert.ok(
            allParagraphs.includes("5. Risk Assessment"),
            "Heading '5. Risk Assessment' must be present"
        );
        assert.ok(
            allParagraphs.includes("6. Recommendation"),
            "Heading '6. Recommendation' must be present"
        );
        assert.ok(
            allParagraphs.includes("7. References"),
            "Heading '7. References' must be present"
        );
        assert.ok(
            allParagraphs.includes("8. Approval"),
            "Heading '8. Approval' must be present"
        );

        // Verify Findings Content
        console.log("    → Checking findings data...");
        assert.ok(
            completeDocumentText.includes("Pump-03"),
            "Equipment 'Pump-03' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("92 degrees C"),
            "Observed value '92 degrees C' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("80 degrees C"),
            "Limit '80 degrees C' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("Bearing temperature exceeded operating limit"),
            "Finding description must be in document"
        );

        // Verify Risk Assessment Content
        console.log("    → Checking risk assessment data...");
        assert.ok(
            completeDocumentText.includes("HIGH"),
            "Risk level 'HIGH' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("thermal seizure"),
            "Risk reason must be in document"
        );

        // Verify Recommendation Content
        console.log("    → Checking recommendation data...");
        assert.ok(
            completeDocumentText.includes("Immediately inspect the bearing assembly"),
            "Recommendation text must be in document"
        );

        // Verify Citation Content
        console.log("    → Checking citation references...");
        assert.ok(
            completeDocumentText.includes("Demo_Maintenance_SOP.pdf"),
            "Citation filename must be in document"
        );
        assert.ok(
            completeDocumentText.includes("Page: 1"),
            "Citation page must be in document"
        );

        // Verify Approval Section
        console.log("    → Checking approval section placeholders...");
        assert.ok(
            completeDocumentText.includes("Prepared By:"),
            "Approval 'Prepared By:' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("SovereignAI"),
            "Approval 'SovereignAI' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("Reviewed By:"),
            "Approval 'Reviewed By:' must be in document"
        );
        assert.ok(
            completeDocumentText.includes("Approved By:"),
            "Approval 'Approved By:' must be in document"
        );

        // Verify absence of "undefined"
        console.log("    → Checking absence of 'undefined'...");
        assert.equal(
            completeDocumentText.includes("undefined"),
            false,
            "Document must not contain 'undefined'"
        );

        console.log("\n==============================================");
        console.log("✅ PR #16 E2E test passed successfully");
        console.log(`📁 Generated DOCX: ${generatedPath}`);
        console.log("==============================================");
    } catch (error) {
        console.error("\n❌ PR #16 E2E test failed");
        console.error(error);
        process.exit(1);
    }
}

await run();
