/**
 * PR #24 — Coding Controller
 *
 * Handles:
 *   POST /api/v1/coding/generate — routes request through Model Router and generates Python code
 *   POST /api/v1/coding/execute  — executes code in an isolated, network-disabled Docker sandbox
 */

import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import { routeTask, RouterError, isModelAllowed } from "../../../ai-service/router/modelRouter.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";
import {
    runCodingWorkflow,
    CodingAgentError,
    CODING_ERROR_CODES,
} from "../services/coding-agent.service.js";
import {
    executeInSandbox,
    SandboxValidationError,
} from "../services/sandbox.service.js";

/**
 * Strips markdown code fences (```python ... ```, ```javascript ... ```, or generic ``` ... ```) or trims whitespace.
 * Ensures the generated code is ready for direct interpreter execution.
 *
 * @param {string} raw
 * @param {string} [language="python"]
 * @returns {string}
 */
export function cleanGeneratedCode(raw, language = "python") {
    if (typeof raw !== "string") return "";

    const trimmed = raw.trim();
    const normLang = String(language || "python").trim().toLowerCase();

    if (normLang === "javascript" || normLang === "js" || normLang === "node") {
        const jsMatch = trimmed.match(/```(?:javascript|js|node)\s*\n?([\s\S]*?)```/i);
        if (jsMatch && jsMatch[1]) {
            return jsMatch[1].trim();
        }
    } else {
        const pyMatch = trimmed.match(/```(?:python|py)\s*\n?([\s\S]*?)```/i);
        if (pyMatch && pyMatch[1]) {
            return pyMatch[1].trim();
        }
    }

    const genericMatch = trimmed.match(/```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/);
    if (genericMatch && genericMatch[1]) {
        return genericMatch[1].trim();
    }

    return trimmed;
}

/**
 * POST /api/v1/coding/generate
 *
 * Accepts a user coding request ({ request, prompt, language }), passes it through
 * the Model Router, and generates executable code using the configured local model.
 */
export async function generateCode(req, res, next) {
    try {
        const { prompt, request, language = "python", model } = req.body || {};
        const codingPrompt = prompt || request;

        if (typeof codingPrompt !== "string" || !codingPrompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid request or prompt is required",
            });
        }

        const rawLang = String(language || "python").trim().toLowerCase();
        const normLang = (rawLang === "javascript" || rawLang === "js" || rawLang === "node")
            ? "javascript"
            : (rawLang === "python" || rawLang === "py" ? "python" : rawLang);

        if (normLang !== "python" && normLang !== "javascript") {
            return res.status(400).json({
                success: false,
                message: `Unsupported language '${language}'. Supported: python, javascript.`,
            });
        }

        if (model) {
            if (!isModelAllowed(model)) {
                return res.status(400).json({
                    success: false,
                    code: "MODEL_NOT_ALLOWED",
                    message: `Model '${model}' is not in the sovereign model allowlist.`,
                });
            }
        }

        // 1. Route through Model Router
        let routing;
        try {
            routing = await routeTask(codingPrompt.trim(), { model });
        } catch (routerErr) {
            if (routerErr instanceof RouterError) {
                if (routerErr.code === "MODEL_NOT_ALLOWED") {
                    return res.status(400).json({
                        success: false,
                        code: "MODEL_NOT_ALLOWED",
                        message: routerErr.message,
                    });
                }
                return res.status(503).json({
                    success: false,
                    message: routerErr.message,
                    code: "MODEL_UNAVAILABLE",
                });
            }
            throw routerErr;
        }

        // 2. Generate code with local model
        const isJs = normLang === "javascript";
        const codingSystemPrompt = isJs
            ? `You are a professional JavaScript engineer.
Write clean, executable, self-contained JavaScript (Node.js) code that directly fulfills the following user request.
Include necessary variables, calculations, and console.log() calls to demonstrate the result.
Do not require external internet access or non-standard packages. Only use the Node.js standard library.

User Request:
${codingPrompt.trim()}

Return ONLY the JavaScript code inside a \`\`\`javascript code block.`
            : `You are a professional Python engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Include necessary variables, calculations, and print() calls to demonstrate the result.
Do not require external internet access or non-standard packages.

User Request:
${codingPrompt.trim()}

Return ONLY the Python code inside a \`\`\`python code block.`;

        const rawOutput = await generateAnswer(codingSystemPrompt, routing.selectedModel);
        const code = cleanGeneratedCode(rawOutput, normLang);

        return res.status(200).json({
            success: true,
            taskType: routing.taskType,
            model: routing.selectedModel,
            language: normLang,
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
 * Accepts source code and runs it strictly inside an isolated,
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
            language: result.sandbox?.language || language,
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

/**
 * POST /api/v1/coding/workflow
 *
 * Exposes the full 7-stage coding agent workflow:
 *   classify_task -> select_model -> generate_code -> validate_code ->
 *   execute_sandbox -> verify_result -> return_result
 *
 * Enforces authoritative organizationId resolution.
 */
export async function runCodingWorkflowHandler(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || req.user?.sub || null;

        const { prompt, request, language = "python", expected, timeoutMs, customRunId, model } = req.body || {};
        const codingRequest = prompt || request;

        if (typeof codingRequest !== "string" || !codingRequest.trim()) {
            return res.status(400).json({
                success: false,
                code: CODING_ERROR_CODES.CODE_VALIDATION_FAILED,
                message: "Valid prompt or request string is required",
            });
        }

        if (model) {
            if (!isModelAllowed(model)) {
                return res.status(400).json({
                    success: false,
                    code: "MODEL_NOT_ALLOWED",
                    message: `Model '${model}' is not in the sovereign model allowlist.`,
                });
            }
        }

        const result = await runCodingWorkflow({
            request: codingRequest,
            organizationId,
            userId,
            language,
            expected,
            timeoutMs,
            customRunId,
            model,
        });

        return res.status(200).json({
            success: true,
            taskType: result.taskType,
            selectedModel: result.selectedModel,
            local: result.local,
            language: result.language,
            generatedCode: result.generatedCode,
            execution: result.execution,
            verification: result.verification,
        });
    } catch (error) {
        if (error instanceof CodingAgentError) {
            const statusMap = {
                [CODING_ERROR_CODES.MODEL_NOT_ALLOWED]: 400,
                [CODING_ERROR_CODES.MODEL_UNAVAILABLE]: 503,
                [CODING_ERROR_CODES.CODE_VALIDATION_FAILED]: 400,
                [CODING_ERROR_CODES.EXECUTION_TIMEOUT]: 408,
                [CODING_ERROR_CODES.RESOURCE_LIMIT_EXCEEDED]: 413,
                [CODING_ERROR_CODES.EXECUTION_FAILED]: 422,
                [CODING_ERROR_CODES.VERIFICATION_FAILED]: 422,
            };
            const statusCode = statusMap[error.code] || 400;

            return res.status(statusCode).json({
                success: false,
                code: error.code,
                message: error.message,
                execution: error.details?.state ? {
                    status: error.details.state.executionStatus,
                    exitCode: error.details.state.exitCode,
                    stdout: error.details.state.stdout,
                    stderr: error.details.state.stderr,
                    durationMs: error.details.state.durationMs,
                } : undefined,
                verification: error.details?.verification || {
                    verified: false,
                    reason: error.message,
                },
            });
        }
        next(error);
    }
}
