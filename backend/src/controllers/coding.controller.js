/**
 * PR #24 / PR #25 — Coding Controller
 *
 * Handles:
 *   POST /api/v1/coding/generate — routes request through Model Router and generates Python code
 *   POST /api/v1/coding/execute  — executes Python code in an isolated, network-disabled Docker sandbox
 *   POST /api/v1/coding/workflow — orchestrates 7-stage coding agent workflow
 *
 * Python-only contract: All non-Python requests are strictly rejected.
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
    validateLanguage,
    SUPPORTED_LANGUAGE,
    SandboxValidationError,
} from "../services/sandbox.service.js";
import {
    validateAndParseCsv,
    CsvValidationError,
} from "../services/csv.service.js";

export class CodeExtractionError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "CodeExtractionError";
        this.stage = "code_extraction";
        this.details = details;
    }
}

/**
 * Robust Python code extraction layer.
 * Strips markdown code fences (```python ... ``` or generic ``` ... ```)
 * while safely ignoring surrounding conversational explanation.
 *
 * Handles:
 *   Case A: ```python\nprint("hello")\n``` -> print("hello")
 *   Case B: Explanation + ```python\nprint("hello")\n``` + Explanation -> print("hello")
 *   Case C: Raw Python -> print("hello")
 *   Case D: Generic fenced block ```\nprint("hello")\n``` -> print("hello")
 *   Case E: Empty / null / conversational refusal -> throws CodeExtractionError
 *
 * @param {string} raw
 * @returns {string} Clean Python source
 * @throws {CodeExtractionError}
 */
export function extractPythonCode(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        throw new CodeExtractionError("No executable Python code was generated.");
    }

    const trimmed = raw.trim();

    // 1. Language-specific python fence (case-insensitive)
    const pyMatch = trimmed.match(/```(?:python|py)\s*\n?([\s\S]*?)```/i);
    if (pyMatch && pyMatch[1] && pyMatch[1].trim()) {
        return pyMatch[1].trim();
    }

    // 2. Generic fenced block
    const genericMatch = trimmed.match(/```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/);
    if (genericMatch && genericMatch[1] && genericMatch[1].trim()) {
        return genericMatch[1].trim();
    }

    // 3. If markdown fences were present but empty inside:
    if (trimmed.includes("```")) {
        throw new CodeExtractionError("No executable Python code was generated.");
    }

    // 4. Conversational refusals or apologies without code
    const lower = trimmed.toLowerCase();
    if (
        (lower.startsWith("i cannot") ||
         lower.startsWith("i am sorry") ||
         lower.startsWith("as an ai") ||
         lower.startsWith("sorry,")) &&
        !trimmed.includes("def ") &&
        !trimmed.includes("print(") &&
        !trimmed.includes("import ") &&
        !trimmed.includes("=")
    ) {
        throw new CodeExtractionError("No executable Python code was generated.");
    }

    // 5. Raw Python without fences
    return trimmed;
}

/**
 * Backward-compatible helper for legacy callers.
 */
export function cleanGeneratedCode(raw) {
    try {
        return extractPythonCode(raw);
    } catch {
        return "";
    }
}

/**
 * Helper to extract and validate CSV from multipart file or JSON body.
 */
function resolveCsvInput(req) {
    if (req.file) {
        return validateAndParseCsv({
            content: req.file.buffer,
            filename: req.file.originalname || "data.csv",
            mimeType: req.file.mimetype,
        });
    }

    const bodyCsv = req.body?.csvContent || req.body?.csvData || req.body?.csv;
    if (bodyCsv && typeof bodyCsv === "string" && bodyCsv.trim()) {
        return validateAndParseCsv({
            content: bodyCsv,
            filename: req.body?.csvFilename || "data.csv",
        });
    }

    return null;
}

/**
 * POST /api/v1/coding/generate
 *
 * Accepts a Python coding request ({ prompt, language, model, [csv] }),
 * passes it through the Model Router, and generates executable Python code.
 */
