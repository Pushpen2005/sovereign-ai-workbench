/**
 * PR #24 — Secure Coding Sandbox Test Suite
 *
 * Verifies:
 *   1. Successful Python computation & stdout/exitCode capture
 *   2. Infinite loop timeout enforcement & process termination
 *   3. Network isolation (--network none blocks outbound connections)
 *   4. Filesystem isolation (no access to host paths, zero leaked app secrets)
 *   5. Output flood truncation cap (64 KB limit enforced)
 *   6. Ephemeral container cleanup (zero leftover sandbox containers)
 *   7. Concurrent execution isolation
 *
 * Run with:
 *   node backend/tests/sandbox.test.js
 */

import assert from "node:assert/strict";
import { execSync } from "child_process";
import { executeInSandbox } from "../src/services/sandbox.service.js";

async function runTests() {
    console.log("==================================================");
    console.log("PR #24: Secure Coding Sandbox Verification Suite");
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
    // TEST 1: Benchmark Computation Test
    // ─────────────────────────────────────────────────────────────
    console.log("[1] Benchmark Python Execution Test");

    const t1Code = `
numbers = [10, 20, 30, 40, 50]
average = sum(numbers) / len(numbers)
print(average)
`;
    const res1 = await executeInSandbox({ code: t1Code });
    record(
        "Successful computation (expected 30.0)",
        res1.success === true && res1.exitCode === 0 && res1.stdout.trim() === "30.0",
        `exitCode=${res1.exitCode}, stdout='${res1.stdout.trim()}', duration=${res1.durationMs}ms`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Infinite Loop Timeout Test
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Infinite Loop Timeout Enforcement Test");

    const t2Code = `
while True:
    pass
`;
    const res2 = await executeInSandbox({ code: t2Code, timeoutMs: 2000 });
    record(
        "Infinite loop terminated by hard timeout",
        res2.timedOut === true && res2.success === false,
        `timedOut=${res2.timedOut}, duration=${res2.durationMs}ms, stderr='${res2.stderr}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Network Isolation Test (--network none)
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Network Isolation Verification Test");

    const t3Code = `
import socket
s = socket.socket()
s.settimeout(1.0)
try:
    s.connect(("1.1.1.1", 80))
    print("NET_CONNECTED")
except Exception as e:
    print(f"NET_BLOCKED: {type(e).__name__}")
finally:
    s.close()
`;
    const res3 = await executeInSandbox({ code: t3Code });
    const netBlocked = res3.stdout.includes("NET_BLOCKED");
    record(
        "Network connection blocked inside sandbox",
        res3.success === true && netBlocked,
        `stdout='${res3.stdout.trim()}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Filesystem & Secret Isolation Test
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] Filesystem & Environment Isolation Test");

    const t4Code = `
import os
has_app = os.path.exists("/app")
has_backend = os.path.exists("/backend")
has_host = os.path.exists("/host")
keys = list(os.environ.keys())
has_secrets = any("POSTGRES" in k or "OLLAMA" in k or "QDRANT" in k for k in keys)
print(f"HOST_FILES_ABSENT={not has_app and not has_backend and not has_host}")
print(f"SECRETS_ABSENT={not has_secrets}")
`;
    const res4 = await executeInSandbox({ code: t4Code });
    const fsIsolated = res4.stdout.includes("HOST_FILES_ABSENT=True") && res4.stdout.includes("SECRETS_ABSENT=True");
    record(
        "No host filesystem paths and no application secrets accessible",
        res4.success === true && fsIsolated,
        `output=${res4.stdout.trim().replace(/\n/g, ", ")}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Output Flood Truncation Test
    // ─────────────────────────────────────────────────────────────
    console.log("\n[5] Output Flood Truncation Test");

    const t5Code = `
print("A" * 100000)
`;
    const res5 = await executeInSandbox({ code: t5Code });
    record(
        "Output flooded beyond 64 KB is safely capped & flagged",
        res5.stdoutTruncated === true && res5.stdout.length <= 65536,
        `stdoutTruncated=${res5.stdoutTruncated}, capturedBytes=${res5.stdout.length}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Concurrent Execution Isolation Test
    // ─────────────────────────────────────────────────────────────
    console.log("\n[6] Concurrent Execution Isolation Test");

    const [c1, c2] = await Promise.all([
        executeInSandbox({ code: "import time; time.sleep(0.5); print('JOB_ALPHA')" }),
        executeInSandbox({ code: "import time; time.sleep(0.5); print('JOB_BETA')" }),
    ]);

    const concurrentOk =
        c1.success && c2.success &&
        c1.stdout.trim() === "JOB_ALPHA" &&
        c2.stdout.trim() === "JOB_BETA";

    record(
        "Simultaneous sandboxes execute without collision",
        concurrentOk,
        `job1='${c1.stdout.trim()}', job2='${c2.stdout.trim()}'`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Container Cleanup Verification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[7] Container Cleanup Verification");

    const remainingContainers = execSync(
        "docker ps -a --filter 'name=sovereign-coding-sandbox-' -q"
    ).toString().trim();

    record(
        "Zero lingering sandbox containers left in Docker",
        remainingContainers.length === 0,
        `lingeringCount=${remainingContainers ? remainingContainers.split("\n").length : 0}`
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
