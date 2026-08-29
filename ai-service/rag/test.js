import "dotenv/config";
import { randomUUID } from "crypto";

import { extractPdfText } from "../extraction/pdf.service.js";
import { chunkText } from "../chunking/chunk.service.js";
import { generateEmbedding } from "../embeddings/embedding.service.js";

import {
    createCollection,
    upsertChunks,
} from "../vectorstore/qdrant.service.js";

import { answerQuestion } from "./rag.service.js";

const PDF_PATH =
    "../backend/src/uploads/1af78bd3-35a4-499e-a4e8-8b504c299096.pdf";

const QUESTION =
    "tell me about hack heritage";

async function runRagTest() {
    console.log("=== PR #11 E2E RAG TEST ===\n");

    const documentId = randomUUID();

    try {
        // --------------------------------------------------
        // 1. Extract PDF
        // --------------------------------------------------

        console.log("1. Extracting PDF...");

        const extracted = await extractPdfText(PDF_PATH);

        if (!extracted.pages || !Array.isArray(extracted.pages)) {
            throw new Error(
                "Page-aware extraction did not return pages"
            );
        }

        if (
            extracted.pages.length !==
            extracted.pageCount
        ) {
            throw new Error(
                "Page count and extracted pages do not match"
            );
        }

        console.log(
            `✓ PDF extracted: ${extracted.pageCount} pages`
        );

        // --------------------------------------------------
        // 2. Chunk pages
        // --------------------------------------------------

        console.log("\n2. Chunking pages...");

        const chunks = chunkText(
            extracted.pages,
            documentId
        );

        if (!Array.isArray(chunks) || chunks.length === 0) {
            throw new Error("No chunks generated");
        }

        for (const chunk of chunks) {
            if (
                typeof chunk.page !== "number" ||
                chunk.page <= 0
            ) {
                throw new Error(
                    "Chunk is missing valid page number"
                );
            }

            if (
                typeof chunk.chunkIndex !== "number"
            ) {
                throw new Error(
                    "Chunk is missing chunkIndex"
                );
            }

            if (
                typeof chunk.pageStartOffset !==
                    "number" ||
                typeof chunk.pageEndOffset !==
                    "number"
            ) {
                throw new Error(
                    "Chunk is missing page offsets"
                );
            }
        }

        console.log(
            `✓ Generated ${chunks.length} page-aware chunks`
        );

        // --------------------------------------------------
        // 3. Generate embeddings
        // --------------------------------------------------

        console.log("\n3. Generating embeddings...");

        const chunksWithVectors = [];

        for (const chunk of chunks) {
            const vector = await generateEmbedding(
                chunk.text
            );

            if (vector.length !== 384) {
                throw new Error(
                    `Invalid embedding dimensions for chunk ${chunk.chunkIndex}`
                );
            }

            chunksWithVectors.push({
                ...chunk,
                vector,
            });
        }

        console.log(
            `✓ Generated ${chunksWithVectors.length} embeddings`
        );

        // --------------------------------------------------
        // 4. Store in Qdrant
        // --------------------------------------------------

        console.log("\n4. Storing chunks in Qdrant...");

        await createCollection();

        await upsertChunks(chunksWithVectors);

        console.log("✓ Chunks stored successfully");

        // --------------------------------------------------
        // 5. Run RAG
        // --------------------------------------------------

        console.log("\n5. Running RAG...");
        console.log(`Question: ${QUESTION}`);

        const result = await answerQuestion(QUESTION, {
    candidateLimit: 10,
    contextLimit: 5,
    scoreThreshold: 0.5,
    documentId,
});

        // --------------------------------------------------
        // 6. Validate answer
        // --------------------------------------------------

        if (
            !result ||
            typeof result.answer !== "string" ||
            !result.answer.trim()
        ) {
            throw new Error(
                "RAG returned an empty answer"
            );
        }

        console.log("\n6. Answer:");
        console.log(result.answer);

        // --------------------------------------------------
        // 7. Validate citations
        // --------------------------------------------------

        if (
            !Array.isArray(result.sources) ||
            result.sources.length === 0
        ) {
            throw new Error(
                "RAG did not return sources"
            );
        }

        for (const source of result.sources) {
            if (
                typeof source.documentId !==
                "string"
            ) {
                throw new Error(
                    "Source missing documentId"
                );
            }

            if (
                typeof source.page !== "number"
            ) {
                throw new Error(
                    "Source missing page number"
                );
            }

            if (
                typeof source.chunkIndex !==
                "number"
            ) {
                throw new Error(
                    "Source missing chunkIndex"
                );
            }

            if (
                typeof source.score !== "number"
            ) {
                throw new Error(
                    "Source missing similarity score"
                );
            }
        }

        console.log("\n7. Sources:");

        console.dir(result.sources, {
            depth: null,
        });

        // --------------------------------------------------
        // 8. Verify sources belong to this test document
        // --------------------------------------------------

        const wrongDocument =
            result.sources.some(
                (source) =>
                    source.documentId !== documentId
            );

        if (wrongDocument) {
            throw new Error(
                "Retrieved source belongs to another document"
            );
        }

        console.log(
            "\n✓ Sources belong to the test document"
        );

        // --------------------------------------------------
        // FINAL RESULT
        // --------------------------------------------------

        console.log(
            "\n================================="
        );

        console.log(
            "✅ PR #11 E2E RAG TEST PASSED"
        );

        console.log(
            "================================="
        );
    } catch (error) {
        console.error(
            "\n================================="
        );

        console.error(
            "❌ PR #11 E2E RAG TEST FAILED"
        );

        console.error(
            "================================="
        );

        console.error(error);

        process.exitCode = 1;
    }
}

await runRagTest();