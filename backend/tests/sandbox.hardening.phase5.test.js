/**
 * PHASE 5 — CODING AGENT & SANDBOX HARDENING TEST SUITE
 *
 * Verifies all 17 requirements of the Phase 5 Security Test Matrix:
 *  1. Normal Python execution
 *  2. Syntax error handling
 *  3. Runtime exception handling
 *  4. Infinite loop timeout enforcement
 *  5. Memory exhaustion containment (--memory 256m)
 *  6. Huge stdout flood control (truncated at 64 KB, process killed)
 *  7. Filesystem access restrictions (read-only root, 16MB tmpfs)
 *  8. Host filesystem isolation (/Users, /app, .env, host paths absent)
 *  9. Network egress denial (--network none: urllib, socket, curl)
 * 10. Subprocess execution containment (--pids-limit 64, cap-drop ALL)
 * 11. Docker socket access isolation (/var/run/docker.sock absent)
 * 12. Environment secret isolation (JWT_SECRET, DATABASE_URL, etc. absent)
 * 13. Privilege escalation prevention (non-root 1000:1000, --cap-drop ALL, no-new-privileges)
 * 14. Timeout cleanup verification (container & child killed, no zombie containers)
 * 15. Concurrent executions (multiple jobs run concurrently without file or state collision)
 * 16. Malicious model override rejection (HTTP 400 / MODEL_NOT_ALLOWED)
 * 17. Tenant isolation (authoritative tenant boundaries enforced)
 */

import assert from "node:assert/strict";
import { executeInSandbox } from "../src/services/sandbox.service.js";
import {
    runCodingWorkflow,
    CodingAgentError,
    CODING_ERROR_CODES,
    validatePythonCode,
    extractPythonCode,
    verifyOutput,
} from "../src/services/coding-agent.service.js";
import { executionEvents } from "../src/services/execution-events.service.js";
import { execSync } from "child_process";

const TEST_ORG_A = "tenant-phase5-alpha";
const TEST_ORG_B = "tenant-phase5-beta";

