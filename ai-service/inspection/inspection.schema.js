export class InspectionValidationError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "InspectionValidationError";
    }
}

function normalizeNullableString(value, fieldName) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== "string") {
        throw new InspectionValidationError(`${fieldName} must be a string or null`);
    }

    const normalized = value.trim();

    if (
        normalized.toLowerCase() === "null" ||
        normalized.toLowerCase() === "n/a" ||
        normalized.toLowerCase() === "none"
    ) {
        return null;
    }

    return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredString(value, fieldName) {
    if (typeof value !== "string") {
        throw new InspectionValidationError(`${fieldName} must be a non-empty string`);
    }

    const normalized = value.trim();

    if (!normalized) {
        throw new InspectionValidationError(`${fieldName} must be a non-empty string`);
    }

    return normalized;
}

function normalizeText(value) {
    return String(value)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function dedupeSources(sources) {
    const seen = new Set();

    return sources.filter((source) => {
        const key = `${source.documentId}:${source.page}:${source.chunkIndex}`;

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

export function parseInspectionLlmResponse(rawResponse) {
    if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
        throw new InspectionValidationError("LLM response must be a non-empty string");
    }

    let cleaned = rawResponse.trim();

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

    let parsed;

    try {
        parsed = JSON.parse(cleaned);
    } catch (error) {
        try {
            const repaired = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
            parsed = JSON.parse(repaired);
        } catch {
            throw new InspectionValidationError(`LLM returned invalid JSON: ${error.message}`);
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new InspectionValidationError("LLM response must be a JSON object");
    }

    if (!Array.isArray(parsed.findings)) {
        throw new InspectionValidationError("LLM response must contain a findings array");
    }

    const findings = parsed.findings.map((finding, index) => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            throw new InspectionValidationError(`Finding at index ${index} must be an object`);
        }

        return {
            finding: normalizeRequiredString(finding.finding, `findings[${index}].finding`),
            equipment: normalizeNullableString(finding.equipment, `findings[${index}].equipment`),
            observedValue: normalizeNullableString(finding.observedValue, `findings[${index}].observedValue`),
            limit: normalizeNullableString(finding.limit, `findings[${index}].limit`),
            severity: normalizeNullableString(finding.severity, `findings[${index}].severity`),
            evidence: normalizeRequiredString(finding.evidence, `findings[${index}].evidence`),
        };
    });

    return {
        findings,
    };
}

function stripPunctuation(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"?]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractKeyNumbers(text) {
    const matches = String(text || "").match(/\b\d+(?:\.\d+)?\b/g);
    return matches ? new Set(matches) : new Set();
}

function findEvidenceSources(evidence, chunks) {
    if (!evidence || typeof evidence !== "string" || !Array.isArray(chunks) || chunks.length === 0) {
        return [];
    }

    const cleanEvidence = evidence.trim();
    const normalizedEvidence = normalizeText(cleanEvidence);
    const strippedEvidence = stripPunctuation(cleanEvidence);
    const evidenceNumbers = extractKeyNumbers(cleanEvidence);

    // ─── TIER 1: Exact Substring Match ─────────────────────────────────────────
    let matchedChunks = chunks.filter(
        (chunk) => typeof chunk.text === "string" && chunk.text.includes(cleanEvidence)
    );

    // ─── TIER 2: Normalized Exact Match (ignoring punctuation and casing) ───────
    if (matchedChunks.length === 0 && strippedEvidence.length > 5) {
        matchedChunks = chunks.filter((chunk) => {
            if (typeof chunk.text !== "string") return false;
            const strippedChunk = stripPunctuation(chunk.text);
            return (
                strippedChunk.includes(strippedEvidence) ||
                (strippedEvidence.length > 30 && strippedEvidence.includes(strippedChunk))
            );
        });
    }

    // ─── TIER 3: Explicit Source Tag Match ("SOURCE 1", "SOURCE 2") ───────────
    if (matchedChunks.length === 0) {
        const sourceMatch = cleanEvidence.match(/SOURCE\s*(\d+)/i);
        if (sourceMatch) {
            const sourceIndex = parseInt(sourceMatch[1], 10) - 1;
            if (sourceIndex >= 0 && sourceIndex < chunks.length) {
                const targetChunk = chunks[sourceIndex];
                if (targetChunk && typeof targetChunk.text === "string") {
                    matchedChunks = [targetChunk];
                }
            }
        }
    }

    // ─── TIER 4: Normalized Word Overlap with Strict Numeric Gate ─────────────
    if (matchedChunks.length === 0 && strippedEvidence.length >= 15) {
        const words = strippedEvidence.split(/\s+/).filter((w) => w.length >= 3);
        if (words.length >= 3) {
            const candidates = [];
            for (const chunk of chunks) {
                if (typeof chunk.text !== "string") continue;
                const strippedChunk = stripPunctuation(chunk.text);
                const matchedWordCount = words.filter((w) => strippedChunk.includes(w)).length;
                const overlapRatio = matchedWordCount / words.length;

                // If evidence contains measurements/numbers, chunk MUST contain those numbers
                let numbersSatisfied = true;
                if (evidenceNumbers.size > 0) {
                    const chunkNumbers = extractKeyNumbers(chunk.text);
                    for (const num of evidenceNumbers) {
                        if (!chunkNumbers.has(num)) {
                            numbersSatisfied = false;
                            break;
                        }
                    }
                }

                if (overlapRatio >= 0.65 && numbersSatisfied) {
                    candidates.push({ chunk, overlapRatio });
                }
            }

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.overlapRatio - a.overlapRatio);
                matchedChunks = candidates.map((c) => c.chunk);
            }
        }
    }

    const matchingSources = matchedChunks.map((chunk) => ({
        documentId: chunk.documentId,
        filename: chunk.filename,
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
    })).sort((a, b) => (b.score || 0) - (a.score || 0));

    return dedupeSources(matchingSources);
}

export function attachSourcesToFindings(findings, chunks) {
    if (!Array.isArray(findings)) {
        throw new TypeError("findings must be an array");
    }

    if (!Array.isArray(chunks)) {
        throw new TypeError("chunks must be an array");
    }

    return findings.reduce((accumulator, finding) => {
        const sources = findEvidenceSources(finding.evidence, chunks);

        if (sources.length === 0) {
            return accumulator;
        }

        accumulator.push({
            finding: finding.finding,
            equipment: finding.equipment,
            observedValue: finding.observedValue,
            limit: finding.limit,
            severity: finding.severity,
            evidence: finding.evidence,
            source: sources.length === 1 ? sources[0] : sources,
        });

        return accumulator;
    }, []);
}