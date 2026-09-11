import { runAgentLoop } from "./src/services/agent.service.js";
import { runFastRagWorkflow } from "./src/services/fast-rag.service.js";
import { classifyTask } from "../ai-service/router/modelRouter.js";

async function runTest(testName, goal) {
    console.log(`\n==================================================`);
    console.log(`Starting ${testName}`);
    console.log(`Goal: "${goal}"`);
    console.log(`==================================================`);
    
    const taskType = classifyTask(goal);
    console.log(`[ROUTER] Classified task as: ${taskType}`);
    
    let result;
    const startTime = Date.now();
    try {
        if (taskType === "DOCUMENT_ANALYSIS" || taskType === "DOCUMENT") {
            result = await runFastRagWorkflow({
                goal,
                organizationId: "test-org",
                userId: "test-user"
            });
        } else {
            result = await runAgentLoop({
                goal,
                organizationId: "test-org",
                userId: "test-user"
            });
        }
        const endTime = Date.now();
        
        console.log(`\n--- RESULT ---`);
        console.log(`Status: ${result.status}`);
        console.log(`Stopped Reason: ${result.stoppedReason}`);
        console.log(`Total Steps: ${result.totalSteps}`);
        console.log(`Duration: ${result.durationMs}ms`);
        console.log(`Final Answer:\n${result.finalAnswer}`);
        
        console.log(`\n--- TOOL EXECUTION HISTORY ---`);
        const searchCount = result.stepHistory?.filter(s => s.tool === "document_search").length || 0;
        const generateCount = result.stepHistory?.filter(s => s.tool === "document_generate").length || 0;
        
        console.log(`document_search calls: ${searchCount}`);
        console.log(`document_generate calls: ${generateCount}`);
        
        if (result.stepHistory) {
            result.stepHistory.forEach((step, idx) => {
                console.log(`[Step ${idx + 1}] ${step.tool} - ${step.resultSummary}`);
            });
        }
        
    } catch (e) {
        console.error("Test failed:", e);
    }
}

async function main() {
    await runTest("Test A", "What is the bearing temperature limit mentioned in the internal documents?");
    await runTest("Test B", "Analyze this inspection report, compare it against the applicable SOP, assess the risks and prepare an approval note.");
    process.exit(0);
}

main();
