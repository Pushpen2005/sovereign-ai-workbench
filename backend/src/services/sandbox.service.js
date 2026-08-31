/**
 * PR #24 — Secure Coding Execution Sandbox Service
 *
 * Provides isolated Python code execution inside an ephemeral Docker container.
 * Enforces strict network isolation (--network none), resource constraints
 * (CPU, memory, PIDs), read-only root filesystems, and hard execution timeouts.
 *
 * Generated code NEVER executes on the host or inside the Node.js backend.
 */

import { spawn, execSync } from "child_process";
import { randomUUID } from "crypto";

const MAX_CODE_SIZE_BYTES = 64 * 1024;     // 64 KB
const MAX_OUTPUT_BYTES    = 64 * 1024;     // 64 KB
const DEFAULT_TIMEOUT_MS  = 5000;          // 5 seconds
const MAX_TIMEOUT_MS      = 10000;         // 10 seconds max

export class SandboxValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "SandboxValidationError";
    }
}

/**
 * Execute Python code inside an isolated Docker sandbox container.
 *
 * @param {object} params
 * @param {string} params.code - Source code to execute
 * @param {string} [params.language="python"] - Language runtime (only "python" supported)
 * @param {number} [params.timeoutMs=5000] - Hard execution timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function executeInSandbox({
    code,
    language = "python",
    timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
    // 1. Language validation
    const normalizedLang = String(language || "").trim().toLowerCase();
    if (normalizedLang !== "python") {
        throw new SandboxValidationError(
            `Unsupported language '${language}'. Only 'python' is supported.`
        );
    }

    // 2. Code validation
    if (typeof code !== "string") {
        throw new SandboxValidationError("Code must be a string");
    }

    const trimmedCode = code.trim();
    if (!trimmedCode) {
        throw new SandboxValidationError("Code cannot be empty");
    }

    const codeBytes = Buffer.byteLength(trimmedCode, "utf8");
    if (codeBytes > MAX_CODE_SIZE_BYTES) {
        throw new SandboxValidationError(
            `Code size (${codeBytes} bytes) exceeds limit of ${MAX_CODE_SIZE_BYTES} bytes`
        );
    }

    // 3. Timeout bounds
    const effectiveTimeout = Math.min(
        Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
        MAX_TIMEOUT_MS
    );

    // 4. Generate unique ephemeral container name
    const containerName = `sovereign-coding-sandbox-${randomUUID().slice(0, 12)}`;

    const dockerArgs = [
        "run",
        "--rm",
        "-i",
        "--name", containerName,
        "--network", "none",
        "--cpus", "1",
        "--memory", "256m",
        "--pids-limit", "64",
        "--read-only",
        "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
        "-e", "PYTHONUNBUFFERED=1",
        "python:3.11-alpine",
        "python", "-I", "-",
    ];

    const startTime = Date.now();

    return new Promise((resolve) => {
        let child;
        let timedOut = false;
        let stdout = "";
        let stderr = "";
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let cleanedUp = false;

        const cleanupContainer = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            try {
                execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
            } catch {
                // Ignore errors if container already exited and was removed by --rm
            }
        };

        const timer = setTimeout(() => {
            timedOut = true;
            try {
                // Immediately kill the docker container so process stops execution
                execSync(`docker kill ${containerName}`, { stdio: "ignore" });
            } catch {
                // Ignore if already dead
            }
            if (child && !child.killed) {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // Ignore
                }
            }
        }, effectiveTimeout);

        try {
            child = spawn("docker", dockerArgs, {
                stdio: ["pipe", "pipe", "pipe"],
            });
        } catch (spawnErr) {
            clearTimeout(timer);
            cleanupContainer();
            return resolve({
                success: false,
                stdout: "",
                stderr: `Failed to spawn sandbox container: ${spawnErr.message}`,
                exitCode: 1,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: Date.now() - startTime,
                sandbox: getSandboxMetadata(effectiveTimeout),
            });
        }

        child.stdout.on("data", (chunk) => {
            if (stdout.length < MAX_OUTPUT_BYTES) {
                stdout += chunk.toString();
                if (stdout.length >= MAX_OUTPUT_BYTES) {
                    stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
                    stdoutTruncated = true;
                    try {
                        execSync(`docker kill ${containerName}`, { stdio: "ignore" });
                    } catch {}
                }
            } else {
                stdoutTruncated = true;
            }
        });

        child.stderr.on("data", (chunk) => {
            if (stderr.length < MAX_OUTPUT_BYTES) {
                stderr += chunk.toString();
                if (stderr.length >= MAX_OUTPUT_BYTES) {
                    stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
                    stderrTruncated = true;
                }
            } else {
                stderrTruncated = true;
            }
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            cleanupContainer();
            resolve({
                success: false,
                stdout: stdout.trim(),
                stderr: `Sandbox process error: ${err.message}`,
                exitCode: 1,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
                durationMs: Date.now() - startTime,
                sandbox: getSandboxMetadata(effectiveTimeout),
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            cleanupContainer();

            const durationMs = Date.now() - startTime;
            const finalStderr = timedOut
                ? (stderr ? `${stderr}\n` : "") + `Execution timed out after ${effectiveTimeout / 1000} seconds.`
                : stderr;

            const isSuccess = !timedOut && code === 0;

            resolve({
                success: isSuccess,
                stdout: stdout,
                stderr: finalStderr.trim(),
                exitCode: timedOut ? null : code,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
                durationMs,
                sandbox: getSandboxMetadata(effectiveTimeout),
            });
        });

        // Pipe user code to Python's stdin, then close stdin
        try {
            child.stdin.write(trimmedCode + "\n");
            child.stdin.end();
        } catch (writeErr) {
            clearTimeout(timer);
            cleanupContainer();
            resolve({
                success: false,
                stdout: "",
                stderr: `Failed to write code to sandbox: ${writeErr.message}`,
                exitCode: 1,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: Date.now() - startTime,
                sandbox: getSandboxMetadata(effectiveTimeout),
            });
        }
    });
}

function getSandboxMetadata(timeoutMs) {
    return {
        isolated: true,
        network: "none",
        timeoutSeconds: timeoutMs / 1000,
        memoryLimitMb: 256,
        cpuLimit: 1,
        pidLimit: 64,
        readOnlyRoot: true,
        image: "python:3.11-alpine",
    };
}
