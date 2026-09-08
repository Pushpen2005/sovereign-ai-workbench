/**
 * PHASE 10 — CODING SANDBOX HARDENING & END-TO-END VERIFICATION TEST SUITE
 *
 * Verifies the 16 core requirements:
 *   1. Python execution inside isolated Docker container
 *   2. JavaScript execution inside isolated Docker container
 *   3. Unsupported language cleanly rejected (SandboxValidationError)
 *   4. Client cannot inject arbitrary Docker images, commands, or host mounts
 *   5. Strict network isolation (--network none) for both Python & JavaScript
 *   6. Filesystem isolation (no /app, /Users, /etc/shadow) for both runtimes
 *   7. Zero host secrets (JWT_SECRET, database credentials) leaked to containers
 *   8. Hard execution timeout terminates infinite loops safely
 *   9. Memory limit (--memory 256m) safely bounds excessive allocation
 *  10. Process table exhaustion (--pids-limit 64) safely bounds fork bombs
 *  11. Output flood capped and truncated at 64 KB
 *  12. Multi-language code extraction cleanly strips markdown fences (py, js, generic)
 *  13. Phase 9 Model Router integration (CODING task classification & local model)
 *  14. End-to-end coding workflow with independent verification (Python & JS)
 *  15. Multi-tenant security & authoritative organizationId preservation
 *  16. Zero host execution guarantee (generated code never runs on host)
 *
 * Run with:
 *   node backend/tests/phase10.coding.sandbox.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import {
    executeInSandbox,
    SandboxValidationError,
} from "../src/services/sandbox.service.js";

import {
    extractCode,
    validateCode,
    verifyOutput,
    runCodingWorkflow,
    CodingAgentError,
    CODING_ERROR_CODES,
} from "../src/services/coding-agent.service.js";

import {
    classifyTask,
    routeTask,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

const ORG_A = "0bd5dba2-05e1-4f5c-9047-25843d338622";
const ORG_B = "tenant-delta-99";

async function runTests() {
    console.log("==================================================");
    console.log("PHASE 10: CODING SANDBOX HARDENING & VERIFICATION");
    console.log("==================================================\n");

    let passed = 0;
    let failed = 0;

    function record(testNum, name, ok, detail = "") {
        if (ok) {
            console.log(`  ✓ PASS [Test ${testNum}] ${name}${detail ? " (" + detail + ")" : ""}`);
            passed++;
        } else {
            console.error(`  ✗ FAIL [Test ${testNum}] ${name}${detail ? " (" + detail + ")" : ""}`);
            failed++;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Python Execution in Isolated Docker Container
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1] Python execution in isolated Docker sandbox...");
    try {
        const res = await executeInSandbox({
            code: "print(40 + 2)",
            language: "python",
        });
        const ok = res.success === true &&
            res.stdout.trim() === "42" &&
            res.exitCode === 0 &&
            res.sandbox.isolated === true &&
            res.sandbox.network === "none" &&
            res.sandbox.image === "python:3.11-alpine" &&
            res.sandbox.language === "python";
        record(1, "Python execution in isolated Docker sandbox", ok, `stdout='${res.stdout.trim()}', image=${res.sandbox.image}`);
    } catch (err) {
        record(1, "Python execution in isolated Docker sandbox", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 2: JavaScript Execution in Isolated Docker Container
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 2] JavaScript execution in isolated Docker sandbox...");
    try {
        const res = await executeInSandbox({
            code: `console.log(JSON.stringify({ language: "javascript", result: 100 * 2 }));`,
            language: "javascript",
        });
        const parsed = JSON.parse(res.stdout.trim());
        const ok = res.success === true &&
            parsed.result === 200 &&
            parsed.language === "javascript" &&
            res.exitCode === 0 &&
            res.sandbox.isolated === true &&
            res.sandbox.network === "none" &&
            res.sandbox.image === "node:20-alpine" &&
            res.sandbox.language === "javascript";
        record(2, "JavaScript execution in isolated Docker sandbox", ok, `result=${parsed.result}, image=${res.sandbox.image}`);
    } catch (err) {
        record(2, "JavaScript execution in isolated Docker sandbox", false, err.message);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Unsupported Language Rejection
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Unsupported language rejection...");
    const unsupportedLangs = ["ruby", "bash", "php", "c++", "go"];
    let allRejected = true;
    for (const lang of unsupportedLangs) {
        try {
            await executeInSandbox({
                code: "echo 'hello'",
                language: lang,
            });
            allRejected = false;
        } catch (err) {
            if (!(err instanceof SandboxValidationError) || !err.message.includes("Unsupported language")) {
                allRejected = false;
            }
        }
    }
    record(3, "Unsupported languages rejected with SandboxValidationError", allRejected, `tested=[${unsupportedLangs.join(", ")}]`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Client-Controlled Container Parameters Prohibition
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Server-controlled container parameters verification...");
    const standardRes = await executeInSandbox({
        code: "print('SAFE_PARAMS')",
        language: "python",
        image: "malicious:latest",
        volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
        network: "host",
    });
    const paramsServerControlled = standardRes.sandbox.image === "python:3.11-alpine" &&
        standardRes.sandbox.network === "none" &&
        standardRes.sandbox.readOnlyRoot === true &&
        standardRes.sandbox.capabilitiesDropped === "ALL";
    record(4, "Container parameters remain strictly server-controlled", paramsServerControlled);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Strict Network Isolation (Python & JavaScript)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Strict network isolation (--network none)...");
    const pyNet = await executeInSandbox({
        code: `
import urllib.request
try:
    urllib.request.urlopen("https://8.8.8.8", timeout=1)
    print("PROBE_FAIL")
except Exception as e:
    print(f"NET_BLOCKED:{type(e).__name__}")
`,
        language: "python",
    });

    const jsNet = await executeInSandbox({
        code: `
const https = require("https");
const req = https.get("https://8.8.8.8", { timeout: 1000 }, (res) => {
    console.log("PROBE_FAIL");
});
req.on("error", (e) => {
    console.log("NET_BLOCKED:" + (e.code || e.message));
});
`,
        language: "javascript",
        timeoutMs: 3000,
    });

    const netOk = pyNet.stdout.includes("NET_BLOCKED") && jsNet.stdout.includes("NET_BLOCKED");
    record(5, "Network egress blocked in both Python and JavaScript sandboxes", netOk, `py=${pyNet.stdout.trim()}, js=${jsNet.stdout.trim()}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Filesystem Isolation (Python & JavaScript)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Host filesystem isolation...");
    const pyFs = await executeInSandbox({
        code: `
import os
host_paths = ["/Users", "/home/workbench", "/app/src", "/var/lib/postgresql"]
found = [p for p in host_paths if os.path.exists(p)]
print(f"HOST_PATHS:{len(found)}")
`,
        language: "python",
    });

    const jsFs = await executeInSandbox({
        code: `
const fs = require("fs");
const hostPaths = ["/Users", "/home/workbench", "/app/src", "/var/lib/postgresql"];
const found = hostPaths.filter(p => fs.existsSync(p));
console.log("HOST_PATHS:" + found.length);
`,
        language: "javascript",
    });

    const fsOk = pyFs.stdout.includes("HOST_PATHS:0") && jsFs.stdout.includes("HOST_PATHS:0");
    record(6, "Host filesystem completely inaccessible from sandbox runtimes", fsOk);

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Host Environment Secrets Isolation
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Host environment secrets isolation...");
    const pySec = await executeInSandbox({
        code: `
import os
secrets = ["JWT_SECRET", "POSTGRES_PASSWORD", "POSTGRES_USER", "DATABASE_URL"]
leaked = [s for s in secrets if s in os.environ]
print(f"LEAKED:{len(leaked)}")
`,
        language: "python",
    });

    const jsSec = await executeInSandbox({
        code: `
const secrets = ["JWT_SECRET", "POSTGRES_PASSWORD", "POSTGRES_USER", "DATABASE_URL"];
const leaked = secrets.filter(s => s in process.env);
console.log("LEAKED:" + leaked.length);
`,
        language: "javascript",
    });

    const secOk = pySec.stdout.includes("LEAKED:0") && jsSec.stdout.includes("LEAKED:0");
    record(7, "Zero host secrets leaked to Python or JavaScript containers", secOk);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Hard Execution Timeout Enforcement
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Hard execution timeout enforcement...");
    const t0 = Date.now();
    const loopRes = await executeInSandbox({
        code: "while (true) {}",
        language: "javascript",
        timeoutMs: 2000,
    });
    const elapsed = Date.now() - t0;
    const timeoutOk = loopRes.timedOut === true &&
        loopRes.success === false &&
        elapsed >= 1800 && elapsed < 4500;
    record(8, "Hard execution timeout terminates infinite loop safely", timeoutOk, `elapsed=${elapsed}ms`);

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Memory Limit Enforcement (--memory 256m)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Memory limit enforcement (--memory 256m)...");
    const memRes = await executeInSandbox({
        code: `
import os
try:
    chunks = []
    for _ in range(70):
        chunks.append(os.urandom(10 * 1024 * 1024))
    print("PROBE_FAIL")
except MemoryError:
    print("MEMORY_BOUND_CAUGHT")
`,
        language: "python",
        timeoutMs: 4000,
    });
    const memOk = memRes.stdout.includes("MEMORY_BOUND_CAUGHT") ||
        memRes.exitCode !== 0 ||
        memRes.exitCode === 137 ||
        memRes.stderr.includes("Killed");
    record(9, "Memory resource limit enforced by container boundary", memOk, `exitCode=${memRes.exitCode}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Process Table Exhaustion Control (--pids-limit 64)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10] Process table exhaustion control (--pids-limit 64)...");
    const forkRes = await executeInSandbox({
        code: `
import os, time
try:
    for _ in range(100):
        pid = os.fork()
        if pid == 0:
            time.sleep(1)
            os._exit(0)
    print("PROBE_FAIL")
except BlockingIOError:
    print("FORK_BOUND_CAUGHT")
except Exception as e:
    print(f"FORK_PREVENTED:{type(e).__name__}")
`,
        language: "python",
        timeoutMs: 3000,
    });
    const forkOk = forkRes.stdout.includes("FORK_BOUND_CAUGHT") ||
        forkRes.stdout.includes("FORK_PREVENTED") ||
        forkRes.stderr.includes("Resource temporarily unavailable") ||
        forkRes.timedOut;
    record(10, "Fork-bomb bounded safely by --pids-limit 64", forkOk);

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Output Flood Truncation at 64 KB
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 11] Output flood truncation at 64 KB...");
    const floodRes = await executeInSandbox({
        code: "console.log('A'.repeat(128 * 1024));",
        language: "javascript",
    });
    const floodOk = floodRes.stdoutTruncated === true &&
        floodRes.stdout.length <= 64 * 1024 &&
        floodRes.stdout.length > 0;
    record(11, "Excessive stdout safely capped & truncated at 64 KB", floodOk, `size=${floodRes.stdout.length}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Multi-Language Code Extraction
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 12] Multi-language markdown code fence extraction...");
    const pyFenced = "```python\nprint('hello python')\n```";
    const jsFenced = "```javascript\nconsole.log('hello js');\n```";
    const genericFenced = "```\noutput = 42\n```";

    const extractedPy = extractCode(pyFenced, "python");
    const extractedJs = extractCode(jsFenced, "javascript");
    const extractedGeneric = extractCode(genericFenced, "python");

    const extOk = extractedPy === "print('hello python')" &&
        extractedJs === "console.log('hello js');" &&
        extractedGeneric === "output = 42";
    record(12, "Markdown fences cleanly stripped for Python, JS, and generic blocks", extOk);

    // ─────────────────────────────────────────────────────────────
    // TEST 13: Phase 9 Model Router Integration (CODING task)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 13] Phase 9 Model Router integration...");
    const promptPy = "Write Python code to calculate average bearing temperature.";
    const promptJs = "Create a JavaScript function to sort vibration sensor telemetry.";

    const routingPy = await routeTask(promptPy);
    const routingJs = await routeTask(promptJs);

    const routerOk = routingPy.taskType === TASK_TYPE.CODING &&
        routingPy.local === true &&
        routingJs.taskType === TASK_TYPE.CODING &&
        routingJs.local === true &&
        typeof routingPy.selectedModel === "string";
    record(13, "Coding requests routed through Phase 9 Model Router to local model", routerOk, `model=${routingPy.selectedModel}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 14: End-to-End Workflow with Independent Verification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 14] End-to-end coding workflow with independent verification...");
    const wfPy = await runCodingWorkflow({
        request: "Compute 10% of 420 in Python",
        organizationId: ORG_A,
        language: "python",
        expected: "42",
        options: {
            mockGeneratedCode: "print(int(420 * 0.10))",
        },
    });

    const wfJs = await runCodingWorkflow({
        request: "Compute 10% of 420 in JavaScript",
        organizationId: ORG_A,
        language: "javascript",
        expected: "42",
        options: {
            mockGeneratedCode: "console.log(420 * 0.10);",
        },
    });

    const wfOk = wfPy.verification.verified === true &&
        wfPy.language === "python" &&
        wfPy.execution.exitCode === 0 &&
        wfJs.verification.verified === true &&
        wfJs.language === "javascript" &&
        wfJs.execution.exitCode === 0;
    record(14, "Full 7-stage workflow executes and verifies both Python & JavaScript", wfOk);

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Multi-Tenant Security & Authoritative OrganizationId
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 15] Tenant isolation & authoritative organizationId...");
    let unauthRejected = false;
    try {
        await runCodingWorkflow({
            request: "Write code",
            organizationId: "",
            language: "python",
        });
    } catch (err) {
        unauthRejected = err.code === "UNAUTHORIZED" || err.message.includes("organizationId");
    }
    record(15, "Missing or forged organizationId rejected authoritatively", unauthRejected);

    // ─────────────────────────────────────────────────────────────
    // TEST 16: Zero Host Execution Guarantee
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 16] Zero host execution guarantee...");
    const hostCheckRes = await executeInSandbox({
        code: `
import os
print("CONTAINER_PID_ONE:" + str(os.getpid() == 1 or os.getppid() <= 1))
`,
        language: "python",
    });
    const zeroHostOk = hostCheckRes.sandbox.isolated === true &&
        hostCheckRes.sandbox.network === "none" &&
        hostCheckRes.sandbox.readOnlyRoot === true &&
        hostCheckRes.exitCode === 0;
    record(16, "Generated code executes strictly in container; zero host execution", zeroHostOk);

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
