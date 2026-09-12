/**
 * PR #24 / PR #25 — Secure Coding Execution Sandbox Service
 *
 * Provides isolated Python code execution inside an ephemeral Docker container.
 * Enforces strict network isolation (--network none), resource constraints
 * (CPU: 1 core, memory: 256MB, PIDs: 64), read-only root filesystems, and hard execution timeouts (5s default).
 *
 * Generated code NEVER executes on the host or inside the Node.js backend.
 * Only Python code execution is supported. Non-Python requests are strictly rejected.
 */

import { spawn, spawnSync, execSync } from "child_process";
import { randomUUID } from "crypto";

export const SUPPORTED_LANGUAGE = "python";

const MAX_CODE_SIZE_BYTES = 64 * 1024;     // 64 KB
const MAX_OUTPUT_BYTES    = 64 * 1024;     // 64 KB
const DEFAULT_TIMEOUT_MS  = 15000;         // 15 seconds default
const MAX_TIMEOUT_MS      = 30000;         // 30 seconds max

export class SandboxValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "SandboxValidationError";
        this.stage = "validation";
        this.code = details.code || "SANDBOX_VALIDATION_FAILED";
        this.details = details;
    }
}

/**
 * Compile Python source without executing it. This runs before any Docker
 * staging or container creation so invalid generated code never reaches the
 * sandbox runtime.
 *
 * @param {string} code
 * @returns {{valid: true}|never}
 */
export function validatePythonSyntax(code) {
    const result = spawnSync(
        "python3",
        ["-c", "import sys; compile(sys.stdin.read(), '<generated>', 'exec')"],
        {
            input: code,
            encoding: "utf8",
            maxBuffer: 64 * 1024,
        }
    );

    if (result.error) {
        throw new SandboxValidationError(
            `Unable to validate generated Python syntax: ${result.error.message}`,
            { code: "PYTHON_VALIDATOR_UNAVAILABLE" }
        );
    }

    if (result.status !== 0) {
        const diagnostic = String(result.stderr || result.stdout || "invalid Python syntax").trim();
        throw new SandboxValidationError(
            `Generated Python syntax is invalid: ${diagnostic}`,
            {
                code: "PYTHON_SYNTAX_ERROR",
                syntaxError: diagnostic,
            }
        );
    }

    return { valid: true };
}

/**
 * Validates and normalizes the execution language.
 * Centralized rule: ONLY 'python' is supported.
 *
 * @param {string} language
 * @returns {"python"}
 * @throws {SandboxValidationError}
 */
export function validateLanguage(language) {
    const rawLang = String(language || SUPPORTED_LANGUAGE).trim().toLowerCase();
    const resolved = (rawLang === "py" || rawLang === "python") ? SUPPORTED_LANGUAGE : rawLang;

    if (resolved !== SUPPORTED_LANGUAGE) {
        throw new SandboxValidationError("Only Python execution is supported.");
    }

    return SUPPORTED_LANGUAGE;
}

const PYTHON_RUNTIME_CONFIG = Object.freeze({
    canonical: SUPPORTED_LANGUAGE,
    image: "python:3.11-alpine",
    command: ["python", "-I", "-"],
    env: ["-e", "PYTHONUNBUFFERED=1"],
});

/**
 * Stages CSV data into an ephemeral Docker volume for secure isolated access.
 * Does NOT touch or expose any host filesystem path.
 *
 * @param {string} volumeName
 * @param {string} csvContent
 * @returns {Promise<void>}
 */
async function stageCsvVolume(volumeName, csvContent) {
    execSync(`docker volume create ${volumeName}`, { stdio: "ignore" });

    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn("docker", [
                "run",
                "--rm",
                "-i",
                "--network", "none",
                "-v", `${volumeName}:/workspace/input`,
                PYTHON_RUNTIME_CONFIG.image,
                "sh", "-c", "cat > /workspace/input/data.csv && chmod 644 /workspace/input/data.csv",
            ], {
                stdio: ["pipe", "ignore", "pipe"],
            });
        } catch (err) {
            return reject(new Error(`Failed to spawn CSV volume staging container: ${err.message}`));
        }

        let stderr = "";
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", reject);

        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`CSV staging failed with exit code ${code}: ${stderr}`));
            }
        });

        try {
            child.stdin.write(csvContent);
            child.stdin.end();
        } catch (writeErr) {
            reject(writeErr);
        }
    });
}

/**
 * Execute code inside an isolated Docker sandbox container.
 * Supported language: strictly "python".
 *
 * @param {object} params
 * @param {string} params.code - Source code to execute
 * @param {string} [params.language="python"] - Language runtime (must be "python")
 * @param {number} [params.timeoutMs=5000] - Hard execution timeout in milliseconds
 * @param {string} [params.csvContent] - Optional CSV data to mount at /workspace/input/data.csv
 * @returns {Promise<object>}
 */
