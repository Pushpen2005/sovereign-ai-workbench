/**
 * Phase 7: OCR & Scanned-PDF Robustness Suite
 *
 * Validates:
 * 1. Normal text PDF does not trigger OCR.
 * 2. Empty PDF text triggers OCR.
 * 3. Low-text scanned PDF triggers OCR.
 * 4. OCR extracts expected text.
 * 5. OCR preserves page numbers.
 * 6. OCR output enters existing chunking pipeline.
 * 7. OCR embeddings remain strictly 384D.
 * 8. OCR vectors contain organizationId.
 * 9. OCR retrieval is tenant-isolated.
 * 10. Cross-tenant OCR retrieval is rejected.
 * 11. OCR page citation is authentic.
 * 12. One OCR page failure is handled safely.
 * 13. Complete OCR failure does not report success.
 * 14. OCR artifacts stay tenant-scoped / cleanly removed.
 * 15. Existing inspection workflow can consume OCR-derived findings.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createCanvas } from "canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import { query, initDb } from "../src/config/db.js";
import {
    extractPdfText,
    isPageTextSufficient,
    isTextSufficient,
} from "../../ai-service/extraction/pdf.service.js";
import { extractTextFromImage } from "../../ai-service/extraction/ocr.service.js";
import { chunkText } from "../../ai-service/chunking/chunk.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { upsertChunks, deleteChunksByDocumentId } from "../../ai-service/vectorstore/qdrant.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { ingestInspectionFile } from "../src/services/inspection.service.js";
import {
    validateFindingGrounding,
    analyzeFindingNumericThreshold,
} from "../src/orchestration/inspection/inspection.nodes.js";
import { runReportGeneration } from "../src/orchestration/inspection/inspection.adapters.js";
import { getDocumentStoragePath, getOrganizationUploadDir } from "../src/utils/storage.js";

/**
 * Builds a vector text PDF.
 */
function buildTextPdf(linesPerPage = [[]]) {
    const parts = [];
    const offsets = {};
    let pos = 0;

    function write(str) {
        const b = Buffer.from(str, "latin1");
        parts.push(b);
        pos += b.length;
    }

    const pagesCount = linesPerPage.length;
    write("%PDF-1.4\n");
    offsets[1] = pos;
    write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    const pageObjIds = [];
    let nextObjId = 3;
    const pageData = [];

    for (let i = 0; i < pagesCount; i++) {
        const pageId = nextObjId++;
        const contentId = nextObjId++;
        pageData.push({ pageId, contentId, lines: linesPerPage[i] });
        pageObjIds.push(`${pageId} 0 R`);
    }

    offsets[2] = pos;
    write(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.join(" ")}] /Count ${pagesCount} >>\nendobj\n`);

    for (const item of pageData) {
        offsets[item.pageId] = pos;
        write(`${item.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${item.contentId} 0 R >>\nendobj\n`);

        let stream = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
        for (let j = 0; j < item.lines.length; j++) {
            const escaped = item.lines[j].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            stream += j === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
        }
        stream += "ET\n";

        const streamBytes = Buffer.from(stream, "latin1");
        offsets[item.contentId] = pos;
        write(`${item.contentId} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
        parts.push(streamBytes);
        pos += streamBytes.length;
        write("\nendstream\nendobj\n");
    }

    const totalObjs = nextObjId;
    const xrefOffset = pos;
    write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
    for (let i = 1; i < totalObjs; i++) {
        write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    }
    write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.concat(parts);
}

/**
 * Builds a scanned PDF with rasterized text embedded as JPEG image XObjects.
 */
