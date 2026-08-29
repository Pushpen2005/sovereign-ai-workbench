const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", null]);

export const INSUFFICIENT_EVIDENCE_RESULT = Object.freeze({
    riskAssessment: Object.freeze({
        level: null,
        reason: "Insufficient evidence to determine risk level.",
    }),
    recommendation: "Insufficient SOP evidence is available to provide a validated recommendation.",
    citations: Object.freeze([]),
});

function normalizeNullableString(value, fieldName) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a string or null`);
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredString(value, fieldName) {
    if (typeof value !== "string") {
        throw new TypeError(`${fieldName} must be a non-empty string`);
    }

    const normalized = value.trim();
    if (!normalized) {
        throw new TypeError(`${fieldName} must be a non-empty string`);
    }

    return normalized;
}

/**
 * Validates PR #13 finding contract.
 *
 * @param {object} finding
 * @returns {object} Normalized finding
 */
export function validateFindingInput(finding) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        throw new TypeError("Finding input must be an object");
    }

    const findingText = normalizeRequiredString(finding.finding, "finding");
    const evidenceText = normalizeRequiredString(finding.evidence, "evidence");

    return {
        finding: findingText,
        equipment: normalizeNullableString(finding.equipment, "equipment"),
        observedValue: normalizeNullableString(finding.observedValue, "observedValue"),
        limit: normalizeNullableString(finding.limit, "limit"),
        severity: normalizeNullableString(finding.severity, "severity"),
        evidence: evidenceText,
        source: finding.source ?? null,
    };
}

/**
 * Extracts JSON from raw text, stripping markdown code block fences if present.
 *
 * @param {string} rawResponse
 * @returns {any}
 */
export function extractJsonFromResponse(rawResponse) {
    if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
        throw new Error("LLM response must be a non-empty string");
    }

    let cleaned = rawResponse.trim();

    // Strip markdown code fences like ```json ... ``` or ``` ... ```
    const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    } else {
        // Handle cases where markdown fence starts but may have trailing text or incomplete fence
        const fenceStartIndex = cleaned.indexOf("```");
        if (fenceStartIndex !== -1) {
            const firstNewline = cleaned.indexOf("\n", fenceStartIndex);
            const contentStart = firstNewline !== -1 ? firstNewline + 1 : fenceStartIndex + 3;
            const fenceEndIndex = cleaned.lastIndexOf("```");
            if (fenceEndIndex > contentStart) {
                cleaned = cleaned.substring(contentStart, fenceEndIndex).trim();
            }
        }
    }

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        throw new Error(`LLM returned invalid JSON: ${error.message}`);
    }
}

/**
 * Validates and normalizes parsed LLM response against PR #15 schema.
 *
 * @param {object} parsed
 * @returns {object} Validated risk response
 */
export function validateRiskResponse(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("LLM response must be a JSON object");
    }

    // 1. riskAssessment
    if (!parsed.riskAssessment || typeof parsed.riskAssessment !== "object" || Array.isArray(parsed.riskAssessment)) {
        throw new Error("LLM response must contain a riskAssessment object");
    }

    let { level, reason } = parsed.riskAssessment;

    if (level !== null && level !== undefined) {
        if (typeof level !== "string") {
            throw new Error("riskAssessment.level must be a string or null");
        }
        level = level.trim().toUpperCase();
    } else {
        level = null;
    }

    if (!ALLOWED_RISK_LEVELS.has(level)) {
        throw new Error(`Invalid risk level: '${parsed.riskAssessment.level}'. Allowed levels: LOW, MEDIUM, HIGH, null`);
    }

    if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new Error("riskAssessment.reason must be a non-empty string");
    }

    // 2. recommendation
    if (typeof parsed.recommendation !== "string" || parsed.recommendation.trim().length === 0) {
        throw new Error("recommendation must be a non-empty string");
    }

    // 3. citations
    if (parsed.citations !== undefined && !Array.isArray(parsed.citations)) {
        throw new Error("citations must be an array");
    }

    const rawCitations = Array.isArray(parsed.citations) ? parsed.citations : [];

    return {
        riskAssessment: {
            level,
            reason: reason.trim(),
        },
        recommendation: parsed.recommendation.trim(),
        citations: rawCitations,
    };
}

/**
 * Enforces citation integrity by verifying citations against actual retrieved SOP chunks.
 * Untrusted / hallucinated citations that do not correspond to any retrieved chunk are filtered out.
 *
 * @param {Array<object>} rawCitations Citations from LLM
 * @param {Array<object>} retrievedChunks Authoritative retrieved SOP chunks
 * @returns {Array<{documentId: string, filename: string, page: number, chunkIndex: number}>}
 */
export function filterValidCitations(rawCitations, retrievedChunks) {
    if (!Array.isArray(rawCitations) || !Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
        return [];
    }

    const validatedCitations = [];
    const seen = new Set();

    for (const citation of rawCitations) {
        if (!citation || typeof citation !== "object") {
            continue;
        }

        // Find a matching chunk from the retrieved SOP chunks
        const matchedChunk = retrievedChunks.find((chunk) => {
            if (!chunk) return false;

            // Match by documentId or filename
            const matchesDoc =
                (citation.documentId && chunk.documentId && String(citation.documentId).trim() === String(chunk.documentId).trim()) ||
                (citation.filename && chunk.filename && String(citation.filename).trim().toLowerCase() === String(chunk.filename).trim().toLowerCase());

            if (!matchesDoc) {
                return false;
            }

            // If chunkIndex is provided, it must match
            if (citation.chunkIndex !== undefined && citation.chunkIndex !== null) {
                if (Number(citation.chunkIndex) !== Number(chunk.chunkIndex)) {
                    return false;
                }
            }

            // If page is provided, it must match
            if (citation.page !== undefined && citation.page !== null) {
                if (Number(citation.page) !== Number(chunk.page)) {
                    return false;
                }
            }

            return true;
        });

        if (matchedChunk) {
            const documentId = matchedChunk.documentId ?? (citation.documentId ? String(citation.documentId) : null);
            const filename = matchedChunk.filename ?? (citation.filename ? String(citation.filename) : null);
            const page = matchedChunk.page ?? (citation.page !== undefined ? Number(citation.page) : null);
            const chunkIndex = matchedChunk.chunkIndex ?? (citation.chunkIndex !== undefined ? Number(citation.chunkIndex) : null);

            const dedupeKey = `${documentId}:${filename}:${page}:${chunkIndex}`;
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                validatedCitations.push({
                    documentId,
                    filename,
                    page,
                    chunkIndex,
                });
            }
        }
    }

    return validatedCitations;
}

/**
 * Parses and validates raw LLM output against the PR #15 schema.
 *
 * @param {string} rawResponse
 * @returns {object}
 */
export function parseRiskLlmResponse(rawResponse) {
    const parsed = extractJsonFromResponse(rawResponse);
    return validateRiskResponse(parsed);
}
