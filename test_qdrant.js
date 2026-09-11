import { answerQuestion } from "./ai-service/rag/rag.service.js";

async function run() {
    try {
        const question = "tell about tatastell";
        console.log(`Asking question: ${question}`);

        // We will try an organization ID that was found in DB
        const orgId = "ad51f0f1-bca5-4076-8b8f-a8a64faecd76";
        
        const response = await answerQuestion(question, { organizationId: orgId });
        
        console.log("=== RAG RESPONSE ===");
        console.log("Answer:", response.answer);
        console.log("Grounded:", response.grounded);
        console.log("Sources:", response.sources?.length);
        console.log("Reason:", response.reason);
        console.log("Timings:", response.timings);

    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

run();
