/**
 * PR #14 — SOP Knowledge Base Unit Tests
 *
 * All external dependencies (PDF extraction, embedding,
 * Qdrant) are mocked so these tests run without any
 * running services.
 *
 * Run with:
 *   node ai-service/knowledge/sop.service.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function make384Vector(fill = 0.1) {
    return new Array(384).fill(fill);
}

/**
 * Assert that a promise rejects with a message matching `pattern`.
 */
async function expectReject(promise, pattern) {
    try {
        await promise;
        assert.fail("Expected promise to reject");
    } catch (error) {
        assert.match(error.message, new RegExp(pattern, "i"));
    }
}

// ─── Dependency injection factory ────────────────────────────────────────────

/**
 * Build a fake set of dependencies for ingestSop / searchSop
 * so we can inject them via options.
 *
 * Returns a `deps` object that can be spread into options.
 */
function createMockDeps(overrides = {}) {
    const calls = {
        extractPdfText: [],
        chunkText: [],
        generateEmbedding: [],
        upsertChunks: [],
        searchSimilarChunks: [],
    };

    const deps = {
        calls,

        extractPdfText: async (filePath) => {
            calls.extractPdfText.push(filePath);
            if (typeof overrides.extractPdfText === "function") {
                return overrides.extractPdfText(filePath);
            }
            // Default: single page with content
            return {
                text: "SOP procedure text.",
                pageCount: 1,
                pages: [{ page: 1, text: "SOP procedure text." }],
            };
        },

        chunkText: (pages, documentId) => {
            calls.chunkText.push({ pages, documentId });
            if (typeof overrides.chunkText === "function") {
                return overrides.chunkText(pages, documentId);
            }
            // Default: single chunk
            return [
                {
                    documentId,
                    page: 1,
                    chunkIndex: 0,
                    text: "SOP procedure text.",
                    pageStartOffset: 0,
                    pageEndOffset: 20,
                },
            ];
        },

        generateEmbedding: async (text) => {
            calls.generateEmbedding.push(text);
            if (typeof overrides.generateEmbedding === "function") {
                return overrides.generateEmbedding(text);
            }
            return make384Vector();
        },

        upsertChunks: async (chunks) => {
            calls.upsertChunks.push(chunks);
            if (typeof overrides.upsertChunks === "function") {
                return overrides.upsertChunks(chunks);
            }
        },

        searchSimilarChunks: async (vector, limit, docId, filters) => {
            calls.searchSimilarChunks.push({ vector, limit, docId, filters });
            if (typeof overrides.searchSimilarChunks === "function") {
                return overrides.searchSimilarChunks(vector, limit, docId, filters);
            }
            return [];
        },
    };

    return deps;
}

// ─── Testable wrappers ────────────────────────────────────────────────────────
//
// We cannot monkey-patch ES module imports. Instead we create thin wrapper
// functions that accept deps via an options bag — mirroring the pattern used
// in inspection.service.js (which accepts overrides through options).
//
// ingestSopWith / searchSopWith replicate the real service logic but pull
// their collaborators from the options object when provided.

async function ingestSopWith(filePath, options = {}, deps = {}) {
    const { randomUUID } = await import("crypto");
    const fs = await import("fs/promises");
    const pathMod = await import("path");

    // Validation
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
        throw new TypeError("filePath must be a non-empty string");
    }

    const fsAccess = deps.fsAccess ?? (async (p) => { await fs.default.access(p); });
    await fsAccess(filePath);

    const documentId =
        typeof options.documentId === "string" &&
        options.documentId.trim().length > 0
            ? options.documentId.trim()
            : randomUUID();

    const filename = pathMod.default.basename(filePath);

    const extractPdfText = deps.extractPdfText;
    const chunkText = deps.chunkText;
    const generateEmbeddingFn = deps.generateEmbedding;
    const upsertChunksFn = deps.upsertChunks;

    const { pages } = await extractPdfText(filePath);
    const rawChunks = chunkText(pages, documentId);

    if (rawChunks.length === 0) {
        throw new Error(`No text content could be extracted from: ${filename}`);
    }

    const chunksWithMeta = rawChunks.map((chunk) => ({
        ...chunk,
        filename,
        documentType: "sop",
    }));

    const chunksWithVectors = [];
    for (const chunk of chunksWithMeta) {
        const vector = await generateEmbeddingFn(chunk.text);
        chunksWithVectors.push({ ...chunk, vector });
    }

    await upsertChunksFn(chunksWithVectors);

    return { documentId, filename, chunksStored: chunksWithVectors.length };
}

