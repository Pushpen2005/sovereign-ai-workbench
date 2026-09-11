/**
 * CSV Validation and Parsing Service
 *
 * Provides safe in-memory validation and metadata extraction for CSV uploads:
 *   - File size limits (max 5 MB)
 *   - File extension verification (.csv)
 *   - Path traversal prevention
 *   - Non-empty structure verification (header row with column names)
 *   - Column and sample row extraction for prompt context
 *
 * Untrusted user input is strictly validated before container injection.
 */

export const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export class CsvValidationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "CsvValidationError";
        this.stage = "csv_validation";
        this.details = details;
    }
}

/**
 * Parses a single line of CSV respecting double-quoted values.
 *
 * @param {string} rowStr
 * @returns {string[]}
 */
export function parseCsvLine(rowStr) {
    if (typeof rowStr !== "string") return [];
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < rowStr.length; i++) {
        const char = rowStr[i];
        if (char === '"') {
            if (inQuotes && rowStr[i + 1] === '"') {
                current += '"';
                i++; // Skip escaped quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            values.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    return values;
}

/**
 * Validates untrusted CSV input and extracts structure metadata.
 *
 * @param {object} params
 * @param {string|Buffer} params.content - Raw CSV content or Buffer
 * @param {string} [params.filename="data.csv"] - Original filename
 * @returns {{ valid: boolean, filename: string, internalPath: string, content: string, columns: string[], rowCount: number, samplePreview: string }}
 */
export function validateAndParseCsv({ content, filename = "data.csv" }) {
    if (!content || (typeof content !== "string" && !Buffer.isBuffer(content))) {
        throw new CsvValidationError("CSV content cannot be empty.");
    }

    const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
    const trimmed = text.trim();

    if (!trimmed) {
        throw new CsvValidationError("CSV file is empty.");
    }

    const byteLength = Buffer.byteLength(trimmed, "utf8");
    if (byteLength > MAX_CSV_SIZE_BYTES) {
        throw new CsvValidationError(
            `CSV file size (${byteLength} bytes) exceeds limit of ${MAX_CSV_SIZE_BYTES} bytes.`
        );
    }

    // Path traversal defense
    const rawFilename = String(filename || "data.csv").trim();
    if (
        rawFilename.includes("..") ||
        rawFilename.includes("/") ||
        rawFilename.includes("\\") ||
        rawFilename.startsWith("~")
    ) {
        throw new CsvValidationError(
            "Invalid filename: Path traversal attempts are strictly forbidden."
        );
    }

    // Extension verification
    const extIndex = rawFilename.lastIndexOf(".");
    const ext = extIndex !== -1 ? rawFilename.slice(extIndex).toLowerCase() : "";
    if (ext !== ".csv") {
        throw new CsvValidationError(
            "Invalid file extension. Only .csv files are supported."
        );
    }

    // Sanitize display filename (replace unsafe chars)
    const sanitizedFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, "_");

    // Line splitting and structure check
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 1) {
        throw new CsvValidationError("CSV file must contain at least a header row.");
    }

    const headerLine = lines[0];
    const columns = parseCsvLine(headerLine);

    if (columns.length === 0 || columns.every((c) => !c)) {
        throw new CsvValidationError("Malformed CSV: Header row contains no valid columns.");
    }

    // Row count excludes header
    const rowCount = Math.max(0, lines.length - 1);

    // Provide safe 3-row sample preview for LLM prompt context
    const samplePreview = lines.slice(0, 4).join("\n");

    return {
        valid: true,
        filename: sanitizedFilename,
        internalPath: "/workspace/input/data.csv",
        content: trimmed,
        columns,
        rowCount,
        samplePreview,
    };
}
