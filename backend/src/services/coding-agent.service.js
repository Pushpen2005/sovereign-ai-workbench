/**
 * Phase 9 — Coding Agent & Secure Execution Workflow Service
 *
 * Implements a complete 7-stage agentic workflow:
 *   1. classify_task     — Classifies user request as CODING
 *   2. select_model      — Selects local coding model from registry
 *   3. generate_code     — Generates Python code via local LLM
 *   4. validate_code     — Extracts and validates Python code
 *   5. execute_sandbox   — Runs code strictly in network-disabled Docker container
 *   6. verify_result     — Independently verifies stdout against expected result
 *   7. return_result     — Persists execution and returns judge-friendly payload
 *
 * Security Invariants:
 *   - Generated code NEVER executes on the host
 *   - organizationId is ALWAYS authoritative from the authenticated request context
 *   - Network is disabled (--network none)
 *   - Independent verification does NOT trust LLM self-assessment
 */

import { randomUUID } from "crypto";
import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import {
    classifyTask,
    routeTask,
    RouterError,
    TASK_TYPE,
} from "../../../ai-service/router/modelRouter.js";
import {
    executeInSandbox,
    SandboxValidationError,
} from "./sandbox.service.js";
import { executionEvents } from "./execution-events.service.js";
import { createAgentRun, updateAgentRun } from "../repositories/agent.repository.js";
import { telemetryService } from "./telemetry.service.js";

// Error Codes
export const CODING_ERROR_CODES = Object.freeze({
    MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    CODE_VALIDATION_FAILED: "CODE_VALIDATION_FAILED",
    EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
    EXECUTION_FAILED: "EXECUTION_FAILED",
    RESOURCE_LIMIT_EXCEEDED: "RESOURCE_LIMIT_EXCEEDED",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
});

export class CodingAgentError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = "CodingAgentError";
        this.code = code;
        this.details = details;
    }
}

/**
 * Extracts and cleans Python code from raw model output.
 * Handles fenced blocks (```python ... ``` or ``` ... ```) and trims whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
export function extractPythonCode(raw) {
    if (typeof raw !== "string") return "";

    const trimmed = raw.trim();

    // 1. Try matching ```python ... ```
    const pyMatch = trimmed.match(/```(?:python|py)\s*\n?([\s\S]*?)```/i);
    if (pyMatch && pyMatch[1]) {
        return pyMatch[1].trim();
    }

    // 2. Try matching generic ``` ... ```
    const genericMatch = trimmed.match(/```\s*\n?([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
        return genericMatch[1].trim();
    }

    // 3. Fallback: if no markdown fences, use trimmed raw string
    return trimmed;
}

/**
 * Validates Python source code for structural safety and bounds.
 * Note: The Docker container is the true security boundary; this static check
 * provides fast early rejection of malformed or empty outputs.
 *
 * @param {string} code
 * @throws {CodingAgentError}
 */
export function validatePythonCode(code) {
    if (typeof code !== "string" || !code.trim()) {
        throw new CodingAgentError(
            "Code validation failed: Generated code is empty or missing",
            CODING_ERROR_CODES.CODE_VALIDATION_FAILED
        );
    }

    const trimmed = code.trim();

    // Reject excessive length before passing to container (max 64 KB)
    if (Buffer.byteLength(trimmed, "utf8") > 64 * 1024) {
        throw new CodingAgentError(
            "Code validation failed: Code size exceeds 64 KB limit",
            CODING_ERROR_CODES.CODE_VALIDATION_FAILED
        );
    }

    // Reject obvious non-code conversational responses without valid syntax
    // e.g. "Sorry, I cannot write this code..."
    const lower = trimmed.toLowerCase();
    if (
        (lower.startsWith("i cannot") || lower.startsWith("i am sorry") || lower.startsWith("as an ai")) &&
        !trimmed.includes("def ") &&
        !trimmed.includes("print(") &&
        !trimmed.includes("=")
    ) {
        throw new CodingAgentError(
            "Code validation failed: Model output did not contain executable code",
            CODING_ERROR_CODES.CODE_VALIDATION_FAILED
        );
    }

    return trimmed;
}

