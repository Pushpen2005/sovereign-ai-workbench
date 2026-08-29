import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT_PATH = path.join(__dirname, "generate_docx.py");

const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", null]);

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
    } = input;

    // 1. Findings validation (PR #13 contract)
    if (!Array.isArray(findings)) {
        throw new TypeError("findings must be an array");
    }

    const sanitizedFindings = findings.map((f, idx) => {
        if (!f || typeof f !== "object" || Array.isArray(f)) {
            throw new TypeError(`findings[${idx}] must be an object`);
        }

        return {
            finding: f.finding !== undefined && f.finding !== null ? String(f.finding).trim() : null,
            equipment: f.equipment !== undefined && f.equipment !== null ? String(f.equipment).trim() : null,
            observedValue: f.observedValue !== undefined && f.observedValue !== null ? String(f.observedValue).trim() : null,
            limit: f.limit !== undefined && f.limit !== null ? String(f.limit).trim() : null,
            severity: f.severity !== undefined && f.severity !== null ? String(f.severity).trim() : null,
            evidence: f.evidence !== undefined && f.evidence !== null ? String(f.evidence).trim() : null,
            source: f.source ?? null,
        };
    });

    // 2. Risk Assessment validation (PR #15 contract)
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
        throw new Error(`Invalid risk level: '${riskAssessment.level}'. Allowed levels: LOW, MEDIUM, HIGH, null`);
    }

    if (
        typeof riskAssessment.reason !== "string" ||
        riskAssessment.reason.trim().length === 0
    ) {
        throw new TypeError("riskAssessment.reason must be a non-empty string");
    }

    // 3. Recommendation validation (PR #15 contract)
    if (
        typeof recommendation !== "string" ||
        recommendation.trim().length === 0
    ) {
        throw new TypeError("recommendation must be a non-empty string");
    }

    // 4. Citations validation (PR #15 contract)
    if (!Array.isArray(citations)) {
        throw new TypeError("citations must be an array");
    }

    const sanitizedCitations = citations.map((c, idx) => {
        if (!c || typeof c !== "object" || Array.isArray(c)) {
            throw new TypeError(`citations[${idx}] must be an object`);
        }

        return {
            documentId: c.documentId !== undefined && c.documentId !== null ? String(c.documentId).trim() : null,
            filename: c.filename !== undefined && c.filename !== null ? String(c.filename).trim() : null,
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
        },
        recommendation: recommendation.trim(),
        citations: sanitizedCitations,
    };
}

/**
 * Generates an Approval Note DOCX from trusted PR #13, #14, and #15 outputs.
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

    // 2. Resolve output path
    const outputPath = options.outputPath
        ? path.resolve(options.outputPath)
        : path.resolve(process.cwd(), "Approval_Note.docx");

    // 3. Ensure parent directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const pythonBin = options.pythonPath || process.env.PYTHON_PATH || "python3";

    return new Promise((resolve, reject) => {
        const child = spawn(pythonBin, [PYTHON_SCRIPT_PATH, "--output", outputPath]);

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (err) => {
            reject(new Error(`Failed to spawn Python process: ${err.message}`, { cause: err }));
        });

        child.on("close", (code) => {
            if (code !== 0) {
                return reject(
                    new Error(
                        `Python DOCX generator exited with code ${code}: ${stderr || stdout}`
                    )
                );
            }

            const returnedPath = stdout.trim() || outputPath;
            resolve(returnedPath);
        });

        // Pipe sanitized JSON payload to Python script
        child.stdin.write(JSON.stringify(validatedData));
        child.stdin.end();
    });
}
