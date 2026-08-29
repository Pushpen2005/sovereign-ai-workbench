/**
 * Builds an effective search query for SOP retrieval from an inspection finding.
 *
 * @param {object} finding
 * @returns {string}
 */
export function buildSopQuery(finding) {
    if (!finding || typeof finding !== "object") {
        throw new TypeError("finding must be an object");
    }

    const terms = [];

    const equipment = typeof finding.equipment === "string" ? finding.equipment.trim() : "";
    const findingText = typeof finding.finding === "string" ? finding.finding.trim() : "";
    const observedValue = typeof finding.observedValue === "string" ? finding.observedValue.trim() : "";
    const limit = typeof finding.limit === "string" ? finding.limit.trim() : "";

    if (equipment) {
        terms.push(equipment);
    }

    if (findingText) {
        // If the finding already starts with the equipment name, avoid duplicate leading prefix
        if (equipment && findingText.toLowerCase().startsWith(equipment.toLowerCase())) {
            terms[0] = findingText;
        } else {
            terms.push(findingText);
        }
    }

    if (observedValue) {
        terms.push(observedValue);
    }

    if (limit) {
        terms.push(limit);
    }

    const query = terms.join(" ").trim();

    if (!query) {
        throw new Error("Unable to build SOP query from finding: missing search terms");
    }

    return query;
}

/**
 * Formats PR #13 finding context for the prompt.
 *
 * @param {object} finding
 * @returns {string}
 */
export function formatFindingContext(finding) {
    return [
        `finding: ${finding.finding ?? "N/A"}`,
        `equipment: ${finding.equipment ?? "N/A"}`,
        `observedValue: ${finding.observedValue ?? "N/A"}`,
        `limit: ${finding.limit ?? "N/A"}`,
        `severity: ${finding.severity ?? "N/A"}`,
        `evidence: ${finding.evidence ?? "N/A"}`,
        `source: ${JSON.stringify(finding.source ?? null)}`,
    ].join("\n");
}

/**
 * Formats retrieved SOP chunks for the prompt.
 *
 * @param {Array<object>} chunks
 * @returns {string}
 */
export function formatSopChunksContext(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        return "No SOP evidence retrieved.";
    }

    return chunks
        .map((chunk, index) => {
            return [
                `--- SOP SOURCE ${index + 1} ---`,
                `documentId: ${chunk.documentId ?? "null"}`,
                `filename: ${chunk.filename ?? "null"}`,
                `page: ${chunk.page ?? "null"}`,
                `chunkIndex: ${chunk.chunkIndex ?? "null"}`,
                "text:",
                chunk.text ?? "",
            ].join("\n");
        })
        .join("\n\n");
}

/**
 * Constructs the LLM prompt for risk assessment and recommendation.
 *
 * @param {object} finding Validated finding from PR #13
 * @param {Array<object>} sopChunks Retrieved SOP evidence from PR #14
 * @returns {string}
 */
export function buildRiskPrompt(finding, sopChunks = []) {
    if (!finding || typeof finding !== "object") {
        throw new TypeError("finding must be an object");
    }

    if (!Array.isArray(sopChunks)) {
        throw new TypeError("sopChunks must be an array");
    }

    const findingContext = formatFindingContext(finding);
    const sopContext = formatSopChunksContext(sopChunks);

    return `SYSTEM:
You are an industrial safety and reliability engineer specializing in risk assessment and maintenance recommendations.

Your task is to analyze an OBSERVED FINDING against authoritative SOP EVIDENCE to determine the risk level and provide actionable recommendations.

CRITICAL RULES:
1. The OBSERVED FINDING represents the field inspection result.
2. The SOP EVIDENCE is the authoritative reference standard and procedure.
3. Determine risk by reasoning from the observed finding, observed values, documented limits, and SOP evidence.
4. Do NOT blindly copy the inspection finding severity into the risk level. Evaluate the evidence critically.
5. Allowed risk levels are strictly: "LOW", "MEDIUM", "HIGH", or null.
6. Do NOT invent facts, operating limits, procedures, or citations.
7. If the SOP evidence does not contain sufficient information to determine a risk level or provide a validated recommendation, set "level": null and explain the lack of evidence in "reason".
8. In "citations", only cite sources that appear directly in SOP EVIDENCE. Each citation must strictly copy documentId, filename, page, and chunkIndex from the SOP SOURCE. Do not fabricate citations.
9. Return ONLY a valid JSON object matching the schema below. Do not wrap in markdown or include additional explanation.

SCHEMA:
{
  "riskAssessment": {
    "level": "LOW" | "MEDIUM" | "HIGH" | null,
    "reason": "string"
  },
  "recommendation": "string",
  "citations": [
    {
      "documentId": "string",
      "filename": "string",
      "page": number,
      "chunkIndex": number
    }
  ]
}

OBSERVED FINDING:
${findingContext}

SOP EVIDENCE:
${sopContext}`;
}