/**
 * Independently verifies sandbox output against an expected value.
 * Never trusts LLM self-assessment.
 *
 * @param {string} stdout - Actual stdout from sandbox
 * @param {string|number|null} [expected=null] - Expected result if known
 * @returns {{ verified: boolean, expected: string|number|null, actual: string, reason: string }}
 */
export function verifyOutput(stdout, expected = null) {
    const rawActual = typeof stdout === "string" ? stdout.trim() : "";

    // If no expected value was provided, verify that execution produced output without errors
    if (expected === null || expected === undefined || expected === "") {
        return {
            verified: rawActual.length > 0,
            expected: null,
            actual: rawActual,
            reason: rawActual.length > 0
                ? "Execution produced output successfully (no expected criteria specified)"
                : "Execution produced empty stdout",
        };
    }

    const expStr = String(expected).trim();

    // Direct string match
    if (rawActual === expStr) {
        return {
            verified: true,
            expected: expStr,
            actual: rawActual,
            reason: "Actual output matches expected output exactly",
        };
    }

    // Check if the last non-empty line of stdout matches expected
    const lines = rawActual.split("\n").map((l) => l.trim()).filter(Boolean);
    const lastLine = lines[lines.length - 1] || "";
    if (lastLine === expStr) {
        return {
            verified: true,
            expected: expStr,
            actual: lastLine,
            reason: "Last line of stdout matches expected output exactly",
        };
    }

    // Numeric comparison (handle floats like 85 vs 85.0 or 85.00)
    const numExpected = Number(expStr);
    if (!Number.isNaN(numExpected)) {
        // Try parsing last line as number
        const numLastLine = Number(lastLine);
        if (!Number.isNaN(numLastLine) && Math.abs(numLastLine - numExpected) < 1e-5) {
            return {
                verified: true,
                expected: expStr,
                actual: lastLine,
                reason: `Actual numeric output ${numLastLine} matches expected ${numExpected}`,
            };
        }

        // Try searching for the numeric token in stdout
        const tokens = rawActual.split(/[\s,;:="']+/);
        for (const token of tokens) {
            const numToken = Number(token);
            if (!Number.isNaN(numToken) && Math.abs(numToken - numExpected) < 1e-5) {
                return {
                    verified: true,
                    expected: expStr,
                    actual: token,
                    reason: `Found matching numeric token ${numToken} in output for expected ${numExpected}`,
                };
            }
        }
    }

    // Check substring inclusion
    if (rawActual.includes(expStr)) {
        return {
            verified: true,
            expected: expStr,
            actual: rawActual,
            reason: `Expected string '${expStr}' found in sandbox output`,
        };
    }

    return {
        verified: false,
        expected: expStr,
        actual: rawActual,
        reason: `Output mismatch: expected '${expStr}', but got '${rawActual}'`,
    };
}

/**
 * Executes the complete 7-stage coding agent workflow.
 *
 * @param {object} params
 * @param {string} params.request - User coding prompt
 * @param {string} params.organizationId - Authoritative organization ID from auth
 * @param {string} params.userId - Authenticated user ID
 * @param {string|number} [params.expected] - Expected result for verification
 * @param {number} [params.timeoutMs=5000] - Sandbox execution timeout
 * @param {string} [params.customRunId] - Optional explicit runId
 * @param {object} [params.options] - Optional workflow options
 * @returns {Promise<object>} Judge-friendly response payload
 */
export async function runCodingWorkflow({
    request,
    organizationId,
    userId,
    expected = null,
    timeoutMs = 5000,
    customRunId = null,
    options = {},
}) {
    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new CodingAgentError(
            "organizationId must be a valid non-empty string derived from authenticated context",
            "UNAUTHORIZED"
        );
    }

    if (!request || typeof request !== "string" || !request.trim()) {
        throw new CodingAgentError(
            "User coding request must be a non-empty string",
            CODING_ERROR_CODES.CODE_VALIDATION_FAILED
        );
    }

    const runId = customRunId || `coding-run-${randomUUID()}`;
    const cleanRequest = request.trim();

    // Register tenant ownership for SSE observability
    try {
        executionEvents.registerRunOwner(runId, organizationId, "coding");
    } catch {
        // Non-blocking
    }

    // Initialize Coding Agent State
    const state = {
        runId,
        organizationId,
        userId: userId || null,
        request: cleanRequest,
        taskType: TASK_TYPE.CODING,
        selectedModel: null,
        local: true,
        generatedCode: null,
        rawModelOutput: null,
        language: "python",
        executionStatus: "pending",
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: 0,
        verificationResult: null,
        errors: [],
    };

    // Helper to emit SSE progress events
    const emitProgress = (event, data = {}) => {
        try {
            executionEvents.publish(
                runId,
                event,
                { runId, organizationId, taskType: state.taskType, ...data },
                null,
                organizationId
            );
        } catch {
            // Non-blocking
        }
    };

    // Helper to persist initial agent_run record
    try {
        await createAgentRun({
            runId,
            userId: state.userId,
            organizationId: state.organizationId,
            goal: cleanRequest.slice(0, 500),
            model: "pending",
            status: "running",
            startedAt: new Date(),
        });
    } catch (dbErr) {
        // Non-blocking if table is unavailable or foreign key check fails
    }

    try {
        // ─────────────────────────────────────────────────────────────
        // STAGE 1: classify_task
        // ─────────────────────────────────────────────────────────────
        emitProgress("classifying_task", { request: cleanRequest });
        const classified = classifyTask(cleanRequest);
        state.taskType = classified;

        // ─────────────────────────────────────────────────────────────
        // STAGE 2: select_model
        // ─────────────────────────────────────────────────────────────
        emitProgress("model_selected", { taskType: classified });
        let routing;
        try {
            routing = await routeTask(cleanRequest);
            state.selectedModel = routing.selectedModel;
            state.local = routing.local !== false;
        } catch (routerErr) {
            if (routerErr instanceof RouterError) {
                throw new CodingAgentError(
                    `Model routing error: ${routerErr.message}`,
                    CODING_ERROR_CODES.MODEL_UNAVAILABLE,
                    { reason: routerErr.reason }
                );
            }
            throw routerErr;
        }

        // ─────────────────────────────────────────────────────────────
        // STAGE 3: generate_code
        // ─────────────────────────────────────────────────────────────
        emitProgress("generating_code", { model: state.selectedModel });

        const codingSystemPrompt = `You are a professional Python engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Include necessary variables, calculations, and print() calls to output the final result clearly.
Do not require external internet access or non-standard packages. Only use the Python standard library.

User Request:
${cleanRequest}

Return ONLY the executable Python code inside a \`\`\`python code block. Do not include conversational filler.`;

        // If mockCode is supplied in options (e.g. for deterministic unit testing), use it;
        // otherwise call local LLM.
        let rawModelOutput;
        if (options && options.mockGeneratedCode) {
            rawModelOutput = options.mockGeneratedCode;
        } else {
            rawModelOutput = await generateAnswer(codingSystemPrompt, state.selectedModel);
        }
        state.rawModelOutput = rawModelOutput;

        // ─────────────────────────────────────────────────────────────
        // STAGE 4: validate_code
        // ─────────────────────────────────────────────────────────────
        emitProgress("validating_code");
        const extracted = extractPythonCode(rawModelOutput);
        const validatedCode = validatePythonCode(extracted);
        state.generatedCode = validatedCode;

        // ─────────────────────────────────────────────────────────────
        // STAGE 5: execute_sandbox
        // ─────────────────────────────────────────────────────────────
        emitProgress("executing_sandbox", { language: "python", timeoutMs });
        state.executionStatus = "running";

        const executionResult = await executeInSandbox({
            code: validatedCode,
            language: "python",
            timeoutMs,
        });

        state.stdout = executionResult.stdout || "";
        state.stderr = executionResult.stderr || "";
        state.exitCode = executionResult.exitCode;
        state.durationMs = executionResult.durationMs || 0;

        if (executionResult.timedOut) {
            state.executionStatus = "failed";
            throw new CodingAgentError(
                `Sandbox execution timed out after ${timeoutMs / 1000}s`,
                CODING_ERROR_CODES.EXECUTION_TIMEOUT,
                { durationMs: state.durationMs, stderr: state.stderr }
            );
        }

        // Check for resource exhaustion / memory kill (e.g. exitCode 137)
        if (executionResult.exitCode === 137) {
            state.executionStatus = "failed";
            throw new CodingAgentError(
                "Sandbox process was killed due to memory resource limit (--memory 256m)",
                CODING_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
                { exitCode: 137, stderr: state.stderr }
            );
        }

        if (executionResult.exitCode !== 0) {
            state.executionStatus = "failed";
            throw new CodingAgentError(
                `Sandbox execution failed with exit code ${executionResult.exitCode}: ${executionResult.stderr}`,
                CODING_ERROR_CODES.EXECUTION_FAILED,
                { exitCode: executionResult.exitCode, stderr: executionResult.stderr }
            );
        }

        state.executionStatus = "completed";

        // ─────────────────────────────────────────────────────────────
        // STAGE 6: verify_result
        // ─────────────────────────────────────────────────────────────
        emitProgress("verifying_result", { stdout: state.stdout, expected });

        const verification = verifyOutput(state.stdout, expected);
        state.verificationResult = verification;

        if (expected !== null && expected !== undefined && !verification.verified) {
            throw new CodingAgentError(
                verification.reason,
                CODING_ERROR_CODES.VERIFICATION_FAILED,
                { verification }
            );
        }

        // ─────────────────────────────────────────────────────────────
        // STAGE 7: return_result
        // ─────────────────────────────────────────────────────────────
        emitProgress("completed", {
            verified: state.verificationResult.verified,
            exitCode: state.exitCode,
        });

        // Persist final agent_run state
        try {
            await updateAgentRun(runId, {
                status: "completed",
                completedAt: new Date(),
                durationMs: state.durationMs,
                finalAnswer: state.stdout.trim(),
            });
        } catch {
            // Non-blocking
        }

        // Record technical telemetry
        telemetryService.recordAiExecution({
            runId,
            organizationId: state.organizationId,
            taskType: state.taskType,
            selectedModel: state.selectedModel,
            local: true,
            status: "completed",
            totalLatencyMs: state.durationMs,
            modelLatencyMs: state.durationMs,
        });

        return {
            taskType: state.taskType,
            selectedModel: state.selectedModel,
            local: true,
            language: "python",
            generatedCode: state.generatedCode,
            execution: {
                status: "completed",
                exitCode: state.exitCode,
                stdout: state.stdout,
                stderr: state.stderr,
                durationMs: state.durationMs,
            },
            verification: state.verificationResult,
        };
    } catch (err) {
        state.executionStatus = "failed";
        state.errors.push(err.message);

        // Update DB run status on failure
        try {
            await updateAgentRun(runId, {
                status: "failed",
                completedAt: new Date(),
                durationMs: state.durationMs,
                error: err.message,
            });
        } catch {
            // Non-blocking
        }

        emitProgress("failed", {
            error: err.message,
            code: err.code || "EXECUTION_FAILED",
        });

        // Return structured failure response or rethrow CodingAgentError with full state details
        if (err instanceof CodingAgentError) {
            err.state = state;
            throw err;
        }

        throw new CodingAgentError(
            err.message,
            CODING_ERROR_CODES.EXECUTION_FAILED,
            { state }
        );
    }
}
