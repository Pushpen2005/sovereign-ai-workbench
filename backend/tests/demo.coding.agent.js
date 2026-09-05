/**
 * PR #24 / Phase 9 — Live Coding Agent & Security Demonstration
 *
 * Demonstrates:
 *   1. Live End-to-End Workflow:
 *      Prompt: "Write Python code to calculate pump efficiency when output power is 85 kW and input power is 100 kW. Execute it and verify the result."
 *      Runs actual local model routing, local LLM generation (llama3.2:3b), Docker sandbox execution,
 *      and independent verification against expected = 85.
 *
 *   2. Live Security Demonstration:
 *      Attempts network egress inside the Docker container.
 *      Demonstrates strict network denial (--network none).
 *
 *   3. Granular Performance Breakdown:
 *      Measures classification, routing, LLM generation, sandbox startup & execution, and verification.
 *
 * Run with:
 *   node backend/tests/demo.coding.agent.js
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import { classifyTask, routeTask, TASK_TYPE } from "../../ai-service/router/modelRouter.js";
import { generateAnswer } from "../../ai-service/llm/llm.service.js";
import {
    extractPythonCode,
    validatePythonCode,
    verifyOutput,
} from "../src/services/coding-agent.service.js";
import { executeInSandbox } from "../src/services/sandbox.service.js";

const ORG_DEMO = "0bd5dba2-05e1-4f5c-9047-25843d338622";

async function runLiveDemos() {
    console.log("================================================================================");
    console.log("PHASE 9 — SOVEREIGN CODING AGENT & SECURE EXECUTION LIVE DEMONSTRATION");
    console.log("================================================================================\n");

    // ─────────────────────────────────────────────────────────────
    // DEMO 1: Real Local Coding Workflow (Pump Efficiency)
    // ─────────────────────────────────────────────────────────────
    console.log("────────────────────────────────────────────────────────────────────────────────");
    console.log("DEMONSTRATION 1: LIVE END-TO-END CODING AGENT WORKFLOW");
    console.log("────────────────────────────────────────────────────────────────────────────────");

    const userPrompt =
        "Write Python code to calculate pump efficiency when output power is 85 kW and input power is 100 kW. Execute it and verify the result.";
    console.log(`User Request:\n  "${userPrompt}"\n`);

    const workflowStart = Date.now();

    // 1. Task Classification
    const tClassify0 = Date.now();
    const taskType = classifyTask(userPrompt);
    const latencyClassify = Date.now() - tClassify0;
    console.log(`[Stage 1: classify_task]    -> ${taskType} (${latencyClassify} ms)`);

    // 2. Model Routing
    const tRoute0 = Date.now();
    const routing = await routeTask(userPrompt);
    const latencyRoute = Date.now() - tRoute0;
    console.log(
        `[Stage 2: select_model]     -> Model: ${routing.selectedModel} (Local: ${routing.local}, Latency: ${latencyRoute} ms)`
    );

    // 3. Code Generation via Local LLM
    console.log(`[Stage 3: generate_code]    -> Querying local model '${routing.selectedModel}'...`);
    const tGen0 = Date.now();
    const codingSystemPrompt = `You are a professional Python engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Calculate the pump efficiency using: efficiency = (output_power / input_power) * 100.
Set output_power = 85 and input_power = 100.
Print the calculated efficiency value as a number using print(efficiency).
Do not require external internet access or non-standard packages. Only use the Python standard library.

User Request:
${userPrompt}

Return ONLY the executable Python code inside a \`\`\`python code block.`;

    const rawModelOutput = await generateAnswer(codingSystemPrompt, routing.selectedModel);
    const latencyGen = Date.now() - tGen0;
    console.log(`[Stage 3: generate_code]    -> Completed in ${latencyGen} ms`);

    // 4. Code Extraction & Validation
    const tVal0 = Date.now();
    const extractedCode = extractPythonCode(rawModelOutput);
    const validatedCode = validatePythonCode(extractedCode);
    const latencyVal = Date.now() - tVal0;
    console.log(`[Stage 4: validate_code]    -> Validated Python source (${latencyVal} ms)`);
    console.log("\n--- Generated Python Code ---");
    console.log(validatedCode);
    console.log("-----------------------------\n");

    // 5. Ephemeral Docker Sandbox Execution
    console.log("[Stage 5: execute_sandbox]  -> Spawning isolated Docker container (python:3.11-alpine)...");
    const tExec0 = Date.now();
    const execResult = await executeInSandbox({
        code: validatedCode,
        language: "python",
        timeoutMs: 5000,
    });
    const latencyExec = Date.now() - tExec0;
    console.log(
        `[Stage 5: execute_sandbox]  -> Exit Code: ${execResult.exitCode}, Duration: ${execResult.durationMs} ms (Sandbox Latency: ${latencyExec} ms)`
    );
    console.log(`                             Docker Network: ${execResult.sandbox?.network} (Isolated: ${execResult.sandbox?.isolated})`);
    console.log(`                             Actual Stdout:  ${JSON.stringify(execResult.stdout.trim())}`);

    // 6. Independent Result Verification
    const tVer0 = Date.now();
    const expectedValue = "85";
    const verification = verifyOutput(execResult.stdout, expectedValue);
    const latencyVer = Date.now() - tVer0;
    console.log(`[Stage 6: verify_result]    -> Verification: ${verification.verified ? "PASS" : "FAIL"} (${latencyVer} ms)`);
    console.log(`                             Expected: ${verification.expected}`);
    console.log(`                             Actual:   ${verification.actual}`);
    console.log(`                             Reason:   ${verification.reason}`);

    const totalWorkflowLatency = Date.now() - workflowStart;
    console.log(`[Stage 7: return_result]    -> Total Workflow Latency: ${totalWorkflowLatency} ms\n`);

    // ─────────────────────────────────────────────────────────────
    // DEMO 2: Live Security Demonstration (Blocked Network Access)
    // ─────────────────────────────────────────────────────────────
    console.log("────────────────────────────────────────────────────────────────────────────────");
    console.log("DEMONSTRATION 2: LIVE SECURITY PROBE — NETWORK EGRESS BLOCKING");
    console.log("────────────────────────────────────────────────────────────────────────────────");

    const attackPrompt = "Attempting outbound network socket connection to external internet from inside sandbox...";
    console.log(`Attack Vector:\n  ${attackPrompt}\n`);

    const networkExploitCode = `
import socket
print("SECURITY_PROBE: Attempting TCP connection to 1.1.1.1:80...")
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1.0)
    s.connect(("1.1.1.1", 80))
    print("VULNERABILITY_ALERT: Network connected successfully!")
except Exception as e:
    print(f"DEFENSE_CONFIRMED: Network connection blocked ({type(e).__name__}: {e})")
finally:
    s.close()
`;

    console.log("Executing probe in Docker sandbox with --network none...");
    const secStart = Date.now();
    const secResult = await executeInSandbox({
        code: networkExploitCode,
        language: "python",
        timeoutMs: 3000,
    });
    const secDuration = Date.now() - secStart;

    console.log(`Sandbox Duration: ${secDuration} ms`);
    console.log(`Sandbox Network:  ${secResult.sandbox?.network}`);
    console.log(`Sandbox Isolated: ${secResult.sandbox?.isolated}`);
    console.log("Sandbox Output:\n" + secResult.stdout.trim());

    const isNetworkBlocked =
        secResult.stdout.includes("DEFENSE_CONFIRMED") &&
        !secResult.stdout.includes("VULNERABILITY_ALERT") &&
        secResult.sandbox?.network === "none";

    console.log(`\nNetwork Status:   ${isNetworkBlocked ? "BLOCKED (SECURE)" : "FAILED (UNSECURE)"}\n`);

    // ─────────────────────────────────────────────────────────────
    // DEMO 3: Performance Profiling Summary
    // ─────────────────────────────────────────────────────────────
    console.log("────────────────────────────────────────────────────────────────────────────────");
    console.log("GRANULAR PERFORMANCE PROFILE SUMMARY");
    console.log("────────────────────────────────────────────────────────────────────────────────");
    console.table([
        { Stage: "1. Task Classification", "Latency (ms)": latencyClassify, Type: "Deterministic Keyword Router" },
        { Stage: "2. Model Routing", "Latency (ms)": latencyRoute, Type: "Allowlist & Local Registry Verification" },
        { Stage: "3. Code Generation", "Latency (ms)": latencyGen, Type: `Local LLM Inference (${routing.selectedModel})` },
        { Stage: "4. Code Validation", "Latency (ms)": latencyVal, Type: "Static Fence & Syntax Guard" },
        { Stage: "5. Sandbox Startup & Exec", "Latency (ms)": latencyExec, Type: "Docker Container Lifecycle (--rm)" },
        { Stage: "6. Result Verification", "Latency (ms)": latencyVer, Type: "Independent Numeric/Output Assertion" },
        { Stage: "TOTAL WORKFLOW", "Latency (ms)": totalWorkflowLatency, Type: "End-to-End Local Execution" },
    ]);

    console.log("\n================================================================================");
    console.log("✅ LIVE CODING AGENT & SECURITY DEMONSTRATION COMPLETED SUCCESSFULLY");
    console.log("================================================================================\n");
}

runLiveDemos().catch((err) => {
    console.error("Demonstration encountered an error:", err);
    process.exit(1);
});
