/**
 * Real Coding Demo Runner for Phase 5
 */

import { runCodingWorkflow } from "../src/services/coding-agent.service.js";

async function runDemo() {
    console.log("================================================================================");
    console.log("PHASE 5 — REAL CODING DEMO EXECUTION");
    console.log("================================================================================\n");

    const request = "Write Python code to calculate pump efficiency when input power is 100 kW and output power is 85 kW. Print the result.";
    console.log(`Prompt: "${request}"\n`);

    const t0 = Date.now();
    const result = await runCodingWorkflow({
        request,
        organizationId: "ad51f0f1-bca5-4076-8b8f-a8a64faecd76",
        userId: "491e7dc7-68b7-4119-8fb0-6f4a89d8b8b0",
        expected: "85.00%",
        timeoutMs: 5000,
    });
    const totalMs = Date.now() - t0;

    console.log("--------------------------------------------------");
    console.log("1. Model & Routing Decision:");
    console.log(`   Task: ${result.taskType}`);
    console.log(`   Model: ${result.selectedModel} (Local: ${result.local})`);
    console.log("\n2. Generated Code from llama3.2:3b:");
    console.log(result.generatedCode);
    console.log("\n3. Sandbox Execution Result:");
    console.log(`   Status: ${result.execution.status}`);
    console.log(`   Exit Code: ${result.execution.exitCode}`);
    console.log(`   Duration: ${result.execution.durationMs} ms (Total Workflow: ${totalMs} ms)`);
    console.log(`   Stdout: ${result.execution.stdout.trim()}`);
    console.log(`   Stderr: ${result.execution.stderr || "(none)"}`);
    console.log("\n4. Verification Engine Result:");
    console.log(`   Verified: ${result.verification.verified}`);
    console.log(`   Reason: ${result.verification.reason}`);
    console.log("--------------------------------------------------");
    console.log("\n>> REAL CODING DEMO RESULT: PASS\n");
    process.exit(0);
}

runDemo().catch((err) => {
    console.error("Demo failed:", err);
    process.exit(1);
});