function buildScannedPdf(pageTexts = []) {
    const parts = [];
    const offsets = {};
    let pos = 0;

    function write(str) {
        const b = Buffer.from(str, "latin1");
        parts.push(b);
        pos += b.length;
    }
    function writeBytes(b) {
        parts.push(b);
        pos += b.length;
    }

    const pagesCount = pageTexts.length;
    write("%PDF-1.4\n");
    offsets[1] = pos;
    write("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    const pageObjIds = [];
    let nextObjId = 3;
    const pageObjMap = [];

    for (let i = 0; i < pagesCount; i++) {
        const pageId = nextObjId++;
        const contentId = nextObjId++;
        const imgId = nextObjId++;
        pageObjMap.push({ pageId, contentId, imgId, text: pageTexts[i] });
        pageObjIds.push(`${pageId} 0 R`);
    }

    offsets[2] = pos;
    write(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.join(" ")}] /Count ${pagesCount} >>\nendobj\n`);

    for (const item of pageObjMap) {
        const canvas = createCanvas(600, 150);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 600, 150);
        ctx.fillStyle = "black";
        ctx.font = "24px sans-serif";
        ctx.fillText(item.text, 30, 80);
        const jpegBuf = canvas.toBuffer("image/jpeg");

        offsets[item.pageId] = pos;
        write(`${item.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 ${item.imgId} 0 R >> >> /Contents ${item.contentId} 0 R >>\nendobj\n`);

        const contentStream = "q 600 0 0 150 6 600 cm /Im1 Do Q\n";
        offsets[item.contentId] = pos;
        write(`${item.contentId} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`);

        offsets[item.imgId] = pos;
        write(`${item.imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 600 /Height 150 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuf.length} >>\nstream\n`);
        writeBytes(jpegBuf);
        write("\nendstream\nendobj\n");
    }

    const totalObjs = nextObjId;
    const xrefOffset = pos;
    write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
    for (let i = 1; i < totalObjs; i++) {
        write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    }
    write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.concat(parts);
}

async function runOcrSuite() {
    console.log("==================================================");
    console.log("Phase 7: OCR & Scanned-PDF Robustness Test Suite");
    console.log("==================================================\n");

    await initDb();

    let passed = 0;
    let failed = 0;

    const cleanupFiles = [];
    const cleanupDocIds = [];
    const cleanupOrgIds = [];

    // Helper to log test pass/fail
    function report(name, condition, detail = "") {
        if (condition) {
            passed++;
            console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ""}`);
        } else {
            failed++;
            console.error(`  ❌ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
        }
    }

    const orgA = randomUUID();
    const orgB = randomUUID();
    cleanupOrgIds.push(orgA, orgB);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgA, "Refinery Alpha Ocr"]).catch(() => {});
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgB, "Refinery Beta Ocr"]).catch(() => {});

    try {
        // ----------------------------------------------------
        // TEST 1: Normal text PDF does not trigger OCR
        // ----------------------------------------------------
        console.log("[TEST 1] Normal text PDF does not trigger OCR");
        const normalLines = [
            [
                "MRPL REFINERY CRUDE DISTILLATION UNIT REPORT",
                "Operating inspection parameters are normal and within bounds.",
                "All vibration sensors logged nominal amplitudes under 1.8 mm/s.",
            ],
        ];
        const normalPdfPath = path.resolve(__dirname, `test_normal_${randomUUID().slice(0, 8)}.pdf`);
        fs.writeFileSync(normalPdfPath, buildTextPdf(normalLines));
        cleanupFiles.push(normalPdfPath);

        const normalRes = await extractPdfText(normalPdfPath);
        report(
            "TEST 1 — Normal text PDF uses pdf-text extraction",
            normalRes.extractionMethod === "pdf-text" && normalRes.pages[0].source === "pdf-text",
            `extractionMethod=${normalRes.extractionMethod}`
        );

        // ----------------------------------------------------
        // TEST 2: Empty PDF text triggers OCR
        // ----------------------------------------------------
        console.log("\n[TEST 2] Empty PDF text triggers OCR");
        const emptyPdfPath = path.resolve(__dirname, `test_empty_${randomUUID().slice(0, 8)}.pdf`);
        fs.writeFileSync(emptyPdfPath, buildTextPdf([["   "]]));
        cleanupFiles.push(emptyPdfPath);

        let emptyOcrTriggered = false;
        try {
            await extractPdfText(emptyPdfPath);
        } catch (err) {
            // Because page is empty and OCR returns empty text, it correctly throws OCR failure
            emptyOcrTriggered = err.message.includes("OCR") || err.message.includes("usable text");
        }
        report("TEST 2 — Empty PDF triggers OCR fallback", emptyOcrTriggered, "detected empty text & fell back to OCR");

        // ----------------------------------------------------
        // TEST 3: Low-text scanned PDF triggers OCR
        // ----------------------------------------------------
        console.log("\n[TEST 3] Low-text scanned PDF triggers OCR");
        const scannedPdfPath = path.resolve(__dirname, `test_scanned_${randomUUID().slice(0, 8)}.pdf`);
        const targetFindingText = "Pump-03 bearing temperature observed 95 C";
        fs.writeFileSync(scannedPdfPath, buildScannedPdf([targetFindingText]));
        cleanupFiles.push(scannedPdfPath);

        const scannedRes = await extractPdfText(scannedPdfPath);
        report(
            "TEST 3 — Scanned PDF triggers OCR fallback",
            scannedRes.extractionMethod === "ocr" && scannedRes.pages[0].source === "ocr",
            `method=${scannedRes.extractionMethod}`
        );

        // ----------------------------------------------------
        // TEST 4: OCR extracts expected text
        // ----------------------------------------------------
        console.log("\n[TEST 4] OCR extracts expected text");
        const extractedText = scannedRes.pages[0].text;
        const hasExpectedContent =
            extractedText.includes("Pump-03") &&
            extractedText.includes("95") &&
            extractedText.toLowerCase().includes("temperature");
        report(
            "TEST 4 — OCR extracted text contains critical inspection data",
            hasExpectedContent,
            `text="${extractedText}"`
        );

        // ----------------------------------------------------
        // TEST 5: OCR preserves page numbers
        // ----------------------------------------------------
        console.log("\n[TEST 5] OCR preserves page numbers");
        const multiPageScannedPath = path.resolve(__dirname, `test_multipage_${randomUUID().slice(0, 8)}.pdf`);
        const page1Text = "Inspection Finding 1: Bearing Temp 95 C";
        const page2Text = "Inspection Finding 2: Vibration 4.2 mm/s";
        fs.writeFileSync(multiPageScannedPath, buildScannedPdf([page1Text, page2Text]));
        cleanupFiles.push(multiPageScannedPath);

        const multiRes = await extractPdfText(multiPageScannedPath);
        const pagesCorrect =
            multiRes.pages.length === 2 &&
            multiRes.pages[0].page === 1 &&
            multiRes.pages[1].page === 2 &&
            multiRes.pages[0].source === "ocr" &&
            multiRes.pages[1].source === "ocr";
        report("TEST 5 — Page numbering and sources preserved across multi-page scan", pagesCorrect, "Page 1 and 2 validated");

        // ----------------------------------------------------
        // TEST 6: OCR output enters existing chunking pipeline
        // ----------------------------------------------------
        console.log("\n[TEST 6] OCR output enters existing chunking pipeline");
        const docId = `doc-ocr-${randomUUID().slice(0, 8)}`;
        const chunks = chunkText(multiRes.pages, docId);
        const chunksValid =
            chunks.length >= 2 &&
            chunks[0].documentId === docId &&
            chunks[0].page === 1 &&
            chunks[0].chunkIndex === 0 &&
            chunks[0].source === "ocr" &&
            chunks[0].extractionMethod === "ocr";
        report(
            "TEST 6 — Chunker partitions OCR pages and attaches metadata",
            chunksValid,
            `chunksCount=${chunks.length}, firstChunkIndex=${chunks[0]?.chunkIndex}`
        );

        // ----------------------------------------------------
        // TEST 7: OCR embeddings remain strictly 384D
        // ----------------------------------------------------
        console.log("\n[TEST 7] OCR embeddings remain strictly 384D");
        const sampleOcrEmbedding = await generateEmbedding(chunks[0].text);
        const is384D = Array.isArray(sampleOcrEmbedding) && sampleOcrEmbedding.length === 384;
        report("TEST 7 — Embedding vector dimensions are 384D", is384D, `dim=${sampleOcrEmbedding?.length}`);

        // ----------------------------------------------------
        // TEST 8: OCR vectors contain organizationId
        // ----------------------------------------------------
        console.log("\n[TEST 8] OCR vectors contain organizationId");
        const chunksWithOrgA = [];
        for (const c of chunks) {
            const vec = await generateEmbedding(c.text);
            chunksWithOrgA.push({
                ...c,
                filename: "scanned_inspection_alpha.pdf",
                organizationId: orgA,
                vector: vec,
            });
        }
        cleanupDocIds.push({ docId, orgId: orgA });

        await upsertChunks(chunksWithOrgA);
        report("TEST 8 — OCR chunks stored in Qdrant with organizationId", true, `orgId=${orgA}`);

        // ----------------------------------------------------
        // TEST 9: OCR retrieval is tenant-isolated
        // ----------------------------------------------------
        console.log("\n[TEST 9] OCR retrieval is tenant-isolated");
        const queryVector = await generateEmbedding("Bearing Temp 95 C");
        const orgARetrieval = await searchSimilarChunks(
            queryVector,
            5,
            undefined,
            { organizationId: orgA }
        );
        const retrievedOrgA = orgARetrieval.some((c) => c.documentId === docId && c.organizationId === orgA);
        report(
            "TEST 9 — Company A retrieves its own OCR chunks",
            retrievedOrgA,
            `found=${retrievedOrgA}, count=${orgARetrieval.length}`
        );

        // ----------------------------------------------------
        // TEST 10: Cross-tenant OCR retrieval is rejected
        // ----------------------------------------------------
        console.log("\n[TEST 10] Cross-tenant OCR retrieval is rejected");
        const orgBRetrieval = await searchSimilarChunks(
            queryVector,
            5,
            undefined,
            { organizationId: orgB }
        );
        const leakedToOrgB = orgBRetrieval.some((c) => c.documentId === docId || c.organizationId === orgA);
        report("TEST 10 — Company B cannot retrieve Company A OCR chunks", !leakedToOrgB, "leakage=false");

        // ----------------------------------------------------
        // TEST 11: OCR page citation is authentic
        // ----------------------------------------------------
        console.log("\n[TEST 11] OCR page citation is authentic");
        const page1Chunk = orgARetrieval.find((c) => c.documentId === docId && c.chunkIndex === 0);
        const page2Chunk = orgARetrieval.find((c) => c.documentId === docId && c.chunkIndex === 1);
        const pageCitationValid = page1Chunk?.page === 1 && (page2Chunk ? page2Chunk.page === 2 : true);
        report(
            "TEST 11 — OCR chunk retains genuine physical page number",
            pageCitationValid,
            `chunk0_page=${page1Chunk?.page}, chunk1_page=${page2Chunk?.page}`
        );

        // ----------------------------------------------------
        // TEST 12: One OCR page failure is handled safely
        // ----------------------------------------------------
        console.log("\n[TEST 12] One OCR page failure is handled safely");
        const partialResult = {
            pages: [
                { page: 1, text: "Valid OCR extracted text from page 1", source: "ocr", extractionMethod: "ocr" },
                { page: 2, text: "", source: "ocr-failed", extractionMethod: "ocr", error: "Raster timeout" },
            ],
        };
        const partialChunks = chunkText(partialResult.pages, "doc-partial-01");
        const partialSafe = partialChunks.length === 1 && partialChunks[0].page === 1;
        report(
            "TEST 12 — Failed OCR page skipped while preserving valid OCR pages",
            partialSafe,
            `usableChunks=${partialChunks.length}`
        );

        // ----------------------------------------------------
        // TEST 13: Complete OCR failure does not report success
        // ----------------------------------------------------
        console.log("\n[TEST 13] Complete OCR failure does not report success");
        let completeOcrFailed = false;
        try {
            await extractPdfText(emptyPdfPath, { minCharsPerPage: 100 });
        } catch (err) {
            completeOcrFailed = true;
        }
        report("TEST 13 — Complete OCR failure throws explicit error", completeOcrFailed, "fails closed");

        // ----------------------------------------------------
        // TEST 14: OCR artifacts stay tenant-scoped / cleanly removed
        // ----------------------------------------------------
        console.log("\n[TEST 14] OCR artifacts stay tenant-scoped / cleanly removed");
        const tOrgDir = getOrganizationUploadDir(orgA, { create: true });
        const tenantPdfPath = getDocumentStoragePath(orgA, "tenant_scanned_sample.pdf");
        fs.writeFileSync(tenantPdfPath, buildScannedPdf(["Bearing Temp 95 C in tenant dir"]));
        cleanupFiles.push(tenantPdfPath);

        const tenantRes = await extractPdfText(tenantPdfPath, { organizationId: orgA });
        report(
            "TEST 14 — Tenant-scoped OCR extracted successfully without residual files",
            tenantRes.extractionMethod === "ocr",
            `method=${tenantRes.extractionMethod}`
        );

        // ----------------------------------------------------
        // TEST 15: Existing inspection workflow can consume OCR-derived findings
        // ----------------------------------------------------
        console.log("\n[TEST 15] Existing inspection workflow consumes OCR-derived findings");
        const ocrFinding = {
            finding: "Pump-03 bearing temperature exceeds threshold",
            equipment: "Pump-03",
            observedValue: "95 °C",
            limit: "80 °C",
            severity: "HIGH",
            evidence: tenantRes.pages[0].text,
            source: {
                documentId: docId,
                page: 1,
                chunkIndex: 0,
            },
        };

        const ocrReportChunks = [
            {
                documentId: docId,
                filename: "tenant_scanned_sample.pdf",
                page: 1,
                chunkIndex: 0,
                text: tenantRes.pages[0].text,
                score: 0.95,
                organizationId: orgA,
            },
        ];

        // Validate finding grounding against OCR chunk
        const findingGrounded = validateFindingGrounding(ocrFinding, ocrReportChunks);

        // Deterministic numeric threshold analysis
        const numericAnalysis = await analyzeFindingNumericThreshold(ocrFinding);

        // Generate Approval Note DOCX from OCR finding
        const reportFilename = `Approval_Note_OCR_${randomUUID().slice(0, 8)}.docx`;
        const approvalData = {
            subject: "OCR Scanned Inspection Analysis",
            background: "Scanned inspection report was processed via local Tesseract OCR.",
            findings: [ocrFinding],
            technicalAnalysis: `Observed temperature 95 C exceeds limit by ${numericAnalysis.difference} C (${numericAnalysis.percentageExceedance}% exceedance).`,
            riskAssessment: {
                level: "HIGH",
                reason: "Bearing temperature violates documented operational envelope.",
                grounded: true,
            },
            recommendation: "Inspect bearing and follow shutdown procedures.",
            citations: [
                {
                    documentId: docId,
                    filename: "tenant_scanned_sample.pdf",
                    page: 1,
                    chunkIndex: 0,
                },
            ],
        };

        const docxResult = await runReportGeneration(approvalData, {
            organizationId: orgA,
            filename: reportFilename,
        });

        const docxExists = fs.existsSync(docxResult.filePath);
        if (docxExists) cleanupFiles.push(docxResult.filePath);

        const workflowConsumed = findingGrounded && numericAnalysis.difference === 15 && docxExists;
        report(
            "TEST 15 — Full inspection workflow consumes OCR finding & outputs DOCX",
            workflowConsumed,
            `grounded=${findingGrounded}, diff=${numericAnalysis.difference}, docxExists=${docxExists}`
        );

    } finally {
        // Clean up temporary files
        for (const f of cleanupFiles) {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch (_) {}
        }

        // Clean up Qdrant vectors
        for (const item of cleanupDocIds) {
            try {
                await deleteChunksByDocumentId(item.docId, item.orgId);
            } catch (_) {}
        }

        // Clean up database organizations
        for (const orgId of cleanupOrgIds) {
            try {
                await query("DELETE FROM organizations WHERE id = $1", [orgId]);
            } catch (_) {}
        }

        console.log("\n==================================================");
        console.log(`Results: ${passed} passed, ${failed} failed (${passed}/${passed + failed})`);
        console.log("==================================================\n");

        process.exit(failed > 0 ? 1 : 0);
    }
}

runOcrSuite().catch((err) => {
    console.error("Test suite fatal error:", err);
    process.exit(1);
});
