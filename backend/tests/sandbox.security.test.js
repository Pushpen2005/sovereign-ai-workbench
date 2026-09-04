/**
 * Phase 7: Coding Sandbox Final Security Verification Test Suite
 *
 * Probes the isolated execution environment against 11 attack & abuse vectors:
 *   1. Internet Access (Egress)
 *   2. Host Filesystem Traversal
 *   3. Host /etc/shadow Privilege Escalation
 *   4. Application Environment Secrets Access
 *   5. Internal PostgreSQL Access
 *   6. Internal Qdrant Vector Store Access
 *   7. Internal Ollama Daemon Access
 *   8. Docker Socket Access inside Sandbox
 *   9. Fork Bomb / Process Table Exhaustion (--pids-limit 64)
 *  10. Memory Allocation Exhaustion (--memory 256m)
 *  11. Infinite Loop Hard Timeout Enforcement
 */

import assert from "node:assert";
import { executeInSandbox } from "../src/services/sandbox.service.js";

async function runSandboxSecurityTests() {
  console.log("==================================================");
  console.log("Phase 7: Coding Sandbox Final Security Suite (11 Probes)");
  console.log("==================================================");

  // Probe 1: Internet Egress
  console.log("\n[Probe 1] Testing External Internet Egress Blocking");
  const p1 = await executeInSandbox({
    code: `
import urllib.request
try:
    urllib.request.urlopen("https://8.8.8.8", timeout=1)
    print("PROBE_FAIL: Internet reachable")
except Exception as e:
    print(f"PROBE_PASS: Internet unreachable ({type(e).__name__})")
`,
  });
  assert.equal(p1.exitCode, 0);
  assert.ok(p1.stdout.includes("PROBE_PASS"), "Internet egress must be blocked");
  console.log("  ✅ PASS: Internet egress blocked by --network none");

  // Probe 2: Host Filesystem Traversal
  console.log("\n[Probe 2] Testing Host Filesystem Isolation");
  const p2 = await executeInSandbox({
    code: `
import os
host_indicators = ["/app", "/host", "/Users", "/home/workbench", "/var/lib/postgresql"]
present = [p for p in host_indicators if os.path.exists(p)]
print(f"HOST_PATHS_FOUND: {present}")
`,
  });
  assert.equal(p2.exitCode, 0);
  assert.ok(p2.stdout.includes("HOST_PATHS_FOUND: []"), "Host filesystem paths must be completely absent");
  console.log("  ✅ PASS: Host filesystem paths completely isolated");

  // Probe 3: /etc/shadow Access
  console.log("\n[Probe 3] Testing /etc/shadow Privilege Boundary");
  const p3 = await executeInSandbox({
    code: `
try:
    with open("/etc/shadow", "r") as f:
        f.read()
    print("PROBE_FAIL: Read /etc/shadow")
except Exception as e:
    print(f"PROBE_PASS: Cannot read /etc/shadow ({type(e).__name__})")
`,
  });
  assert.equal(p3.exitCode, 0);
  assert.ok(p3.stdout.includes("PROBE_PASS"), "Reading /etc/shadow must fail with PermissionError or FileNotFoundError");
  console.log("  ✅ PASS: /etc/shadow privilege escalation strictly denied");

  // Probe 4: Application Secrets Leakage in Environment
  console.log("\n[Probe 4] Testing Environment Secrets Isolation");
  const p4 = await executeInSandbox({
    code: `
import os
secrets = ["JWT_SECRET", "POSTGRES_PASSWORD", "POSTGRES_USER", "DATABASE_URL"]
leaked = [s for s in secrets if s in os.environ]
print(f"LEAKED_SECRETS: {leaked}")
`,
  });
  assert.equal(p4.exitCode, 0);
  assert.ok(p4.stdout.includes("LEAKED_SECRETS: []"), "Application secrets must not be leaked into sandbox environment");
  console.log("  ✅ PASS: Zero backend environment secrets leaked to sandbox container");

  // Probe 5: Internal PostgreSQL Access
  console.log("\n[Probe 5] Testing Internal PostgreSQL Access Blocking");
  const p5 = await executeInSandbox({
    code: `
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    s.connect(("172.19.0.3", 5432))
    print("PROBE_FAIL: Connected to postgres")
except Exception as e:
    print(f"PROBE_PASS: Cannot reach postgres ({type(e).__name__})")
`,
  });
  assert.equal(p5.exitCode, 0);
  assert.ok(p5.stdout.includes("PROBE_PASS"), "Internal postgres access must be blocked");
  console.log("  ✅ PASS: Internal PostgreSQL access strictly blocked");

  // Probe 6: Internal Qdrant Access
  console.log("\n[Probe 6] Testing Internal Qdrant Vector Store Access Blocking");
  const p6 = await executeInSandbox({
    code: `
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    s.connect(("172.19.0.2", 6333))
    print("PROBE_FAIL: Connected to qdrant")
except Exception as e:
    print(f"PROBE_PASS: Cannot reach qdrant ({type(e).__name__})")
`,
  });
  assert.equal(p6.exitCode, 0);
  assert.ok(p6.stdout.includes("PROBE_PASS"), "Internal Qdrant access must be blocked");
  console.log("  ✅ PASS: Internal Qdrant access strictly blocked");

  // Probe 7: Internal Ollama Access
  console.log("\n[Probe 7] Testing Internal Ollama Access Blocking");
  const p7 = await executeInSandbox({
    code: `
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    s.connect(("172.19.0.4", 11434))
    print("PROBE_FAIL: Connected to ollama")
except Exception as e:
    print(f"PROBE_PASS: Cannot reach ollama ({type(e).__name__})")
`,
  });
  assert.equal(p7.exitCode, 0);
  assert.ok(p7.stdout.includes("PROBE_PASS"), "Internal Ollama access must be blocked");
  console.log("  ✅ PASS: Internal Ollama access strictly blocked");

  // Probe 8: Docker Socket Access inside Sandbox
  console.log("\n[Probe 8] Testing Docker Socket Access inside Sandbox Container");
  const p8 = await executeInSandbox({
    code: `
import os
socket_paths = ["/var/run/docker.sock", "/run/docker.sock"]
found = [p for p in socket_paths if os.path.exists(p)]
print(f"DOCKER_SOCKET_FOUND: {found}")
`,
  });
  assert.equal(p8.exitCode, 0);
  assert.ok(p8.stdout.includes("DOCKER_SOCKET_FOUND: []"), "Docker socket must NEVER be mounted into sandbox container");
  console.log("  ✅ PASS: Docker socket is completely inaccessible from inside sandbox container");

  // Probe 9: Fork Bomb / Process Table Exhaustion
  console.log("\n[Probe 9] Testing Process Exhaustion Control (--pids-limit 64)");
  const p9 = await executeInSandbox({
    code: `
import os, time
pids = []
try:
    for _ in range(100):
        pid = os.fork()
        if pid == 0:
            time.sleep(1)
            os._exit(0)
        pids.append(pid)
    print("PROBE_FAIL: Spawned 100 processes")
except BlockingIOError:
    print("PROBE_PASS: Process creation blocked by pids-limit")
except Exception as e:
    print(f"PROBE_PASS: Fork prevented ({type(e).__name__})")
`,
    timeoutMs: 3000,
  });
  assert.ok(p9.stdout.includes("PROBE_PASS") || p9.stderr.includes("Resource temporarily unavailable") || p9.timedOut, "Fork bomb must be bounded by --pids-limit");
  console.log("  ✅ PASS: Fork bomb bounded safely by --pids-limit 64");

  // Probe 10: Memory Allocation Limit Enforcement
  console.log("\n[Probe 10] Testing Memory Allocation Bound (--memory 256m)");
  const p10 = await executeInSandbox({
    code: `
import os
try:
    chunks = []
    # 700 MB exceeds both physical RAM cap (256m) and swap cap
    for _ in range(70):
        chunks.append(os.urandom(10 * 1024 * 1024))
    print("PROBE_FAIL: Allocated excessive physical memory")
except MemoryError:
    print("PROBE_PASS: Memory allocation caught MemoryError")
`,
    timeoutMs: 4000,
  });
  const isMemoryBounded = p10.stdout.includes("PROBE_PASS") || p10.exitCode !== 0 || p10.stderr.includes("Killed") || p10.exitCode === 137;
  assert.ok(isMemoryBounded, `Excessive memory must be bounded by container cap: exitCode=${p10.exitCode}, stdout=${p10.stdout}, stderr=${p10.stderr}`);
  console.log("  ✅ PASS: Memory limit enforced by container cap (--memory 256m)");

  // Probe 11: Infinite Loop Hard Timeout Enforcement
  console.log("\n[Probe 11] Testing Hard Execution Timeout Enforcement");
  const tStart = Date.now();
  const p11 = await executeInSandbox({
    code: `
while True:
    pass
`,
    timeoutMs: 2000,
  });
  const duration = Date.now() - tStart;
  assert.equal(p11.timedOut, true, "Infinite loop must trigger timedOut: true");
  assert.ok(duration >= 2000 && duration < 5000, `Duration ${duration}ms must match timeout window`);
  console.log(`  ✅ PASS: Hard timeout terminated infinite loop safely in ${duration} ms`);

  console.log("\n==================================================");
  console.log("✅ ALL 11 CODING SANDBOX SECURITY PROBES PASSED");
  console.log("==================================================");
}

runSandboxSecurityTests().catch((err) => {
  console.error("Sandbox security tests failed:", err);
  process.exit(1);
});
