import { randomUUID } from "crypto";
import { generateEmbedding } from "../embeddings/embedding.service.js";
import { searchSimilarChunks } from "./retrieval.service.js";
import { createCollection, upsertChunks } from "../vectorstore/qdrant.service.js";

const documentId = randomUUID();

const chunks = [
    {
        documentId,
        chunkIndex: 0,
        text: "Reliance Industries operates across multiple sectors.",
        startOffset: 0,
        endOffset: 55,
    },
    {
        documentId,
        chunkIndex: 1,
        text: "Reliance Industries has major businesses in energy and petrochemicals.",
        startOffset: 55,
        endOffset: 125,
    },
    {
        documentId,
        chunkIndex: 2,
        text: "Reliance Industries also operates in telecommunications and retail.",
        startOffset: 125,
        endOffset: 190,
    },
];

try {
    console.log("1. Creating collection...");

    await createCollection();

    console.log("2. Generating embeddings...");

    const chunksWithVectors = [];

    for (const chunk of chunks) {
        const vector = await generateEmbedding(chunk.text);

        chunksWithVectors.push({
            ...chunk,
            vector,
        });
    }

    console.log(
        `Generated ${chunksWithVectors.length} embeddings`
    );

    console.log("3. Storing chunks...");

    await upsertChunks(chunksWithVectors);

    console.log("4. Generating query embedding...");

    const query =
        "Which sectors does Reliance Industries operate in?";

    const queryVector = await generateEmbedding(query);

    console.log(
        "Query vector dimensions:",
        queryVector.length
    );

    console.log("5. Searching Qdrant...");

    const results = await searchSimilarChunks(
        queryVector,
        3
    );

    console.log("\n6. Search results:");

    console.dir(results, { depth: null });

    if (results.length === 0) {
        throw new Error(
            "No similar chunks were returned"
        );
    }

    const documentIds = new Set(
        results.map((result) => result.documentId)
    );

    if (documentIds.size !== 1) {
        throw new Error(
            "Results contain unexpected document IDs"
        );
    }

    const chunkIndexes = results.map(
        (result) => result.chunkIndex
    );

    const uniqueChunkIndexes = new Set(
        chunkIndexes
    );

    if (
        uniqueChunkIndexes.size !==
        chunkIndexes.length
    ) {
        throw new Error(
            "Duplicate chunks returned by retrieval"
        );
    }

    console.log(
        "\n✅ Results belong to one document"
    );

    console.log(
        "✅ Results contain distinct chunks"
    );

    console.log("\n7. Testing invalid inputs...");

    try {
        await searchSimilarChunks("invalid vector");
    } catch (error) {
        console.log(
            "Invalid vector rejected:",
            error.message
        );
    }

    try {
        await searchSimilarChunks([]);
    } catch (error) {
        console.log(
            "Empty vector rejected:",
            error.message
        );
    }

    try {
        await searchSimilarChunks(
            new Array(100).fill(0)
        );
    } catch (error) {
        console.log(
            "Wrong dimensions rejected:",
            error.message
        );
    }

    try {
        await searchSimilarChunks(
            queryVector,
            0
        );
    } catch (error) {
        console.log(
            "Invalid limit rejected:",
            error.message
        );
    }

    console.log("\n✅ PR #8 test passed");
} catch (error) {
    console.error("\n❌ PR #8 test failed");
    console.error(error);
}