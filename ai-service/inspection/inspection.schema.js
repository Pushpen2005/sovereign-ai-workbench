function normalizeNullableString(value, fieldName) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== "string") {
        throw new Error(`${fieldName} must be a string or null`);
    }

    const normalized = value.trim();

    return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredString(value, fieldName) {
    if (typeof value !== "string") {
        throw new Error(`${fieldName} must be a non-empty string`);
    }

    const normalized = value.trim();

    if (!normalized) {
        throw new Error(`${fieldName} must be a non-empty string`);
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
        throw new Error("LLM response must be a non-empty string");
    }

    let parsed;

    try {
        parsed = JSON.parse(rawResponse.trim());
    } catch (error) {
        throw new Error(`LLM returned invalid JSON: ${error.message}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("LLM response must be a JSON object");
    }

    if (!Array.isArray(parsed.findings)) {
        throw new Error("LLM response must contain a findings array");
    }

    const findings = parsed.findings.map((finding, index) => {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            throw new Error(`Finding at index ${index} must be an object`);
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

    const matchingSources = chunks
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