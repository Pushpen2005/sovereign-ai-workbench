import { searchSop } from "../knowledge/sop.service.js";
import { generateAnswer } from "../llm/llm.service.js";
import { buildRiskPrompt, buildSopQuery } from "./risk.prompt.js";
import {
    filterValidCitations,
    INSUFFICIENT_EVIDENCE_RESULT,
    parseRiskLlmResponse,
    validateFindingInput,
} from "./risk.schema.js";

/**
 * Assesses risk and produces actionable recommendations for an inspection finding
 * by retrieving authoritative SOP evidence and evaluating them via local LLM.
 *
 * @param {object} finding Validated finding from PR #13
 * @param {object} [options]
 * @param {Function} [options.searchSop] Overridable SOP retrieval function
 * @param {Function} [options.generateAnswer] Overridable LLM generation function
 * @param {string} [options.model] Optional model name override
 * @param {object} [options.sopOptions] Optional retrieval options (limit, scoreThreshold)
 * @returns {Promise<{
 *   riskAssessment: { level: "LOW" | "MEDIUM" | "HIGH" | null, reason: string },
 *   recommendation: string,
 *   citations: Array<{ documentId: string, filename: string, page: number, chunkIndex: number }>
 * }>}
 */
export async function assessFindingRisk(finding, options = {}) {
    // 1. Validate PR #13 finding contract
    const validatedFinding = validateFindingInput(finding);

    // 2. Build SOP search query
    const sopQuery = buildSopQuery(validatedFinding);

    // 3. Retrieve SOP evidence
    const searchSopFn = options.searchSop ?? searchSop;
    const sopOptions = options.sopOptions ?? {};

    const retrievedChunks = await searchSopFn(sopQuery, sopOptions);

    // 4. Handle zero retrieved SOP evidence safely without LLM hallucination
    if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) {
        return {
            riskAssessment: {
                level: null,
                reason: "Insufficient evidence to determine risk level.",
            },
            recommendation: "Insufficient SOP evidence is available to provide a validated recommendation.",
            citations: [],
        };
    }

    // 5. Build risk analysis prompt
    const prompt = buildRiskPrompt(validatedFinding, retrievedChunks);

    // 6. Invoke LLM (Ollama)
    const generateAnswerFn = options.generateAnswer ?? generateAnswer;
    const rawResponse = await generateAnswerFn(prompt, options.model);

    // 7. Parse & validate JSON response against PR #15 schema
    const parsedResponse = parseRiskLlmResponse(rawResponse);

    // 8. Enforce citation integrity (reject hallucinated citations, keep valid ones)
    const validatedCitations = filterValidCitations(
        parsedResponse.citations,
        retrievedChunks
    );

    // 9. Return trusted structured result
    return {
        riskAssessment: parsedResponse.riskAssessment,
        recommendation: parsedResponse.recommendation,
        citations: validatedCitations,
    };
}

export {
    buildRiskPrompt,
    buildSopQuery,
    filterValidCitations,
    INSUFFICIENT_EVIDENCE_RESULT,
    parseRiskLlmResponse,
    validateFindingInput,
};
