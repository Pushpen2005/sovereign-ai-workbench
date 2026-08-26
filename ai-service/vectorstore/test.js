import { randomUUID } from "crypto";
const documentId = randomUUID();
import { generateEmbedding } from "../embeddings/embedding.service.js";

import {
    createCollection,
    upsertChunks,
    generatePointId,
} from "./qdrant.service.js";

import { QdrantClient } from "@qdrant/js-client-rest";

const COLLECTION_NAME = "documents";

const qdrant = new QdrantClient({
    url: "http://localhost:6333",
});

const chunk = {
    documentId,
    text: "Reliance Industries operates across multiple sectors.",
    chunkIndex: 0,
    startOffset: 0,
    endOffset: 55,
};

try {
    console.log("1. Creating collection...");

    await createCollection();

    console.log("2. Generating embedding...");

    const vector = await generateEmbedding(chunk.text);

    console.log("Embedding dimensions:", vector.length);

    console.log("3. Upserting chunk...");

    await upsertChunks([
        {
            ...chunk,
            vector,
        },
    ]);

    console.log("4. Retrieving stored point...");

    const pointId = generatePointId(
    chunk.documentId,
    chunk.chunkIndex
);

const result = await qdrant.retrieve(COLLECTION_NAME, {
    ids: [pointId],
    with_vector: true,
    with_payload: true,
});

    const point = result[0];

    if (!point) {
        throw new Error("Point was not found in Qdrant");
    }

    console.log("\n5. Verification");
    console.log(
    "Document ID:",
    point.payload?.documentId
);
    console.log(
        "Vector exists:",
        Array.isArray(point.vector)
    );

    console.log(
        "Vector dimensions:",
        point.vector?.length
    );

    console.log(
        "Payload exists:",
        point.payload !== undefined
    );

    console.log(
        "Text:",
        point.payload?.text
    );

    console.log(
        "Chunk index:",
        point.payload?.chunkIndex
    );

    console.log(
        "Start offset:",
        point.payload?.startOffset
    );

    console.log(
        "End offset:",
        point.payload?.endOffset
    );

    if (
        Array.isArray(point.vector) &&
        point.vector.length === 384 &&
        point.payload?.text === chunk.text &&
        point.payload?.chunkIndex === chunk.chunkIndex &&
        point.payload?.startOffset === chunk.startOffset &&
        point.payload?.endOffset === chunk.endOffset
    ) {
        console.log("\n✅ PR #7 test passed");
    } else {
        throw new Error("Stored point verification failed");
    }
} catch (error) {
    console.error("\n❌ PR #7 test failed");
    console.error(error);
}