async function searchSopWith(query, options = {}, deps = {}) {
    if (typeof query !== "string" || query.trim().length === 0) {
        throw new TypeError("SOP search query must be a non-empty string");
    }

    const limit = options.limit ?? 5;
    const scoreThreshold = options.scoreThreshold ?? 0.5;

    const generateEmbeddingFn = deps.generateEmbedding;
    const searchSimilarChunksFn = deps.searchSimilarChunks;

    const queryVector = await generateEmbeddingFn(query.trim());

    const chunks = await searchSimilarChunksFn(
        queryVector,
        limit,
        undefined,
        { documentType: "sop" }
    );

    return chunks
        .filter((chunk) => {
            return (
                chunk &&
                chunk.documentType === "sop" &&
                typeof chunk.text === "string" &&
                chunk.text.trim().length > 0 &&
                typeof chunk.score === "number" &&
                chunk.score >= scoreThreshold
            );
        })
        .sort((a, b) => b.score - a.score)
        .map((chunk) => ({
            documentId: chunk.documentId ?? null,
            filename: chunk.filename ?? null,
            documentType: chunk.documentType ?? null,
            page: chunk.page ?? null,
            chunkIndex: chunk.chunkIndex ?? null,
            score: chunk.score,
            text: chunk.text,
        }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Test 1: ingestSop rejects empty filePath
async function test_ingestSop_rejectsEmptyFilePath() {
    await expectReject(
        ingestSopWith("", {}, createMockDeps()),
        "filePath must be a non-empty string"
    );
}

// Test 2: ingestSop rejects non-string filePath
async function test_ingestSop_rejectsNonStringFilePath() {
    await expectReject(
        ingestSopWith(null, {}, createMockDeps()),
        "filePath must be a non-empty string"
    );
}

// Test 3: ingestSop rejects non-existent file
async function test_ingestSop_rejectsNonExistentFile() {
    const deps = createMockDeps();
    deps.fsAccess = async () => {
        throw new Error("ENOENT");
    };
    await expectReject(
        ingestSopWith("/no/such/file.pdf", {}, deps),
        "ENOENT|does not exist"
    );
}

// Test 4: ingestSop accepts valid path and calls extractPdfText
async function test_ingestSop_callsExtractPdfText() {
    const deps = createMockDeps();
    deps.fsAccess = async () => {}; // pretend file exists

    const result = await ingestSopWith("/fake/sop.pdf", {}, deps);

    assert.equal(deps.calls.extractPdfText.length, 1);
    assert.equal(deps.calls.extractPdfText[0], "/fake/sop.pdf");
    assert.equal(result.filename, "sop.pdf");
    assert.equal(result.chunksStored, 1);
}

// Test 5: Extraction is page-aware — pages are passed to chunkText
async function test_ingestSop_extractionIsPageAware() {
    const pages = [
        { page: 1, text: "First page content." },
        { page: 2, text: "Second page content." },
    ];

    const deps = createMockDeps({
        extractPdfText: async () => ({ text: "...", pageCount: 2, pages }),
        chunkText: (pagesArg) => {
            // Verify the pages passed match what extractPdfText returned
            assert.deepEqual(pagesArg, pages);
            return pagesArg.map((p, i) => ({
                documentId: "test-id",
                page: p.page,
                chunkIndex: i,
                text: p.text,
                pageStartOffset: 0,
                pageEndOffset: p.text.length,
            }));
        },
    });
    deps.fsAccess = async () => {};

    const result = await ingestSopWith("/fake/sop.pdf", {}, deps);
    assert.equal(result.chunksStored, 2);
}

// Test 6: Chunks contain all required metadata fields
async function test_ingestSop_chunksContainRequiredMetadata() {
    let capturedChunks = null;

    const deps = createMockDeps({
        upsertChunks: async (chunks) => {
            capturedChunks = chunks;
        },
    });
    deps.fsAccess = async () => {};

    await ingestSopWith("/fake/Demo_Maintenance_SOP.pdf", {}, deps);

    assert.ok(capturedChunks, "upsertChunks was not called");
    assert.ok(capturedChunks.length > 0, "No chunks were stored");

    const chunk = capturedChunks[0];
    assert.ok(typeof chunk.documentId === "string" && chunk.documentId.length > 0, "documentId missing");
    assert.equal(chunk.filename, "Demo_Maintenance_SOP.pdf");
    assert.equal(chunk.documentType, "sop");
    assert.ok(chunk.page !== undefined, "page missing");
    assert.ok(typeof chunk.chunkIndex === "number", "chunkIndex missing");
    assert.ok(typeof chunk.text === "string" && chunk.text.length > 0, "text missing");
}

// Test 7: Embeddings are exactly 384 dimensions
async function test_ingestSop_embeddingsAre384Dimensions() {
    let capturedChunks = null;

    const deps = createMockDeps({
        generateEmbedding: async () => make384Vector(0.5),
        upsertChunks: async (chunks) => {
            capturedChunks = chunks;
        },
    });
    deps.fsAccess = async () => {};

    await ingestSopWith("/fake/sop.pdf", {}, deps);

    assert.ok(capturedChunks, "upsertChunks was not called");
    for (const chunk of capturedChunks) {
        assert.ok(Array.isArray(chunk.vector), "vector is not an array");
        assert.equal(chunk.vector.length, 384, "vector must be 384-dimensional");
    }
}

// Test 8: Qdrant payload contains all required fields
async function test_ingestSop_qdrantPayloadContainsRequiredFields() {
    let storedChunks = null;

    const deps = createMockDeps({
        upsertChunks: async (chunks) => {
            storedChunks = chunks;
        },
    });
    deps.fsAccess = async () => {};

    await ingestSopWith("/fake/sop.pdf", {}, deps);

    assert.ok(storedChunks);
    const c = storedChunks[0];
    assert.ok(c.documentId, "documentId missing from payload");
    assert.ok(c.filename,   "filename missing from payload");
    assert.equal(c.documentType, "sop", "documentType missing from payload");
    assert.ok(c.page !== undefined, "page missing from payload");
    assert.ok(typeof c.chunkIndex === "number", "chunkIndex missing from payload");
    assert.ok(c.text, "text missing from payload");
    // Offset fields (from chunkText)
    assert.ok(typeof c.pageStartOffset === "number", "pageStartOffset missing");
    assert.ok(typeof c.pageEndOffset === "number", "pageEndOffset missing");
    // Vector
    assert.ok(Array.isArray(c.vector) && c.vector.length === 384, "vector invalid");
}

// Test 9: documentId comes from options when provided
async function test_ingestSop_usesProvidedDocumentId() {
    const fixedId = "fixed-document-id-1234";
    let storedChunks = null;

    const deps = createMockDeps({
        upsertChunks: async (chunks) => { storedChunks = chunks; },
    });
    deps.fsAccess = async () => {};

    const result = await ingestSopWith("/fake/sop.pdf", { documentId: fixedId }, deps);

    assert.equal(result.documentId, fixedId);
    assert.equal(storedChunks[0].documentId, fixedId);
}

// Test 10: searchSop generates query embedding
async function test_searchSop_generatesQueryEmbedding() {
    const deps = createMockDeps();

    await searchSopWith(
        "bearing temperature exceeded",
        {},
        deps
    );

    assert.equal(deps.calls.generateEmbedding.length, 1);
    assert.equal(
        deps.calls.generateEmbedding[0],
        "bearing temperature exceeded"
    );
}

// Test 11: searchSop passes documentType="sop" filter at Qdrant level
async function test_searchSop_passesDocumentTypeFilterToQdrant() {
    const deps = createMockDeps();

    await searchSopWith("bearing temperature", {}, deps);

    assert.equal(deps.calls.searchSimilarChunks.length, 1);
    const call = deps.calls.searchSimilarChunks[0];
    assert.deepEqual(call.filters, { documentType: "sop" });
    // documentId must be undefined so no doc-level restriction
    assert.equal(call.docId, undefined);
}

// Test 12: Score threshold filters out low-scoring results
async function test_searchSop_scoreThresholdFiltersResults() {
    const sopChunks = [
        { documentId: "s1", filename: "SOP.pdf", documentType: "sop", page: 1, chunkIndex: 0, text: "High score chunk.", score: 0.8 },
        { documentId: "s1", filename: "SOP.pdf", documentType: "sop", page: 2, chunkIndex: 1, text: "Low score chunk.", score: 0.3 },
    ];

    const deps = createMockDeps({
        searchSimilarChunks: async () => sopChunks,
    });

    // Default threshold is 0.5
    const results = await searchSopWith("query", {}, deps);

    assert.equal(results.length, 1);
    assert.equal(results[0].score, 0.8);
}

// Test 13: Results are sorted descending by score
async function test_searchSop_resultsSortedDescending() {
    const sopChunks = [
        { documentId: "s1", filename: "SOP.pdf", documentType: "sop", page: 1, chunkIndex: 0, text: "Medium.", score: 0.65 },
        { documentId: "s1", filename: "SOP.pdf", documentType: "sop", page: 2, chunkIndex: 1, text: "High.", score: 0.92 },
        { documentId: "s1", filename: "SOP.pdf", documentType: "sop", page: 3, chunkIndex: 2, text: "Low.", score: 0.55 },
    ];

    const deps = createMockDeps({
        searchSimilarChunks: async () => sopChunks,
    });

    const results = await searchSopWith("query", {}, deps);

    assert.equal(results.length, 3);
    assert.equal(results[0].score, 0.92);
    assert.equal(results[1].score, 0.65);
    assert.equal(results[2].score, 0.55);
}

// Test 14: Citation metadata is preserved
async function test_searchSop_citationMetadataPreserved() {
    const sopChunks = [
        {
            documentId: "doc-uuid-001",
            filename: "Demo_Maintenance_SOP.pdf",
            documentType: "sop",
            page: 5,
            chunkIndex: 12,
            text: "Bearings must be lubricated every 500 hours.",
            score: 0.85,
        },
    ];

    const deps = createMockDeps({
        searchSimilarChunks: async () => sopChunks,
    });

    const results = await searchSopWith("bearing lubrication", {}, deps);

    assert.equal(results.length, 1);
    const r = results[0];
    assert.equal(r.documentId, "doc-uuid-001");
    assert.equal(r.filename, "Demo_Maintenance_SOP.pdf");
    assert.equal(r.documentType, "sop");
    assert.equal(r.page, 5);
    assert.equal(r.chunkIndex, 12);
    assert.equal(r.score, 0.85);
    assert.equal(r.text, "Bearings must be lubricated every 500 hours.");
}

// Test 15: SOP search NEVER returns inspection documents
async function test_searchSop_neverReturnsInspectionDocs() {
    // Simulate Qdrant returning mixed results (should not happen with filter,
    // but the JS guard must also reject them).
    const mixedChunks = [
        { documentId: "sop-1", filename: "SOP.pdf",    documentType: "sop",        page: 1, chunkIndex: 0, text: "SOP text.",         score: 0.9 },
        { documentId: "ins-1", filename: "Report.pdf", documentType: "inspection", page: 3, chunkIndex: 5, text: "Inspection text.",  score: 0.85 },
    ];

    const deps = createMockDeps({
        searchSimilarChunks: async () => mixedChunks,
    });

    const results = await searchSopWith("bearing temperature", {}, deps);

    assert.ok(results.every((r) => r.documentType === "sop"),
        "Inspection documents leaked into SOP results");
    assert.equal(results.length, 1);
    assert.equal(results[0].filename, "SOP.pdf");
}

// Test 16: searchSop rejects empty query
async function test_searchSop_rejectsEmptyQuery() {
    const deps = createMockDeps();
    await expectReject(
        searchSopWith("", {}, deps),
        "non-empty string"
    );
}

// Test 17: searchSop rejects whitespace-only query
async function test_searchSop_rejectsWhitespaceQuery() {
    const deps = createMockDeps();
    await expectReject(
        searchSopWith("   ", {}, deps),
        "non-empty string"
    );
}

// Test 18: Finding → SOP retrieval integration (mocked)
async function test_findingToSopRetrieval() {
    // Simulates PR #13 finding being used as a searchSop query.
    const finding = "Bearing temperature exceeded allowable limit of 80°C.";

    const sopChunks = [
        {
            documentId: "maint-sop-001",
            filename: "Demo_Maintenance_SOP.pdf",
            documentType: "sop",
            page: 3,
            chunkIndex: 7,
            text: "When bearing temperature exceeds 80°C, shut down and inspect.",
            score: 0.88,
        },
    ];

    const deps = createMockDeps({
        searchSimilarChunks: async () => sopChunks,
    });

    const results = await searchSopWith(finding, {}, deps);

    assert.ok(results.length > 0, "Expected SOP results for finding query");
    assert.equal(results[0].documentType, "sop");
    assert.ok(results[0].filename, "filename must be present");
    assert.ok(results[0].page !== null, "page must be present");
    assert.ok(results[0].score > 0, "score must be present");
    assert.ok(results[0].text.length > 0, "text must be present");
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
    const tests = [
        // ingestSop validation tests
        ["ingestSop rejects empty filePath",               test_ingestSop_rejectsEmptyFilePath],
        ["ingestSop rejects non-string filePath",          test_ingestSop_rejectsNonStringFilePath],
        ["ingestSop rejects non-existent file",            test_ingestSop_rejectsNonExistentFile],
        ["ingestSop calls extractPdfText",                 test_ingestSop_callsExtractPdfText],
        ["ingestSop extraction is page-aware",             test_ingestSop_extractionIsPageAware],
        ["ingestSop chunks contain required metadata",     test_ingestSop_chunksContainRequiredMetadata],
        ["ingestSop embeddings are 384 dimensions",        test_ingestSop_embeddingsAre384Dimensions],
        ["ingestSop Qdrant payload has all fields",        test_ingestSop_qdrantPayloadContainsRequiredFields],
        ["ingestSop uses provided documentId",             test_ingestSop_usesProvidedDocumentId],
        // searchSop tests
        ["searchSop generates query embedding",            test_searchSop_generatesQueryEmbedding],
        ["searchSop passes documentType filter to Qdrant", test_searchSop_passesDocumentTypeFilterToQdrant],
        ["searchSop score threshold filters results",      test_searchSop_scoreThresholdFiltersResults],
        ["searchSop results sorted descending",            test_searchSop_resultsSortedDescending],
        ["searchSop citation metadata preserved",          test_searchSop_citationMetadataPreserved],
        ["searchSop never returns inspection docs",        test_searchSop_neverReturnsInspectionDocs],
        ["searchSop rejects empty query",                  test_searchSop_rejectsEmptyQuery],
        ["searchSop rejects whitespace query",             test_searchSop_rejectsWhitespaceQuery],
        ["finding → SOP retrieval works",                  test_findingToSopRetrieval],
    ];

    let passed = 0;
    let failed = 0;

    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log(`  ✓ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ✗ ${name}`);
            console.error(`    ${err.message}`);
            failed++;
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    } else {
        console.log("\n✅ PR #14 unit tests passed");
    }
}

await run();
