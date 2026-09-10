import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT_PATH = path.join(__dirname, "generate_docx.py");

const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL", null]);

/**
 * Validates the input structure for Approval Note generation.
 *
 * @param {object} input
 * @returns {object} Normalized and sanitized data
 */
export function validateApprovalNoteInput(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Approval Note input must be an object");
    }

    const {
        subject,
        background,
        findings,
        technicalAnalysis,
        riskAssessment,
        recommendation,
        citations,
        metadata,
    } = input;

    // 1. Findings validation: must be a non-empty array
    if (!Array.isArray(findings) || findings.length === 0) {
        throw new Error("Cannot generate Approval Note: findings must be a non-empty array");
    }

    const sanitizedFindings = findings.map((f, idx) => {
        if (!f || typeof f !== "object" || Array.isArray(f)) {
            throw new TypeError(`findings[${idx}] must be an object`);
        }

        const finding = f.finding !== undefined && f.finding !== null ? String(f.finding).trim() : null;
        const evidence = f.evidence !== undefined && f.evidence !== null ? String(f.evidence).trim() : null;

        if (!finding) {
            throw new Error(`findings[${idx}] must have a non-empty finding description`);
        }

        return {
            finding,
            equipment: f.equipment !== undefined && f.equipment !== null ? String(f.equipment).trim() : null,
            observedValue: f.observedValue !== undefined && f.observedValue !== null ? String(f.observedValue).trim() : null,
            limit: f.limit !== undefined && f.limit !== null ? String(f.limit).trim() : null,
            severity: f.severity !== undefined && f.severity !== null ? String(f.severity).trim() : null,
            evidence,
            source: f.source ?? null,
            sopEvidence: Array.isArray(f.sopEvidence) ? f.sopEvidence : [],
        };
    });

    // 2. Risk Assessment validation
    if (!riskAssessment || typeof riskAssessment !== "object" || Array.isArray(riskAssessment)) {
        throw new TypeError("riskAssessment must be an object");
    }

    let level = riskAssessment.level;
    if (level !== null && level !== undefined) {
        if (typeof level !== "string") {
            throw new TypeError("riskAssessment.level must be a string or null");
        }
        level = level.trim().toUpperCase();
    } else {
        level = null;
    }

    if (!ALLOWED_RISK_LEVELS.has(level)) {
        throw new Error(`Invalid risk level: '${riskAssessment.level}'. Allowed levels: LOW, MEDIUM, HIGH, CRITICAL, null`);
    }

    if (
        typeof riskAssessment.reason !== "string" ||
        riskAssessment.reason.trim().length === 0
    ) {
        throw new TypeError("riskAssessment.reason must be a non-empty string");
    }

    // 3. Recommendation validation
    let rec = recommendation;
    if (typeof rec !== "string" || rec.trim().length === 0) {
        if (level === null) {
            rec = "Insufficient SOP evidence is available to provide a validated recommendation.";
        } else {
            throw new TypeError("recommendation must be a non-empty string");
        }
    }

    // 4. Citations / References validation: must be a non-empty array
    const rawCitations = Array.isArray(citations)
        ? citations
        : Array.isArray(input.references)
        ? input.references
        : [];

    if (rawCitations.length === 0) {
        throw new Error("Cannot generate Approval Note: citations must be a non-empty array");
    }

    const sanitizedCitations = rawCitations.map((c, idx) => {
        if (!c || typeof c !== "object" || Array.isArray(c)) {
            throw new TypeError(`citations[${idx}] must be an object`);
        }

        const documentId = c.documentId !== undefined && c.documentId !== null ? String(c.documentId).trim() : null;
        const filename = c.filename !== undefined && c.filename !== null ? String(c.filename).trim() : null;

        if (!documentId && !filename) {
            throw new Error(`citations[${idx}] must contain a valid documentId or filename`);
        }

        return {
            documentId,
            filename,
            page: c.page !== undefined && c.page !== null ? c.page : null,
            chunkIndex: c.chunkIndex !== undefined && c.chunkIndex !== null ? c.chunkIndex : null,
        };
    });

    return {
        subject: typeof subject === "string" && subject.trim() ? subject.trim() : null,
        background: typeof background === "string" && background.trim() ? background.trim() : null,
        findings: sanitizedFindings,
        technicalAnalysis: typeof technicalAnalysis === "string" && technicalAnalysis.trim() ? technicalAnalysis.trim() : null,
        riskAssessment: {
            level,
            reason: riskAssessment.reason.trim(),
            likelihood: riskAssessment.likelihood || null,
            severity: riskAssessment.severity || null,
        },
        recommendation: rec.trim(),
        citations: sanitizedCitations,
        references: sanitizedCitations,
        metadata: metadata && typeof metadata === "object" ? metadata : {},
    };
}

/**
 * Generates an Approval Note DOCX from trusted findings and risk outputs.
 * Enforces subprocess timeout and filesystem path containment.
 *
 * @param {object} data
 * @param {object} [options]
 * @param {string} [options.outputPath] Optional custom file path (defaults to Approval_Note.docx)
 * @param {string} [options.pythonPath] Optional path to python binary
 * @returns {Promise<string>} Absolute path of generated DOCX
 */
export async function generateApprovalNote(data, options = {}) {
    // 1. Validate and sanitize input
    const validatedData = validateApprovalNoteInput(data);

    // 2. Resolve and secure output path
    let outputPath = options.outputPath
        ? path.resolve(options.outputPath)
        : path.resolve(process.cwd(), "Approval_Note.docx");

    // Defend against directory traversal in filename / path
    const normalizedOutput = path.normalize(outputPath);
    if (normalizedOutput.includes("..")) {
        throw new Error("Invalid output path: directory traversal is prohibited");
    }

    // 3. Ensure parent directory exists
    const outputDir = path.dirname(normalizedOutput);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const pythonBin = options.pythonPath || process.env.PYTHON_PATH || "python3";
    const timeoutMs = Number(options.timeoutMs || process.env.DOCX_TIMEOUT_MS || 30000);

    return new Promise((resolve, reject) => {
        let isSettled = false;
        const child = spawn(pythonBin, [PYTHON_SCRIPT_PATH, "--output", normalizedOutput]);

        const timer = setTimeout(() => {
            if (!isSettled) {
                isSettled = true;
                child.kill("SIGTERM");
                setTimeout(() => {
                    try { child.kill("SIGKILL"); } catch { /* ignore */ }
                }, 2000);
                reject(new Error(`Python DOCX generator timed out after ${timeoutMs / 1000} seconds`));
            }
        }, timeoutMs);

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (err) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);
                reject(new Error(`Failed to spawn Python process: ${err.message}`, { cause: err }));
            }
        });

        child.on("close", (code) => {
            if (!isSettled) {
                isSettled = true;
                clearTimeout(timer);

                if (code !== 0) {
                    return reject(
                        new Error(
                            `Python DOCX generator exited with code ${code}: ${stderr || stdout}`
                        )
                    );
                }

                const returnedPath = stdout.trim() || normalizedOutput;
                resolve(returnedPath);
            }
        });

        // Pipe sanitized JSON payload to Python script
        child.stdin.write(JSON.stringify(validatedData));
        child.stdin.end();
    });
}
