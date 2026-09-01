/**
 * PR #26 — Sandbox Code Execution Agent Tool
 *
 * Delegates Python execution exclusively to the PR #24 Docker sandbox:
 *   - Ephemeral python:3.11-alpine container
 *   - Network disabled (--network none)
 *   - Read-only root filesystem
 *   - Resource limits (1 CPU, 256MB RAM, 64 PIDs)
 *   - Hard execution timeout (5-10s)
 */

import { executeInSandbox, SandboxValidationError } from "../sandbox.service.js";

export class SandboxCodeError extends Error {
    constructor(message) {
        super(message);
        this.name = "SandboxCodeError";
    }
}

/**
 * Executes verified Python code strictly inside the isolated Docker sandbox.
 *
 * @param {object} args
 * @param {string} args.code - Python code string to execute
 * @param {string} [args.language="python"] - Language (must be "python")
 * @param {number} [args.timeoutMs=5000] - Hard execution timeout
 * @returns {Promise<object>}
 */
export async function executeSandboxCode(args) {
    if (!args || typeof args !== "object") {
        throw new SandboxCodeError("Arguments must be an object with 'code' and 'language' fields");
    }

    const { code, language = "python", timeoutMs } = args;

    if (typeof code !== "string" || !code.trim()) {
        throw new SandboxCodeError("code must be a non-empty string");
    }

    const lang = String(language || "").trim().toLowerCase();
    if (lang !== "python") {
        throw new SandboxCodeError(`Unsupported language '${language}'. Only 'python' is supported in the sandbox.`);
    }

    try {
        const result = await executeInSandbox({
            code: code.trim(),
            language: "python",
            timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : 5000,
        });

        return {
            language: "python",
            stdout: result.stdout || "",
            stderr: result.stderr || "",
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            success: result.exitCode === 0 && !result.timedOut,
            sandbox: result.sandbox,
        };
    } catch (err) {
        if (err instanceof SandboxValidationError) {
            throw new SandboxCodeError(`Sandbox validation failed: ${err.message}`);
        }
        throw new SandboxCodeError(`Sandbox execution failed: ${err.message}`);
    }
}
