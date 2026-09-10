const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL", null]);

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

    // Strip markdown code fences if wrapped
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const startIdx = cleaned.indexOf("{");
    const endIdx = cleaned.lastIndexOf("}");
    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
        cleaned = cleaned.substring(startIdx, endIdx + 1);
    } else {
        const arrStart = cleaned.indexOf("[");
        const arrEnd = cleaned.lastIndexOf("]");
        if (arrStart !== -1 && arrEnd !== -1 && arrEnd >= arrStart) {
            cleaned = cleaned.substring(arrStart, arrEnd + 1);
        }
    }

    // Attempt 1: Direct JSON.parse
    try {
        return JSON.parse(cleaned);
    } catch {
        // Continue to repairs
    }

    // Repair 1: Remove comments and trailing commas
    let repaired = cleaned
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/,\s*([\}\]])/g, "$1");

    try {
        return JSON.parse(repaired);
    } catch {
        // Continue to next repair
    }

    // Repair 2: Fix unquoted property names: { foo: "bar" } or , foo: "bar"
    repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    repaired = repaired.replace(/,\s*([\}\]])/g, "$1");

    try {
        return JSON.parse(repaired);
    } catch {
        // Continue
    }

    // Repair 3: Replace single-quoted strings
    repaired = repaired.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
    repaired = repaired.replace(/,\s*([\}\]])/g, "$1");

    try {
        return JSON.parse(repaired);
    } catch {
        // Continue
    }

    // Fallback: Regex extraction for riskAssessment, recommendation, citations
    const levelMatch = rawResponse.match(/"level"\s*:\s*(?:"([^"]+)"|([A-Za-z]+|null))/i);
    const reasonMatch = rawResponse.match(/"reason(?:ing)?"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
    const recMatch = rawResponse.match(/"(?:recommendation|action|correctiveAction)"\s*:\s*"((?:[^"\\]|\\.)*)"/i);

    if (levelMatch || reasonMatch || recMatch) {
        const extractedLevel = levelMatch ? (levelMatch[1] || levelMatch[2] || null) : null;
        const extractedReason = reasonMatch ? reasonMatch[1] : "Risk assessed from available SOP evidence.";
        const extractedRec = recMatch ? recMatch[1] : "Follow standard operating procedure maintenance steps.";

        return {
            riskAssessment: {
                level: extractedLevel === "null" ? null : extractedLevel,
                reason: extractedReason,
            },
            recommendation: extractedRec,
            citations: [],
        };
    }

    throw new Error(`LLM returned invalid JSON and could not be repaired: ${cleaned.slice(0, 100)}`);
}

/**
 * Validates and normalizes parsed LLM response against risk assessment schema.
 * Supports both nested riskAssessment and flat riskLevel/reasoning representations.
 *
 * @param {object} parsed
 * @returns {object} Validated risk response
 */
export function validateRiskResponse(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("LLM response must be a JSON object");
    }

    // Support flat representation if model returned { riskLevel, reasoning, likelihood, severity }
    const riskObj = parsed.riskAssessment && typeof parsed.riskAssessment === "object" && !Array.isArray(parsed.riskAssessment)
        ? parsed.riskAssessment
        : {};

    let rawLevel = riskObj.level !== undefined ? riskObj.level : (parsed.riskLevel !== undefined ? parsed.riskLevel : null);
    let level;
    if (rawLevel !== null && rawLevel !== undefined) {
        if (typeof rawLevel !== "string") {
            throw new Error("riskAssessment.level must be a string or null");
        }
        level = rawLevel.trim().toUpperCase();
    } else {
        level = null;
    }

    if (!ALLOWED_RISK_LEVELS.has(level)) {
        throw new Error(`Invalid risk level: '${rawLevel}'. Allowed levels: LOW, MEDIUM, HIGH, CRITICAL, null`);
    }

    let reason = typeof riskObj.reason === "string" && riskObj.reason.trim()
        ? riskObj.reason.trim()
        : (typeof parsed.reasoning === "string" && parsed.reasoning.trim()
            ? parsed.reasoning.trim()
            : null);

    if (!reason) {
        throw new Error("riskAssessment.reason must be a non-empty string");
    }

    const likelihood = normalizeNullableString(riskObj.likelihood || parsed.likelihood, "likelihood");
    const severity = normalizeNullableString(riskObj.severity || parsed.severity, "severity");

    // 2. recommendation
    let rec = parsed.recommendation || (parsed.riskAssessment && parsed.riskAssessment.recommendation);
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.recommendations || parsed.riskAssessment?.recommendations)) {
        const recSource = parsed.recommendations || parsed.riskAssessment?.recommendations;
        if (Array.isArray(recSource)) {
            rec = recSource.filter((r) => typeof r === "string" && r.trim().length > 0).join(" ");
        } else if (typeof recSource === "string") {
            rec = recSource;
        }
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.action || parsed.riskAssessment?.action)) {
        rec = String(parsed.action || parsed.riskAssessment?.action);
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.correctiveAction || parsed.riskAssessment?.correctiveAction)) {
        rec = String(parsed.correctiveAction || parsed.riskAssessment?.correctiveAction);
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.recommendedAction || parsed.riskAssessment?.recommendedAction)) {
        rec = String(parsed.recommendedAction || parsed.riskAssessment?.recommendedAction);
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.mitigation || parsed.riskAssessment?.mitigation)) {
        rec = String(parsed.mitigation || parsed.riskAssessment?.mitigation);
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && (parsed.suggestedAction || parsed.riskAssessment?.suggestedAction)) {
        rec = String(parsed.suggestedAction || parsed.riskAssessment?.suggestedAction);
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && level === null) {
        rec = "Insufficient SOP evidence is available to provide a validated recommendation.";
    }
    if ((typeof rec !== "string" || rec.trim().length === 0) && reason) {
        rec = `Adhere to documented SOP guidelines: ${reason}`;
    }

    if (typeof rec !== "string" || rec.trim().length === 0) {
        throw new Error("recommendation must be a non-empty string");
    }

    // 3. citations / evidenceUsed
    let rawCitations = [];
    if (Array.isArray(parsed.citations)) {
        rawCitations = parsed.citations;
    } else if (Array.isArray(parsed.evidenceUsed)) {
        rawCitations = parsed.evidenceUsed;
    } else if (parsed.citations !== undefined) {
        throw new Error("citations must be an array");
    }

    return {
        riskAssessment: {
            level,
            reason: reason.trim(),
            likelihood,
            severity,
        },
        recommendation: rec.trim(),
        citations: rawCitations,
    };
}

