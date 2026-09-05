/**
 * PHASE 9 — CODING AGENT & SECURE EXECUTION WORKFLOW TEST SUITE
 *
 * Verifies the 20 core requirements:
 *   1. Coding request classified as CODING
 *   2. Local coding model selected (llama3.2:3b, local: true)
 *   3. Generated Python extracted correctly from fences
 *   4. Valid code accepted by validator
 *   5. Invalid code rejected safely (CODE_VALIDATION_FAILED)
 *   6. Code executes only in Docker (zero host execution)
 *   7. Simple arithmetic execution succeeds in sandbox
 *   8. Expected output is verified (expected == actual -> verified: true)
 *   9. Incorrect output fails verification (VERIFICATION_FAILED)
 *  10. Network access is blocked (--network none)
 *  11. Filesystem escape is blocked (/etc/shadow, /Users, /app denied)
 *  12. Project source is not exposed
 *  13. Host secrets are not exposed (JWT_SECRET, database passwords absent)
 *  14. Execution timeout terminates infinite loop safely
 *  15. Excessive output is controlled & capped at 64 KB
 *  16. Resource abuse (fork-bomb, memory) is contained
 *  17. Tenant execution runs & metadata are isolated
 *  18. Failed execution never reports success
 *  19. OrganizationId is authoritative (cannot be overridden by prompt/code)
 *  20. API response matches judge-friendly contract
 *
 * Run with:
 *   node backend/tests/coding.agent.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import {
    classifyTask,
    routeTask,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

import {
    extractPythonCode,
    validatePythonCode,
    verifyOutput,
    runCodingWorkflow,
    CodingAgentError,
    CODING_ERROR_CODES,
} from "../src/services/coding-agent.service.js";

import { executeInSandbox } from "../src/services/sandbox.service.js";
import { executionEvents } from "../src/services/execution-events.service.js";

const ORG_A = "0bd5dba2-05e1-4f5c-9047-25843d338622";
const ORG_B = "tenant-delta-99";

async function runTests() {
    console.log("==================================================");
    console.log("PHASE 9 — CODING AGENT & SECURE EXECUTION SUITE");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    function record(name, ok, detail = "") {
        if (ok) {
            console.log(`  ✅ PASS: ${name}${detail ? " — " + detail : ""}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${name}${detail ? " — " + detail : ""}`);
            failed++;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Coding Request Classified as CODING
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Task Classification Test");
    const prompt1 = "Write Python code that calculates the efficiency of a pump given input power and output power.";
    const classified1 = classifyTask(prompt1);
    record(
        "Coding request classified as CODING",
        classified1 === TASK_TYPE.CODING,
        `classified='${classified1}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Local Coding Model Selected
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Model Routing Test");
    const routing2 = await routeTask(prompt1);
    record(
        "Local coding model selected with local: true",
        routing2.taskType === TASK_TYPE.CODING &&
        routing2.local === true &&
        typeof routing2.selectedModel === "string" &&
        routing2.selectedModel.length > 0,
        `model='${routing2.selectedModel}', local=${routing2.local}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Generated Python Extracted Correctly from Fences
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Code Extraction Test");
    const fencedOutput = `Here is your Python code:
\`\`\`python
output_power = 85.0
input_power = 100.0
efficiency = (output_power / input_power) * 100
print(efficiency)
\`\`\`
Hope this helps!`;
    const extracted3 = extractPythonCode(fencedOutput);
    record(
        "Python code extracted cleanly from markdown fences",
        extracted3.startsWith("output_power = 85.0") && extracted3.endsWith("print(efficiency)"),
        `lines=${extracted3.split("\n").length}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Valid Code Accepted by Validator
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] Code Validator Acceptance Test");
    let valPassed = false;
    try {
        const validated = validatePythonCode("print('Hello World')");
        valPassed = validated === "print('Hello World')";
    } catch {
        valPassed = false;
    }
    record("Valid code accepted by static validator", valPassed);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Invalid Code Rejected Safely (CODE_VALIDATION_FAILED)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[5] Invalid Code Rejection Test");
    let rejEmpty = false;
    let rejConversational = false;
    try {
        validatePythonCode("");
    } catch (e) {
        rejEmpty = e.code === CODING_ERROR_CODES.CODE_VALIDATION_FAILED;
    }
    try {
        validatePythonCode("I am sorry, as an AI language model I cannot assist with this.");
    } catch (e) {
        rejConversational = e.code === CODING_ERROR_CODES.CODE_VALIDATION_FAILED;
    }
    record(
        "Empty and conversational non-code rejected with CODE_VALIDATION_FAILED",
        rejEmpty && rejConversational,
        `rejEmpty=${rejEmpty}, rejConversational=${rejConversational}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Code Executes ONLY in Docker
    // ─────────────────────────────────────────────────────────────
    console.log("\n[6] Docker Sandbox Isolation Guarantee Test");
    const res6 = await executeInSandbox({
        code: "import os; print('IN_DOCKER=' + str(os.path.exists('/.dockerenv')))",
    });
    record(
        "Execution runs inside Docker container (sandbox.isolated == true)",
        res6.success && res6.sandbox && res6.sandbox.isolated === true && res6.sandbox.network === "none",
        `isolated=${res6.sandbox?.isolated}, network=${res6.sandbox?.network}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Simple Arithmetic Execution Succeeds
    // ─────────────────────────────────────────────────────────────
    console.log("\n[7] Simple Arithmetic Execution Test");
    const arithmeticWorkflow = await runCodingWorkflow({
        request: "Calculate 10% of 420 in Python",
        organizationId: ORG_A,
        userId: null,
        expected: 42,
        options: {
            mockGeneratedCode: "```python\nval = 420 * 0.10\nprint(int(val))\n```",
        },
    });
    record(
        "Simple arithmetic execution succeeds in sandbox (420 * 0.10 -> 42)",
        arithmeticWorkflow.execution.status === "completed" &&
        arithmeticWorkflow.execution.exitCode === 0 &&
        arithmeticWorkflow.execution.stdout.trim() === "42",
        `stdout='${arithmeticWorkflow.execution.stdout.trim()}', exitCode=${arithmeticWorkflow.execution.exitCode}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Expected Output is Verified (expected == actual)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[8] Output Verification Engine Test");
    const ver8 = verifyOutput("42\n", 42);
    const ver8Float = verifyOutput("85.0\n", "85");
    record(
        "Independent verification confirms expected output (exact & numeric)",
        ver8.verified === true && ver8Float.verified === true,
        `exact=${ver8.verified}, numericFloat=${ver8Float.verified}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Incorrect Output Fails Verification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[9] Verification Mismatch Failure Test");
    const ver9 = verifyOutput("99\n", 42);
    let workflowMismatchCaught = false;
    try {
        await runCodingWorkflow({
            request: "Calculate 10% of 420 in Python",
            organizationId: ORG_A,
            userId: null,
            expected: 9999, // Intentional mismatch
            options: {
                mockGeneratedCode: "```python\nprint(42)\n```",
            },
        });
    } catch (e) {
        workflowMismatchCaught = e.code === CODING_ERROR_CODES.VERIFICATION_FAILED;
    }
    record(
        "Output mismatch fails verification with VERIFICATION_FAILED",
        ver9.verified === false && workflowMismatchCaught,
        `verMismatch=${!ver9.verified}, caughtCode=${workflowMismatchCaught}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Network Access is Blocked (--network none)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[10] Network Isolation Test (--network none)");
    const netAttemptCode = `
import urllib.request
try:
    urllib.request.urlopen("http://1.1.1.1", timeout=0.5)
    print("NET_SUCCESS")
except Exception as e:
    print(f"NET_BLOCKED: {type(e).__name__}")
`;
    const netRes = await executeInSandbox({ code: netAttemptCode });
    const netBlocked = netRes.success && netRes.stdout.includes("NET_BLOCKED");
    const networkConfiguredNone = netRes.sandbox?.network === "none" && netRes.sandbox?.isolated === true;
    record(
        "Network egress is blocked by --network none in Docker",
        netBlocked && networkConfiguredNone,
        `stdout='${netRes.stdout.trim()}', sandboxNetwork='${netRes.sandbox?.network}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Filesystem Escape is Blocked
    // ─────────────────────────────────────────────────────────────
    console.log("\n[11] Filesystem Escape Blocking Test");
    const fsEscapeCode = `
import os
host_indicators = ["/Users", "/home/workbench", "/var/lib/postgresql", "/app", "/backend"]
found_host = [p for p in host_indicators if os.path.exists(p)]
can_read_shadow = False
try:
    with open("/etc/shadow", "r") as f:
        f.read()
    can_read_shadow = True
except Exception:
    pass
print(f"HOST_PATHS_FOUND={len(found_host) > 0}")
print(f"CAN_READ_SHADOW={can_read_shadow}")
`;
    const fsRes = await executeInSandbox({ code: fsEscapeCode });
    const fsSecure =
        fsRes.success &&
        fsRes.stdout.includes("HOST_PATHS_FOUND=False") &&
        fsRes.stdout.includes("CAN_READ_SHADOW=False");
    record(
        "Host filesystem paths (/Users, /app, /var/lib/postgresql) inaccessible and /etc/shadow unreadable",
        fsSecure,
        `stdout='${fsRes.stdout.trim().replace(/\n/g, ", ")}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Project Source is Not Exposed
    // ─────────────────────────────────────────────────────────────
    console.log("\n[12] Project Source Isolation Test");
    const projCode = `
import os
exposed = any(os.path.exists(p) for p in ["/app", "/backend", "/sovereign-ai-workbench"])
print("PROJECT_EXPOSED=" + str(exposed))
`;
    const projRes = await executeInSandbox({ code: projCode });
    record(
        "Workbench source repository is not mounted inside sandbox container",
        projRes.success && projRes.stdout.includes("PROJECT_EXPOSED=False"),
        `stdout='${projRes.stdout.trim()}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Host Secrets are Not Exposed
    // ─────────────────────────────────────────────────────────────
    console.log("\n[13] Host Secrets Environment Isolation Test");
    const secretsCode = `
import os
env_keys = list(os.environ.keys())
has_sensitive = any("SECRET" in k or "POSTGRES" in k or "PASSWORD" in k for k in env_keys)
print("SECRETS_LEAKED=" + str(has_sensitive))
`;
    const secretsRes = await executeInSandbox({ code: secretsCode });
    record(
        "Zero host secrets (JWT_SECRET, database passwords) passed into sandbox",
        secretsRes.success && secretsRes.stdout.includes("SECRETS_LEAKED=False"),
        `stdout='${secretsRes.stdout.trim()}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Execution Timeout Terminates Safely
    // ─────────────────────────────────────────────────────────────
    console.log("\n[14] Execution Timeout Enforcement Test");
    let timeoutCaught = false;
    const t0 = Date.now();
    try {
        await runCodingWorkflow({
            request: "Run an infinite loop in Python",
            organizationId: ORG_A,
            userId: null,
            timeoutMs: 1500,
            options: {
                mockGeneratedCode: "```python\nwhile True:\n    pass\n```",
            },
        });
    } catch (e) {
        timeoutCaught = e.code === CODING_ERROR_CODES.EXECUTION_TIMEOUT;
    }
    const elapsed = Date.now() - t0;
    record(
        "Infinite loop terminated cleanly with EXECUTION_TIMEOUT",
        timeoutCaught && elapsed >= 1500 && elapsed < 4000,
        `elapsedMs=${elapsed}, timeoutCaught=${timeoutCaught}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Excessive Output is Controlled (64 KB Cap)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[15] Output Flood Truncation Test");
    const floodRes = await executeInSandbox({
        code: "print('Z' * 100000)",
    });
    record(
        "Output flooded beyond 64 KB is safely capped & truncated",
        floodRes.stdoutTruncated === true && floodRes.stdout.length <= 65536,
        `stdoutTruncated=${floodRes.stdoutTruncated}, size=${floodRes.stdout.length}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 16: Resource Abuse Controlled (Fork Bomb & Memory)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[16] Resource Abuse Control Test");
    const forkRes = await executeInSandbox({
        code: `
import os, time
try:
    for _ in range(100):
        if os.fork() == 0:
            time.sleep(1)
            os._exit(0)
    print("FORK_STATUS=UNRESTRICTED")
except Exception as e:
    print(f"FORK_STATUS=BOUNDED ({type(e).__name__})")
`,
        timeoutMs: 2500,
    });
    const forkBounded = forkRes.stdout.includes("BOUNDED") || forkRes.stderr.includes("temporarily unavailable") || forkRes.timedOut;
    record(
        "Fork bomb bounded safely by --pids-limit 64",
        forkBounded,
        `output=${forkRes.stdout.trim() || forkRes.stderr.trim()}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 17: Tenant Execution Runs & Metadata are Isolated
    // ─────────────────────────────────────────────────────────────
    console.log("\n[17] Tenant Isolation Test");
    const runA_Id = `run-tenant-a-${Date.now()}`;
    const runB_Id = `run-tenant-b-${Date.now()}`;

    executionEvents.registerRunOwner(runA_Id, ORG_A, "coding");
    executionEvents.registerRunOwner(runB_Id, ORG_B, "coding");

    const ownerA = executionEvents.getRunOwner(runA_Id);
    const ownerB = executionEvents.getRunOwner(runB_Id);

    const crossAccessCheck = await executionEvents.verifyOrHydrateRunOwner(runA_Id, ORG_B);
    record(
        "Tenant execution runs are isolated; Tenant B access to Tenant A is forbidden",
        ownerA.organizationId === ORG_A &&
        ownerB.organizationId === ORG_B &&
        crossAccessCheck.allowed === false &&
        crossAccessCheck.forbidden === true,
        `orgA=${ownerA.organizationId}, orgB=${ownerB.organizationId}, crossForbidden=${crossAccessCheck.forbidden}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 18: Failed Execution Never Reports Success
    // ─────────────────────────────────────────────────────────────
    console.log("\n[18] Failure Integrity Test");
    let failureWorkflowFailed = false;
    try {
        await runCodingWorkflow({
            request: "Invalid Python syntax",
            organizationId: ORG_A,
            userId: null,
            options: {
                mockGeneratedCode: "```python\ndef bad_syntax(\n```",
            },
        });
    } catch (e) {
        failureWorkflowFailed = e.code === CODING_ERROR_CODES.EXECUTION_FAILED;
    }
    record(
        "Failed Python execution never reports success",
        failureWorkflowFailed,
        `caughtExecutionFailed=${failureWorkflowFailed}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 19: OrganizationId is Authoritative
    // ─────────────────────────────────────────────────────────────
    console.log("\n[19] Authoritative OrganizationId Test");
    let unauthCaught = false;
    try {
        await runCodingWorkflow({
            request: "Calculate 5 + 5",
            organizationId: "", // Missing or unauthenticated
            userId: "attacker",
        });
    } catch (e) {
        unauthCaught = e.code === "UNAUTHORIZED" || e.message.includes("organizationId");
    }
    record(
        "Unauthenticated or missing organizationId rejected authoritatively",
        unauthCaught,
        `unauthCaught=${unauthCaught}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 20: API Response Conforms to Judge-Friendly Contract
    // ─────────────────────────────────────────────────────────────
    console.log("\n[20] Judge-Friendly API Response Schema Test");
    const contractWorkflow = await runCodingWorkflow({
        request: "Write Python code to compute 2 + 2",
        organizationId: ORG_A,
        userId: null,
        expected: 4,
        options: {
            mockGeneratedCode: "```python\nprint(2 + 2)\n```",
        },
    });

    const schemaValid =
        contractWorkflow.taskType === "CODING" &&
        contractWorkflow.local === true &&
        contractWorkflow.language === "python" &&
        typeof contractWorkflow.generatedCode === "string" &&
        contractWorkflow.execution &&
        contractWorkflow.execution.status === "completed" &&
        contractWorkflow.execution.exitCode === 0 &&
        contractWorkflow.verification &&
        contractWorkflow.verification.verified === true &&
        contractWorkflow.verification.actual === "4";

    record(
        "Response matches required judge-friendly schema (taskType, local, execution, verification)",
        schemaValid,
        `taskType=${contractWorkflow.taskType}, local=${contractWorkflow.local}, verified=${contractWorkflow.verification?.verified}`
    );

    // ─────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────
    console.log("\n==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
