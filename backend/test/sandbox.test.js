import test, { describe, it } from "node:test";
import assert from "node:assert";
import { executeInSandbox } from "../src/services/sandbox.service.js";
import { executeRegisteredTool, TOOL_REGISTRY } from "../src/services/agentTools/toolRegistry.js";
import { routeTask } from "../../ai-service/router/modelRouter.js";

describe("Phase 4 - Secure Coding Sandbox", { concurrency: 1 }, () => {

    describe("Basic Execution & Verification", () => {
        it("TEST 1 - BASIC EXECUTION: print hello", async () => {
            const res = await executeInSandbox({ code: 'print("hello")' });
            assert.strictEqual(res.exitCode, 0, "exitCode should be 0");
            assert.strictEqual(res.stdout.trim(), "hello", "stdout should match");
            assert.strictEqual(res.timedOut, false, "should not timeout");
            assert.strictEqual(res.success, true, "should be successful");
        });

        it("TEST 2 - CALCULATION: math operations", async () => {
            const code = `a = 10\nb = 5\nprint(int(a / b))`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.stdout.trim(), "2");
        });

        it("TEST 3 - SYNTAX ERROR: invalid python", async () => {
            const res = await executeInSandbox({ code: 'print(1 /)' });
            assert.notStrictEqual(res.exitCode, 0, "should have nonzero exit code");
            assert.strictEqual(res.success, false, "should fail safely");
            assert.match(res.stderr, /SyntaxError/, "stderr should contain SyntaxError");
        });

        it("TEST 4 - RUNTIME ERROR: zero division", async () => {
            const res = await executeInSandbox({ code: 'print(1 / 0)' });
            assert.notStrictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, false);
            assert.match(res.stderr, /ZeroDivisionError/);
        });

        it("TEST 6 - OUTPUT LIMIT: excessive stdout", async () => {
            const res = await executeInSandbox({ code: 'print("A" * 100000)' });
            assert.ok(res.stdout.length <= 64 * 1024, "Output should not exceed 64KB");
        });
    });

    describe("Resource Limits & Timeout", () => {
        it("TEST 5 - TIMEOUT: infinite loop terminates", async () => {
            const res = await executeInSandbox({ code: 'while True: pass', timeoutMs: 1500 });
            assert.notStrictEqual(res.exitCode, 0);
            assert.strictEqual(res.timedOut, true, "timedOut should be true");
            assert.strictEqual(res.success, false);
        });
    });

    describe("Security & Isolation", () => {
        it("TEST 7 - NETWORK ISOLATION: curl google fails", async () => {
            const code = `
import urllib.request
try:
    urllib.request.urlopen("http://google.com", timeout=2)
    print("SUCCESS")
except Exception as e:
    print("FAILED")
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "FAILED", "Network request must fail");
        });

        it("TEST 8 - FILESYSTEM ISOLATION: cannot read host files", async () => {
            const code = `
import os
print(os.path.exists("/etc/passwd") and os.path.exists("/app/.env"))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False", "Host filesystem must not be accessible");
        });

        it("TEST 9 - ENVIRONMENT ISOLATION: secrets not exposed", async () => {
            const code = `
import os
print("DATABASE_URL" in os.environ or "QDRANT_URL" in os.environ)
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False", "Backend secrets must not be in env");
        });

        it("TEST 10 & 11 - DB & QDRANT ISOLATION: unavailable on local network", async () => {
            const code = `
import socket
def check(host, port):
    try:
        s = socket.socket()
        s.settimeout(0.5)
        s.connect((host, port))
        return True
    except Exception as e:
        return False
print(check("172.17.0.1", 5432) or check("127.0.0.1", 5432) or check("172.17.0.1", 6333))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False", "Database ports must be unreachable");
        });

        it("TEST 12 - MLX ISOLATION: model runtime unavailable", async () => {
            const code = `
import socket
def check(host, port):
    try:
        s = socket.socket()
        s.settimeout(0.5)
        s.connect((host, port))
        return True
    except Exception as e:
        return False
print(check("172.17.0.1", 8080) or check("172.17.0.1", 8081))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False", "MLX ports must be unreachable");
        });

        it("TEST 13 - DOCKER SOCKET ISOLATION: no /var/run/docker.sock", async () => {
            const code = `
import os
print(os.path.exists("/var/run/docker.sock"))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False", "Docker socket must not exist in sandbox");
        });
    });

    describe("Integration", () => {
        it("TEST 15 - TOOL REGISTRY: coding_sandbox is registered", async () => {
            assert.ok(TOOL_REGISTRY["coding_sandbox"], "Tool must be registered");
            const res = await executeRegisteredTool("coding_sandbox", { code: 'print("integration")' });
            assert.strictEqual(res.status, "success");
            assert.strictEqual(res.result.stdout.trim(), "integration");
        });

        it("TEST 16 - MODEL ROUTER: routes to CODING correctly", async () => {
            const routing = await routeTask("Write a python function to compute fibonacci");
            assert.strictEqual(routing.canonicalTaskType, "CODING");
        });
    });
});