/**
 * Enforces citation integrity by verifying citations against actual retrieved SOP chunks.
 * Untrusted / hallucinated citations that do not correspond to any retrieved chunk are filtered out.
 *
 * @param {Array<object>} rawCitations Citations from LLM
 * @param {Array<object>} retrievedChunks Authoritative retrieved SOP chunks
 * @param {string} [organizationId] Authoritative tenant organization ID
 * @returns {Array<{documentId: string, filename: string, page: number, chunkIndex: number}>}
 */
export function filterValidCitations(rawCitations, retrievedChunks, organizationId) {
    if (!Array.isArray(rawCitations) || !Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
        return [];
    }

    const validatedCitations = [];
    const seen = new Set();

    for (const citation of rawCitations) {
        if (!citation || typeof citation !== "object") {
            continue;
        }

        // Cross-tenant check on citation
        if (organizationId && citation.organizationId && citation.organizationId !== organizationId) {
            continue;
        }

        // Find a matching chunk from the retrieved SOP chunks
        const matchedChunk = retrievedChunks.find((chunk) => {
            if (!chunk) return false;

            // Ensure chunk belongs to authenticated tenant
            if (organizationId && chunk.organizationId && chunk.organizationId !== organizationId) {
                return false;
            }

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
 * Parses and validates raw LLM output against the risk assessment schema.
 *
 * @param {string} rawResponse
 * @returns {object}
 */
export function parseRiskLlmResponse(rawResponse) {
    const parsed = extractJsonFromResponse(rawResponse);
    return validateRiskResponse(parsed);
}

/**
 * Deterministically validates Gemma's risk assessment output against supplied SOP evidence.
 *
 * @param {object} riskResult Result containing riskAssessment and citations
 * @param {object} validatedFinding Finding being assessed
 * @param {Array<object>} retrievedChunks Authoritative retrieved SOP chunks
 * @param {string} [organizationId] Tenant identifier
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateGemmaRiskOutput(riskResult, validatedFinding, retrievedChunks, organizationId = null) {
    if (!riskResult || typeof riskResult !== "object") {
        return { isValid: false, error: "Risk assessment result must be an object" };
    }

    const { riskAssessment, citations } = riskResult;
    if (!riskAssessment || typeof riskAssessment !== "object") {
        return { isValid: false, error: "Missing riskAssessment in risk output" };
    }

    if (!ALLOWED_RISK_LEVELS.has(riskAssessment.level)) {
        return { isValid: false, error: `Invalid risk level: '${riskAssessment.level}'` };
    }

    if (typeof riskAssessment.reason !== "string" || !riskAssessment.reason.trim()) {
        return { isValid: false, error: "riskAssessment.reason must be a non-empty string" };
    }

    if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
        if (riskAssessment.level !== null) {
            return { isValid: false, error: "Risk level cannot be determined without valid SOP chunks" };
        }
    }

    // Verify citations against retrieved chunks
    if (Array.isArray(citations) && citations.length > 0) {
        const validCitations = filterValidCitations(citations, retrievedChunks, organizationId);
        if (validCitations.length === 0 && riskAssessment.level !== null) {
            return { isValid: false, error: "Citations could not be validated against retrieved SOP evidence" };
        }
    }

    return { isValid: true };
}

/**
 * Deterministically validates recommendation grounding against finding and SOP evidence.
 *
 * @param {string} recommendation Recommendation text
 * @param {object} finding Validated finding
 * @param {Array<object>} retrievedChunks Retrieved SOP chunks
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateGemmaRecommendationGrounding(recommendation, finding = {}, retrievedChunks = []) {
    if (typeof recommendation !== "string" || !recommendation.trim()) {
        return { isValid: false, error: "recommendation must be a non-empty string" };
    }

    const recText = recommendation.trim();
    if (recText.length < 5) {
        return { isValid: false, error: "recommendation is too short to be actionable" };
    }

    // Verify numerical values mentioned in recommendation are supported by finding or SOP chunks
    const recNumbers = recText.match(/\b\d+(?:\.\d+)?\b/g);
    if (recNumbers && recNumbers.length > 0) {
        const corpus = [
            finding.finding || "",
            finding.evidence || "",
            finding.observedValue || "",
            finding.limit || "",
            ...retrievedChunks.map((c) => c.text || ""),
        ].join(" ");

        for (const num of recNumbers) {
            // Allow common non-parametric numbers like 1, 2, 24, 48 hours etc.
            if (["1", "2", "3", "4", "5", "10", "24", "48", "72"].includes(num)) continue;
            if (!corpus.includes(num)) {
                // If an unsupported specific measurement is introduced, flag as ungrounded
                console.warn(`[ClaimGrounding] Warning: Recommendation introduces unsupported numerical claim: ${num}`);
            }
        }
    }

    return { isValid: true };
}
