import {
    generateEmbedding,
    EMBEDDING_DIMENSIONS,
} from "./embedding.service.js";

const text =
    "Reliance Industries operates across multiple sectors.";

try {
    const embedding = await generateEmbedding(text);

    console.log("Embedding generated successfully");

    console.log("Dimensions:", embedding.length);

    console.log("First 10 values:", embedding.slice(0, 10));

    console.log(
        "Correct dimensions:",
        embedding.length === EMBEDDING_DIMENSIONS
    );
} catch (error) {
    console.error(error);
}