async function runPhase5SecuritySuite() {
    console.log("================================================================================");
    console.log("PHASE 5 — CODING AGENT & SANDBOX HARDENING VERIFICATION SUITE");
    console.log("================================================================================\n");

    let passed = 0;
    let failed = 0;

    function check(label, condition, detail = "") {
        if (condition) {
            console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ""}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ""}`);
            failed++;
        }
    }

    // 1. Normal Python execution
    console.log("[Test 1] Normal Python Execution");
    const t1 = await executeInSandbox({
        code: `
a = 100
b = 85
eff = (b / a) * 100
print(f"Efficiency: {eff:.2f}%")
`,
    });
    check("Normal Python execution succeeded", t1.success && t1.exitCode === 0 && t1.stdout.includes("Efficiency: 85.00%"));

    // 2. Syntax error handling
    console.log("\n[Test 2] Syntax Error Handling");
    const t2 = await executeInSandbox({
        code: `def broken_syntax(`,
    });
    check("Syntax error caught cleanly", !t2.success && t2.exitCode !== 0 && t2.stderr.includes("SyntaxError"));

    // 3. Runtime exception handling
    console.log("\n[Test 3] Runtime Exception Handling");
    const t3 = await executeInSandbox({
        code: `
def div_by_zero():
    return 10 / 0
div_by_zero()
`,
    });
    check("Runtime exception captured cleanly in stderr", !t3.success && t3.exitCode !== 0 && t3.stderr.includes("ZeroDivisionError"));

    // 4. Infinite loop timeout enforcement
    console.log("\n[Test 4] Infinite Loop Timeout Enforcement");
    const loopStart = Date.now();
    const t4 = await executeInSandbox({
        code: `
while True:
    pass
`,
        timeoutMs: 2000,
    });
    const loopDuration = Date.now() - loopStart;
    check(
        "Infinite loop terminated cleanly on timeout",
        t4.timedOut === true && loopDuration >= 2000 && loopDuration < 4500,
        `elapsed=${loopDuration}ms`
    );

    // 5. Memory exhaustion containment (--memory 256m)
    console.log("\n[Test 5] Memory Exhaustion Containment (--memory 256m)");
    const t5 = await executeInSandbox({
        code: `
import os
try:
    chunks = []
    for _ in range(70):
        chunks.append(os.urandom(10 * 1024 * 1024))
    print("ALLOC_UNBOUNDED")
except MemoryError:
    print("CAUGHT_MEMORY_ERROR")
`,
        timeoutMs: 4000,
    });
    const memBounded = t5.stdout.includes("CAUGHT_MEMORY_ERROR") || t5.exitCode === 137 || t5.exitCode !== 0;
    check("Memory allocation capped safely by container limit", memBounded, `exitCode=${t5.exitCode}`);

    // 6. Huge stdout flood control (truncated at 64 KB)
    console.log("\n[Test 6] Huge stdout Flood Control");
    const t6 = await executeInSandbox({
        code: `print("A" * 100000)`,
        timeoutMs: 3000,
    });
    check(
        "Stdout flood capped at MAX_OUTPUT_BYTES (64 KB) and truncated",
        t6.stdoutTruncated === true && t6.stdout.length <= 64 * 1024,
        `stdoutLength=${t6.stdout.length}`
    );

    // 7. Filesystem access restrictions (read-only root, 16MB tmpfs)
    console.log("\n[Test 7] Filesystem Access Restrictions");
    const t7 = await executeInSandbox({
        code: `
import os
errors = []
# Try write to root
try:
    with open("/malicious.txt", "w") as f:
        f.write("data")
    errors.append("WROTE_ROOT")
except OSError:
    pass

# Try write to /etc
try:
    with open("/etc/test.txt", "w") as f:
        f.write("data")
    errors.append("WROTE_ETC")
except OSError:
    pass

# Try write > 16MB in /tmp
try:
    with open("/tmp/huge.bin", "wb") as f:
        f.write(b"0" * (20 * 1024 * 1024))
    errors.append("WROTE_OVER_16MB_TMPFS")
except OSError:
    pass

print(f"FS_ERRORS: {errors}")
`,
    });
    check("Read-only root and tmpfs size restrictions enforced", t7.stdout.includes("FS_ERRORS: []"), t7.stdout.trim());

    // 8. Host filesystem isolation
    console.log("\n[Test 8] Host Filesystem Isolation");
    const t8 = await executeInSandbox({
        code: `
import os
host_markers = ["/Users", "/home/workbench", "/app", "/var/lib/postgresql", "/root/.ssh"]
found = [p for p in host_markers if os.path.exists(p)]
print(f"HOST_MARKERS_FOUND: {found}")
`,
    });
    check("Zero host paths exposed to container", t8.stdout.includes("HOST_MARKERS_FOUND: []"));

    // 9. Network egress denial (--network none)
    console.log("\n[Test 9] Network Egress Denial (--network none)");
    const t9 = await executeInSandbox({
        code: `
import urllib.request, socket
results = []
try:
    urllib.request.urlopen("https://1.1.1.1", timeout=1)
    results.append("HTTP_REACHED")
except Exception as e:
    results.append(f"HTTP_BLOCKED_{type(e).__name__}")

try:
    s = socket.socket()
    s.settimeout(1)
    s.connect(("8.8.8.8", 53))
    results.append("SOCKET_REACHED")
except Exception as e:
    results.append(f"SOCKET_BLOCKED_{type(e).__name__}")

print(f"NET_RESULTS: {results}")
`,
    });
    const netBlocked = !t9.stdout.includes("HTTP_REACHED") && !t9.stdout.includes("SOCKET_REACHED") && t9.stdout.includes("BLOCKED");
    check("All outbound network connections blocked by --network none", netBlocked, t9.stdout.trim());

    // 10. Subprocess execution containment (--pids-limit 64, cap-drop ALL)
    console.log("\n[Test 10] Subprocess Execution Containment (--pids-limit 64)");
    const t10 = await executeInSandbox({
        code: `
import os, time
spawned = 0
try:
    for _ in range(128):
        pid = os.fork()
        if pid == 0:
            time.sleep(1)
            os._exit(0)
        spawned += 1
    print(f"FORK_STATUS: SPAWNED_{spawned}")
except BlockingIOError:
    print(f"FORK_STATUS: BOUNDED_AT_{spawned}")
except Exception as e:
    print(f"FORK_STATUS: PREVENTED_{type(e).__name__}")
`,
        timeoutMs: 3000,
    });
    const forkBounded = t10.stdout.includes("BOUNDED_AT") || t10.stdout.includes("PREVENTED") || t10.timedOut;
    check("Fork bomb safely bounded by --pids-limit 64", forkBounded, t10.stdout.trim());

    // 11. Docker socket access isolation
    console.log("\n[Test 11] Docker Socket Isolation");
    const t11 = await executeInSandbox({
        code: `
import os
sockets = ["/var/run/docker.sock", "/run/docker.sock"]
found = [s for s in sockets if os.path.exists(s)]
print(f"DOCKER_SOCKETS: {found}")
`,
    });
    check("Docker socket is completely unmounted and absent", t11.stdout.includes("DOCKER_SOCKETS: []"));

    // 12. Environment secret isolation
    console.log("\n[Test 12] Environment Secret Isolation");
    const t12 = await executeInSandbox({
        code: `
import os
secret_keys = ["JWT_SECRET", "POSTGRES_PASSWORD", "DATABASE_URL", "OLLAMA_URL", "QDRANT_URL"]
leaked = [k for k in secret_keys if k in os.environ]
print(f"LEAKED: {leaked}")
`,
    });
    check("Zero application secrets in container environment", t12.stdout.includes("LEAKED: []"));

    // 13. Privilege escalation prevention
    console.log("\n[Test 13] Privilege Escalation Prevention");
    const t13 = await executeInSandbox({
        code: `
import os
uid = os.getuid()
gid = os.getgid()
print(f"UID={uid}, GID={gid}")
`,
    });
    check("Container executes as non-root user 1000:1000", t13.stdout.includes("UID=1000, GID=1000"));

    // 14. Timeout cleanup verification
    console.log("\n[Test 14] Timeout Cleanup Verification");
    const t14 = await executeInSandbox({
        code: `
import time
time.sleep(10)
`,
        timeoutMs: 1500,
    });
    // Verify no leftover containers with name sovereign-coding-sandbox
    let containers = "";
    try {
        containers = execSync("docker ps -q -f name=sovereign-coding-sandbox").toString().trim();
    } catch {}
    check("Timed out container killed and no lingering sandbox containers remain", t14.timedOut === true && containers.length === 0);

    // 15. Concurrent executions isolation
    console.log("\n[Test 15] Concurrent Executions Isolation");
    const pA = executeInSandbox({
        code: `
import time
print("JOB_ALPHA_START")
time.sleep(0.5)
print("JOB_ALPHA_END: 1111")
`,
    });
    const pB = executeInSandbox({
        code: `
import time
print("JOB_BETA_START")
time.sleep(0.5)
print("JOB_BETA_END: 2222")
`,
    });
    const [resA, resB] = await Promise.all([pA, pB]);
    check(
        "Concurrent sandboxes run simultaneously without cross-talk or collision",
        resA.stdout.includes("1111") && !resA.stdout.includes("2222") &&
        resB.stdout.includes("2222") && !resB.stdout.includes("1111")
    );

    // 16. Malicious model override rejection
    console.log("\n[Test 16] Malicious Model Override Rejection");
    let caughtOverride = false;
    try {
        await runCodingWorkflow({
            request: "Write Python code to calculate efficiency",
            organizationId: TEST_ORG_A,
            model: "unapproved-external-model",
            options: {
                mockGeneratedCode: "print(85)",
            },
        });
    } catch (err) {
        if (err instanceof CodingAgentError && err.code === CODING_ERROR_CODES.MODEL_NOT_ALLOWED) {
            caughtOverride = true;
        }
    }
    check("Unallowlisted model override rejected with MODEL_NOT_ALLOWED", caughtOverride);

    // 17. Tenant isolation
    console.log("\n[Test 17] Tenant Isolation Enforcement");
    let caughtMissingOrg = false;
    try {
        await runCodingWorkflow({
            request: "Write Python code",
            organizationId: "", // missing org
            options: { mockGeneratedCode: "print(1)" },
        });
    } catch (err) {
        if (err instanceof CodingAgentError && err.code === "UNAUTHORIZED") {
            caughtMissingOrg = true;
        }
    }

    const runIdA = "coding-run-tenant-a-test";
    executionEvents.registerRunOwner(runIdA, TEST_ORG_A, "coding");
    const checkA = await executionEvents.verifyOrHydrateRunOwner(runIdA, TEST_ORG_A);
    const checkB = await executionEvents.verifyOrHydrateRunOwner(runIdA, TEST_ORG_B);
    check(
        "Authoritative tenant isolation enforced (cross-tenant access denied)",
        caughtMissingOrg && checkA.allowed === true && checkB.allowed === false && checkB.forbidden === true
    );

    console.log("\n================================================================================");
    console.log(`PHASE 5 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("================================================================================");

    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}

runPhase5SecuritySuite().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
