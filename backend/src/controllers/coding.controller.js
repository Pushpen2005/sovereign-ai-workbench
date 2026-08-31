/**
 * PR #24 — Coding Controller
 *
 * Handles:
 *   POST /api/v1/coding/generate — routes request through Model Router and generates Python code
 *   POST /api/v1/coding/execute  — executes code in an isolated, network-disabled Docker sandbox
 */

import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import { routeTask, RouterError } from "../../../ai-service/router/modelRouter.js";
import {
    executeInSandbox,
    SandboxValidationError,
} from "../services/sandbox.service.js";

/**
 * Strips markdown code fences (```python ... ```) or trims whitespace.
 * Ensures the generated code is ready for direct interpreter execution.
 *
 * @param {string} raw
 * @returns {string}
 */
export function cleanGeneratedCode(raw) {
    if (typeof raw !== "string") return "";

    const trimmed = raw.trim();

    // Check for fenced code block: ```python ... ``` or ``` ... ```
    const match = trimmed.match(/```(?:python)?\s*\n?([\s\S]*?)```/i);
    if (match && match[1]) {
        return match[1].trim();
    }

    return trimmed;
}

/**
 * POST /api/v1/coding/generate
 *
 * Accepts a user coding request, passes it through the Model Router,
 * and generates Python code using the configured local model.
 */
export async function generateCode(req, res, next) {
    try {
        const { prompt } = req.body || {};

        if (typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid prompt is required",
            });
        }

        // 1. Route through Model Router
        let routing;
        try {
            routing = await routeTask(prompt.trim());
        } catch (routerErr) {
            if (routerErr instanceof RouterError) {
                return res.status(503).json({
                    success: false,
                    message: routerErr.message,
                    code: "MODEL_UNAVAILABLE",
                });
            }
            throw routerErr;
        }

        // 2. Generate code with local model
        const codingSystemPrompt = `You are a professional Python engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Include necessary variables, calculations, and print() calls to demonstrate the result.
Do not require external internet access or non-standard packages.

User Request:
${prompt.trim()}

Return ONLY the Python code inside a \`\`\`python code block.`;

        const rawOutput = await generateAnswer(codingSystemPrompt, routing.selectedModel);
        const code = cleanGeneratedCode(rawOutput);

        return res.status(200).json({
            success: true,
            taskType: routing.taskType,
            model: routing.selectedModel,
            language: "python",
            code,
            rawOutput,
            routingReason: routing.routingReason,
            isFallback: routing.isFallback,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/v1/coding/execute
 *
 * Accepts Python source code and runs it strictly inside an isolated,
 * unprivileged, network-disabled Docker container.
 */
export async function executeCode(req, res, next) {
    try {
        const { code, language = "python", timeoutMs } = req.body || {};

        if (typeof code !== "string" || !code.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid code string is required",
            });
        }

        const result = await executeInSandbox({
            code,
            language,
            timeoutMs,
        });

        return res.status(200).json({
            success: result.success,
            language: "python",
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdoutTruncated: result.stdoutTruncated,
            stderrTruncated: result.stderrTruncated,
            durationMs: result.durationMs,
            sandbox: result.sandbox,
        });
    } catch (error) {
        if (error instanceof SandboxValidationError) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
}