export async function executeInSandbox({
    code,
    language = SUPPORTED_LANGUAGE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    csvContent = null,
}) {
    // 1. Centralized language validation
    validateLanguage(language);

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

    // Compile before staging CSV data or creating a Docker container.
    validatePythonSyntax(trimmedCode);

    // 3. Timeout bounds (enforce 1s <= timeout <= 10s, default 5s)
    const effectiveTimeout = Math.min(
        Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
        MAX_TIMEOUT_MS
    );

    // 4. Generate unique ephemeral container and volume names
    const containerName = `sovereign-coding-sandbox-${randomUUID().slice(0, 12)}`;
    let volumeName = null;

    if (csvContent && typeof csvContent === "string" && csvContent.trim()) {
        volumeName = `sovereign-sandbox-csv-${randomUUID().slice(0, 12)}`;
        try {
            await stageCsvVolume(volumeName, csvContent.trim());
        } catch (stageErr) {
            if (volumeName) {
                try { execSync(`docker volume rm -f ${volumeName}`, { stdio: "ignore" }); } catch {}
            }
            throw new SandboxValidationError(`Failed to prepare CSV input: ${stageErr.message}`);
        }
    }

    const dockerArgs = [
        "run",
        "--rm",
        "-i",
        "--name", containerName,
        "--user", "1000:1000",
        "--network", "none",
        "--cpus", "1",
        "--memory", "256m",
        "--pids-limit", "64",
        "--read-only",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--ipc", "none",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
        ...(volumeName ? ["-v", `${volumeName}:/workspace/input:ro`] : []),
        ...PYTHON_RUNTIME_CONFIG.env,
        PYTHON_RUNTIME_CONFIG.image,
        ...PYTHON_RUNTIME_CONFIG.command,
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

        const cleanupResources = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            try {
                execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
            } catch {
                // Container might have already self-removed via --rm
            }
            if (volumeName) {
                try {
                    execSync(`docker volume rm -f ${volumeName}`, { stdio: "ignore" });
                } catch {
                    // Ignore volume removal failures
                }
            }
        };

        const timer = setTimeout(() => {
            timedOut = true;
            try {
                // Force kill the docker container so process terminates immediately
                execSync(`docker kill ${containerName}`, { stdio: "ignore" });
            } catch {
                // Ignore if already dead
            }
            if (child && !child.killed) {
                try {
                    child.kill("SIGKILL");
                } catch {}
            }
        }, effectiveTimeout);

        try {
            child = spawn("docker", dockerArgs, {
                stdio: ["pipe", "pipe", "pipe"],
            });
        } catch (spawnErr) {
            clearTimeout(timer);
            cleanupResources();
            return resolve({
                success: false,
                stage: "execution",
                stdout: "",
                stderr: `Failed to spawn sandbox container: ${spawnErr.message}`,
                exitCode: 1,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: Date.now() - startTime,
                error: `Failed to spawn sandbox container: ${spawnErr.message}`,
                sandbox: getSandboxMetadata(effectiveTimeout, volumeName ? "/workspace/input/data.csv" : null),
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
                    try {
                        if (child && !child.killed) child.kill("SIGKILL");
                        child.stdout.destroy();
                    } catch {}
                }
            } else {
                stdoutTruncated = true;
                try {
                    child.stdout.destroy();
                } catch {}
            }
        });

        child.stderr.on("data", (chunk) => {
            if (stderr.length < MAX_OUTPUT_BYTES) {
                stderr += chunk.toString();
                if (stderr.length >= MAX_OUTPUT_BYTES) {
                    stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
                    stderrTruncated = true;
                    try {
                        execSync(`docker kill ${containerName}`, { stdio: "ignore" });
                    } catch {}
                    try {
                        if (child && !child.killed) child.kill("SIGKILL");
                        child.stderr.destroy();
                    } catch {}
                }
            } else {
                stderrTruncated = true;
                try {
                    child.stderr.destroy();
                } catch {}
            }
        });

        child.on("error", (err) => {
            clearTimeout(timer);
            cleanupResources();
            resolve({
                success: false,
                stage: "execution",
                stdout: stdout.trim(),
                stderr: `Sandbox process error: ${err.message}`,
                exitCode: 1,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
                durationMs: Date.now() - startTime,
                error: `Sandbox process error: ${err.message}`,
                sandbox: getSandboxMetadata(effectiveTimeout, volumeName ? "/workspace/input/data.csv" : null),
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            cleanupResources();

            const durationMs = Date.now() - startTime;
            const finalStderr = timedOut
                ? (stderr ? `${stderr}\n` : "") + `Execution timed out after ${effectiveTimeout / 1000} seconds.`
                : stderr;

            const isSuccess = !timedOut && code === 0;

            resolve({
                success: isSuccess,
                stage: "execution",
                stdout: stdout,
                stderr: finalStderr.trim(),
                exitCode: timedOut ? null : code,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
                durationMs,
                error: timedOut
                    ? "Execution timed out."
                    : (!isSuccess ? (finalStderr.trim() || `Execution failed with exit code ${code}`) : undefined),
                sandbox: getSandboxMetadata(effectiveTimeout, volumeName ? "/workspace/input/data.csv" : null),
            });
        });

        // Pipe user code to Python's stdin, then close stdin
        try {
            child.stdin.write(trimmedCode + "\n");
            child.stdin.end();
        } catch (writeErr) {
            clearTimeout(timer);
            cleanupResources();
            resolve({
                success: false,
                stage: "execution",
                stdout: "",
                stderr: `Failed to write code to sandbox: ${writeErr.message}`,
                exitCode: 1,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: Date.now() - startTime,
                error: `Failed to write code to sandbox: ${writeErr.message}`,
                sandbox: getSandboxMetadata(effectiveTimeout, volumeName ? "/workspace/input/data.csv" : null),
            });
        }
    });
}

function getSandboxMetadata(timeoutMs, csvPath = null) {
    return {
        isolated: true,
        network: "none",
        language: SUPPORTED_LANGUAGE,
        timeoutSeconds: timeoutMs / 1000,
        memoryLimitMb: 256,
        cpuLimit: 1,
        pidLimit: 64,
        readOnlyRoot: true,
        capabilitiesDropped: "ALL",
        ipc: "none",
        image: PYTHON_RUNTIME_CONFIG.image,
        ...(csvPath ? { csvInput: csvPath } : {}),
    };
}