export async function generateCode(req, res, next) {
    try {
        const { prompt, request, language = SUPPORTED_LANGUAGE, model } = req.body || {};
        const codingPrompt = prompt || request;

        // 1. Language validation — Python only
        try {
            validateLanguage(language);
        } catch (langErr) {
            return res.status(400).json({
                success: false,
                error: "Only Python execution is supported.",
            });
        }

        if (typeof codingPrompt !== "string" || !codingPrompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Valid request or prompt is required",
            });
        }

        if (model && !isModelAllowed(model)) {
            return res.status(400).json({
                success: false,
                code: "MODEL_NOT_ALLOWED",
                message: `Model '${model}' is not in the sovereign model allowlist.`,
            });
        }

        // 2. CSV validation (if provided)
        let csvMeta = null;
        try {
            csvMeta = resolveCsvInput(req);
        } catch (csvErr) {
            if (csvErr instanceof CsvValidationError) {
                return res.status(400).json({
                    success: false,
                    stage: "csv_validation",
                    error: csvErr.message,
                });
            }
            throw csvErr;
        }

        // 3. Route through Model Router — explicitly for CODING task
        let routing;
        try {
            routing = await routeTask(codingPrompt.trim(), { taskType: "CODING", model });
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

        // 4. Construct Python-only model prompt with optional CSV context
        const csvContextPrompt = csvMeta
            ? `\nA CSV dataset has been uploaded and will be available inside the isolated sandbox at:
/workspace/input/data.csv

CSV Filename: ${csvMeta.filename}
Columns: ${csvMeta.columns.join(", ")}
Total Rows: ${csvMeta.rowCount}
Sample Data Preview:
${csvMeta.samplePreview}

CRITICAL CSV PROCESSING INSTRUCTIONS:
1. Process every CSV record/row INDEPENDENTLY in a single unified loop.
2. All numeric conversions (using float() or int()), calculations, classifications, and per-row printing MUST occur INSIDE the row-processing loop while processing that specific record.
3. NEVER separate calculation and output into disconnected loops where earlier records might accidentally reference variables from the final iteration.
4. Never reuse or leak variables from the final iteration into earlier records.
5. Preserve the original timestamp and row values for each record.
6. Print each row's timestamp, sensor values, calculated efficiency, and classification while processing that record inside the loop. Verify that printed output values strictly correspond to the input row.
7. Accumulate running metrics (e.g. total efficiency, count, max temperature) inside the loop, and print the overall summary, averages, and maintenance recommendation AFTER the loop.
8. If appending rows to a list for later summary/recommendation output, store computed values explicitly (e.g. row['efficiency'] = efficiency or store a custom dict) to ensure keys exist.
9. Do not hardcode CSV values. Read the actual file from '/workspace/input/data.csv' using Python's standard library "csv" module (e.g. csv.DictReader).
10. Use ONLY Python standard library modules (e.g. csv, math, statistics). Do NOT require pandas, numpy, or external libraries.
11. Rule: Process every record independently. All calculations, classifications, and per-row output must occur while processing that specific record. Never use variables from the final iteration to represent earlier records.
12. Keep the CSV reader iteration inside the same open-file context. Never iterate over csv.DictReader after its underlying file has been closed.
13. INPUT FIELDS are only the columns present in the CSV. DERIVED FIELDS (such as health_score and classification) must be calculated after reading input fields; never look up a derived field in the CSV header.
14. Initialize summary collections before the loop and append values, including the timestamp with any maximum/minimum row. Guard empty collections for max(), min(), averages, sums, and counts, and guard every division against zero denominators.
15. Treat invalid or missing numeric values explicitly (skip with a clear message or fail clearly); never turn invalid data into misleading statistics. Reject NaN and infinite values where applicable.
`
            : "";

        const codingSystemPrompt = `You are an expert Python data-analysis and software engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Include necessary variables, calculations, and print() calls to demonstrate the result clearly.
Do not require external internet access or non-standard packages. Only use the Python standard library (e.g. csv, math, statistics).
Hard requirements: process every row independently; keep CSV iteration inside the open-file context; calculate derived fields rather than treating them as input columns; maintain summary state during row processing; guard empty datasets and collections, zero denominators, invalid numeric values, and non-finite values; validate the Python source before execution; use standard-library Python only; never hardcode analytical results; and never intentionally create errors unless explicitly testing sandbox behavior.
${csvContextPrompt}
User Request:
${codingPrompt.trim()}

Return ONLY the Python code inside a \`\`\`python code block.`;

        // 5. Generate code with local model
        const rawOutput = await generateAnswer(codingSystemPrompt, routing.selectedModel);

        // 6. Robust code extraction
        let code;
        try {
            code = extractPythonCode(rawOutput);
        } catch (extractionErr) {
            return res.status(422).json({
                success: false,
                stage: "code_extraction",
                error: "No executable Python code was generated.",
            });
        }

        return res.status(200).json({
            success: true,
            taskType: routing.taskType,
            model: routing.selectedModel,
            language: SUPPORTED_LANGUAGE,
            code,
            rawOutput,
            csv: csvMeta ? {
                filename: csvMeta.filename,
                columns: csvMeta.columns,
                rowCount: csvMeta.rowCount,
            } : null,
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
 * Accepts Python source code (and optional CSV) and runs it strictly
 * inside an isolated, network-disabled Docker container.
 */
export async function executeCode(req, res, next) {
    try {
        const { code, language = SUPPORTED_LANGUAGE, timeoutMs } = req.body || {};

        // 1. Language validation — strictly Python
        try {
            validateLanguage(language);
        } catch (langErr) {
            return res.status(400).json({
                success: false,
                error: "Only Python execution is supported.",
            });
        }

        // 2. Code validation
        if (typeof code !== "string" || !code.trim()) {
            return res.status(400).json({
                success: false,
                stage: "validation",
                error: "Valid code string is required",
            });
        }

        // 3. CSV validation (if provided)
        let csvMeta = null;
        try {
            csvMeta = resolveCsvInput(req);
        } catch (csvErr) {
            if (csvErr instanceof CsvValidationError) {
                return res.status(400).json({
                    success: false,
                    stage: "csv_validation",
                    error: csvErr.message,
                });
            }
            throw csvErr;
        }

        // 4. Isolated Docker execution
        const result = await executeInSandbox({
            code,
            language: SUPPORTED_LANGUAGE,
            timeoutMs,
            csvContent: csvMeta ? csvMeta.content : null,
        });

        return res.status(200).json({
            success: result.success,
            stage: result.stage || "execution",
            language: SUPPORTED_LANGUAGE,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            error: result.error,
            stdoutTruncated: result.stdoutTruncated,
            stderrTruncated: result.stderrTruncated,
            sandbox: result.sandbox,
            csv: csvMeta ? {
                filename: csvMeta.filename,
                columns: csvMeta.columns,
                rowCount: csvMeta.rowCount,
            } : null,
        });
    } catch (error) {
        if (error instanceof SandboxValidationError) {
            return res.status(400).json({
                success: false,
                error: error.message,
                code: error.code,
                stage: error.stage,
                details: error.details,
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
 */
export async function runCodingWorkflowHandler(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || req.user?.sub || null;

        const { prompt, request, language = SUPPORTED_LANGUAGE, expected, timeoutMs, customRunId, model } = req.body || {};
        const codingRequest = prompt || request;

        try {
            validateLanguage(language);
        } catch (langErr) {
            return res.status(400).json({
                success: false,
                error: "Only Python execution is supported.",
            });
        }

        if (typeof codingRequest !== "string" || !codingRequest.trim()) {
            return res.status(400).json({
                success: false,
                code: CODING_ERROR_CODES.CODE_VALIDATION_FAILED,
                message: "Valid prompt or request string is required",
            });
        }

        if (model && !isModelAllowed(model)) {
            return res.status(400).json({
                success: false,
                code: "MODEL_NOT_ALLOWED",
                message: `Model '${model}' is not in the sovereign model allowlist.`,
            });
        }

        let csvMeta = null;
        try {
            csvMeta = resolveCsvInput(req);
        } catch (csvErr) {
            if (csvErr instanceof CsvValidationError) {
                return res.status(400).json({
                    success: false,
                    stage: "csv_validation",
                    error: csvErr.message,
                });
            }
            throw csvErr;
        }

        const result = await runCodingWorkflow({
            request: codingRequest,
            organizationId,
            userId,
            language: SUPPORTED_LANGUAGE,
            expected,
            timeoutMs,
            customRunId,
            model,
            csvContent: csvMeta ? csvMeta.content : null,
        });

        return res.status(200).json({
            success: true,
            taskType: result.taskType,
            selectedModel: result.selectedModel,
            local: result.local,
            language: SUPPORTED_LANGUAGE,
            generatedCode: result.generatedCode,
            execution: result.execution,
            verification: result.verification,
            csv: csvMeta ? {
                filename: csvMeta.filename,
                columns: csvMeta.columns,
                rowCount: csvMeta.rowCount,
            } : null,
        });
    } catch (error) {
        if (error instanceof CodingAgentError) {
            const statusMap = {
                [CODING_ERROR_CODES.MODEL_NOT_ALLOWED]: 400,
                [CODING_ERROR_CODES.MODEL_UNAVAILABLE]: 503,
                [CODING_ERROR_CODES.CODE_VALIDATION_FAILED]: 400,
                [CODING_ERROR_CODES.PYTHON_SYNTAX_ERROR]: 422,
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
