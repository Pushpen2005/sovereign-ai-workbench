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

    // Strip markdown code fences if present (e.g. ```json ... ```)
    const codeBlockMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    let parsed;

    try {
        parsed = JSON.parse(cleaned);
    } catch (error) {
        throw new InspectionValidationError(`LLM returned invalid JSON: ${error.message}`);
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

function findEvidenceSources(evidence, chunks) {
    const normalizedEvidence = normalizeText(evidence);

    let matchingSources = chunks
        .filter((chunk) => typeof chunk.text === "string" && chunk.text.trim().length > 0)
        .filter((chunk) => {
            const normalizedChunk = normalizeText(chunk.text);

            return (
                normalizedChunk.includes(normalizedEvidence) ||
                normalizedEvidence.includes(normalizedChunk)
            );
        })
        .map((chunk) => ({
            documentId: chunk.documentId,
            page: chunk.page,
            chunkIndex: chunk.chunkIndex,
            score: chunk.score,
        }))
        .sort((a, b) => b.score - a.score);

    // Fallback: If no direct substring match, check if evidence explicitly references "SOURCE X"
    if (matchingSources.length === 0) {
        const sourceMatch = evidence.match(/SOURCE\s*(\d+)/i);
        if (sourceMatch) {
            const sourceIndex = parseInt(sourceMatch[1], 10) - 1;
            if (sourceIndex >= 0 && sourceIndex < chunks.length) {
                const targetChunk = chunks[sourceIndex];
                if (targetChunk && typeof targetChunk.text === "string") {
                    matchingSources.push({
                        documentId: targetChunk.documentId,
                        page: targetChunk.page,
                        chunkIndex: targetChunk.chunkIndex,
                        score: targetChunk.score,
                    });
                }
            }
        }
    }

    // Fallback: Check if evidence has >= 70% word overlap with a candidate chunk
    if (matchingSources.length === 0 && normalizedEvidence.length > 20) {
        const words = normalizedEvidence.split(/\s+/).filter((w) => w.length > 3);
        if (words.length >= 3) {
            for (const chunk of chunks) {
                const normalizedChunk = normalizeText(chunk.text || "");
                const matchedWords = words.filter((w) => normalizedChunk.includes(w));
                if (matchedWords.length / words.length >= 0.7) {
                    matchingSources.push({
                        documentId: chunk.documentId,
                        page: chunk.page,
                        chunkIndex: chunk.chunkIndex,
                        score: chunk.score,
                    });
                    break;
                }
            }
        }
    }

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