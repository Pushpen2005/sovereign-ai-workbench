import "dotenv/config";
import { generateAnswer } from "./llm.service.js";

async function runTests() {
    console.log("=== PR #9 LLM Gateway Tests ===\n");

    // Test 1: Basic generation
    try {
        console.log("Test 1: Basic generation");

        const answer = await generateAnswer(
            "What is the capital of India?"
        );

        if (!answer || !answer.trim()) {
            throw new Error("Answer is empty");
        }

        console.log("✓ LLM response received");
        console.log(`Answer: ${answer}\n`);
    } catch (error) {
        console.error(`✗ Test 1 failed: ${error.message}\n`);
    }

    // Test 2: Model override
    try {
        console.log("Test 2: Model override");

        const answer = await generateAnswer(
            "Explain what RAG is in one sentence.",
            "llama3.2:3b"
        );

        if (!answer || !answer.trim()) {
            throw new Error("Answer is empty");
        }

        console.log("✓ Model override works");
        console.log(`Answer: ${answer}\n`);
    } catch (error) {
        console.error(`✗ Test 2 failed: ${error.message}\n`);
    }

    // Test 3: Invalid prompt
    try {
        console.log("Test 3: Invalid prompt");

        await generateAnswer("");

        console.error("✗ Test 3 failed: empty prompt was accepted\n");
    } catch (error) {
        console.log(`✓ Invalid prompt rejected: ${error.message}\n`);
    }

    // Test 4: Invalid model
    try {
        console.log("Test 4: Invalid model");

        await generateAnswer(
            "What is India?",
            ""
        );

        console.error("✗ Test 4 failed: empty model was accepted\n");
    } catch (error) {
        console.log(`✓ Invalid model rejected: ${error.message}\n`);
    }
}

runTests();