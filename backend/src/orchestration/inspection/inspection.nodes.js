/**
 * Inspection Workflow Nodes (Phase 4: Conditional Routing, Validation & Bounded Retry)
 *
 * Connects the LangGraph StateGraph orchestration layer to the SovereignAI
 * service adapters and enforces validation, bounded retry, and evidence checks.
 *
 * Target Sequence:
 *   START
 *     ↓
 *   ingest
 *     ↓
 *   retrieve
 *     ↓
 *   extract_findings
 *     ↓
 *   validate_findings
 *     ├── VALID → retrieve_sop
 *     └── INVALID → retry_extraction (if attempts < max) → validate_findings
 *                   safe_failure (if attempts >= max) → END
 *
 *   retrieve_sop
 *     ↓
 *   check_sop_evidence
 *     ├── EVIDENCE_FOUND → assess_risk
 *     └── NO_EVIDENCE → insufficient_evidence → END
 *
 *   assess_risk
 *     ↓
 *   validate_risk
 *     ├── VALID → validate_citations
 *     └── INVALID → safe_failure → END
 *
 *   validate_citations
 *     ↓
 *   generate_report
 *     ↓
 *   END
 */

import * as defaultAdapters from "./inspection.adapters.js";
import { INSUFFICIENT_EVIDENCE_RESULT } from "../../../../ai-service/risk/risk.schema.js";
import { executeCalculator } from "../../services/agentTools/calculator.tool.js";
import { getReportStoragePath } from "../../utils/storage.js";
import fs from "fs";

const ALLOWED_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", null]);

/**
 * Validates PR #13 finding contract.
 *
 * @param {object} finding Finding object
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateFindingStructure(finding) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        return { isValid: false, error: "Finding must be a JSON object" };
    }
    if (typeof finding.finding !== "string" || !finding.finding.trim()) {
        return { isValid: false, error: "Finding 'finding' field must be a non-empty string" };
    }
    if (typeof finding.evidence !== "string" || !finding.evidence.trim()) {
        return { isValid: false, error: "Finding 'evidence' field must be a non-empty string" };
    }
    return { isValid: true };
}

/**
 * Validates whether a finding is grounded in the retrieved report context.
 *
 * @param {object} finding
 * @param {Array<object>} retrievalResults
 * @returns {boolean}
 */
export function validateFindingGrounding(finding, retrievalResults = []) {
    if (!finding || typeof finding !== "object") return false;

    if (!Array.isArray(retrievalResults) || retrievalResults.length === 0) {
        // If finding has non-empty evidence, allow fallback grounding check
        return Boolean(finding.evidence && finding.evidence.trim().length > 5);
    }

    const normEv = String(finding.evidence || "").toLowerCase().trim();

    return retrievalResults.some((chunk) => {
        if (!chunk || typeof chunk !== "object") return false;

        // Verify finding source matches chunk documentId and page if source is specified
        if (finding.source && typeof finding.source === "object") {
            const docMatch =
                !finding.source.documentId ||
                !chunk.documentId ||
                String(finding.source.documentId).trim() === String(chunk.documentId).trim();
            const pageMatch =
                finding.source.page === undefined ||
                chunk.page === undefined ||
                Number(finding.source.page) === Number(chunk.page);

            if (docMatch && pageMatch) {
                // If text also aligns or source matches exactly
                if (typeof chunk.text === "string" && normEv) {
                    const normChunk = chunk.text.toLowerCase();
                    if (normChunk.includes(normEv) || normEv.includes(normChunk)) {
                        return true;
                    }
                } else {
                    return true;
                }
            }
        }

        // Check text match between finding evidence and chunk text
        if (typeof chunk.text === "string" && normEv) {
            const normChunk = chunk.text.toLowerCase();
            return normChunk.includes(normEv) || normEv.includes(normChunk);
        }

        return false;
    });
}

/**
 * Deterministically analyzes numerical thresholds (difference and percentage exceedance)
 * using the safe recursive-descent calculator tool.
 *
 * @param {object} finding
 * @returns {Promise<object|null>}
 */
export async function analyzeFindingNumericThreshold(finding) {
    if (!finding || !finding.observedValue || !finding.limit) {
        return null;
    }

    const obsMatch = String(finding.observedValue).match(/-?\d+(?:\.\d+)?/);
    const limMatch = String(finding.limit).match(/-?\d+(?:\.\d+)?/);

    if (!obsMatch || !limMatch) {
        return null;
    }

    const obs = parseFloat(obsMatch[0]);
    const lim = parseFloat(limMatch[0]);

    if (!Number.isFinite(obs) || !Number.isFinite(lim)) {
        return null;
    }

    try {
        const diffResult = await executeCalculator({ expression: `${obs} - ${lim}` });
        let pctResult = { result: 0 };
        if (lim !== 0) {
            pctResult = await executeCalculator({ expression: `((${obs} - ${lim}) / ${lim}) * 100` });
        }

        return {
            observed: obs,
            limit: lim,
            difference: diffResult.result,
            percentageExceedance: pctResult.result,
            exceeded: obs > lim,
        };
    } catch (err) {
        console.warn(`[Calculator] Non-fatal numeric analysis warning: ${err.message}`);
        return null;
    }
}

/**
 * Validates findings collection from extraction output.
 * Preserves legitimate zero-finding reports as valid.
 *
 * @param {Array<object>} findings
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateFindingsArray(findings) {
    if (!Array.isArray(findings)) {
        return { isValid: false, error: "Findings must be an array" };
    }
    for (let i = 0; i < findings.length; i++) {
        const check = validateFindingStructure(findings[i]);
        if (!check.isValid) {
            return { isValid: false, error: `findings[${i}]: ${check.error}` };
        }
    }
    return { isValid: true };
}

/**
 * Validates risk assessment output against PR #15 schema.
 *
 * @param {object} riskAssessment
 * @param {string} recommendation
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateRiskStructure(riskAssessment, recommendation) {
    if (!riskAssessment || typeof riskAssessment !== "object" || Array.isArray(riskAssessment)) {
        return { isValid: false, error: "riskAssessment must be a JSON object" };
    }

    let level = riskAssessment.level;
    if (level !== null && level !== undefined) {
        if (typeof level !== "string") {
            return { isValid: false, error: "riskAssessment.level must be a string or null" };
        }
        level = level.trim().toUpperCase();
    } else {
        level = null;
    }

    if (!ALLOWED_RISK_LEVELS.has(level)) {
        return {
            isValid: false,
            error: `Invalid risk level: '${riskAssessment.level}'. Allowed levels: LOW, MEDIUM, HIGH, null`,
        };
    }

    if (typeof riskAssessment.reason !== "string" || !riskAssessment.reason.trim()) {
        return { isValid: false, error: "riskAssessment.reason must be a non-empty string" };
    }

    if (typeof recommendation !== "string" || !recommendation.trim()) {
        return { isValid: false, error: "recommendation must be a non-empty string" };
    }

    return { isValid: true };
}

/**
 * Validates citations output structure.
 *
 * @param {Array<object>} citations
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateCitationsStructure(citations) {
    if (!Array.isArray(citations)) {
        return { isValid: false, error: "Citations must be an array" };
    }
    for (let i = 0; i < citations.length; i++) {
        const c = citations[i];
        if (!c || typeof c !== "object" || Array.isArray(c)) {
            return { isValid: false, error: `citations[${i}] must be a JSON object` };
        }
        if (typeof c.documentId !== "string" || !c.documentId.trim()) {
            return { isValid: false, error: `citations[${i}].documentId must be a non-empty string` };
        }
    }
    return { isValid: true };
}

/**
 * Routing functions for LangGraph conditional edges
 */
export function routeFindingsValidation(state) {
    if (state.status === "failed" && !state.findingValidation) {
        return "safe_failure";
    }

    if (state.findingValidation?.isValid === true) {
        return "retrieve_sop";
    }

    const attempts = Number.isInteger(state.extractionAttempts) ? state.extractionAttempts : 1;
    const maxAttempts = Number.isInteger(state.maxExtractionAttempts) ? state.maxExtractionAttempts : 2;

    if (attempts < maxAttempts) {
        return "retry_extraction";
    }

    return "safe_failure";
}

export function routeSopEvidence(state) {
    if (state.status === "failed") {
        return "insufficient_evidence";
    }

    if (state.sopEvidenceStatus === "EVIDENCE_FOUND") {
        return "assess_risk";
    }

    return "insufficient_evidence";
}

export function routeRiskValidation(state) {
    if (state.status === "failed") {
        return "safe_failure";
    }

    if (state.riskValidation?.isValid === true) {
        return "validate_citations";
    }

    return "safe_failure";
}

export function routeCitationsValidation(state) {
    if (state.status === "failed") {
        return "safe_failure";
    }

    if (state.citationValidation?.isValid === true) {
        return "generate_report";
    }

    return "safe_failure";
}

/**
 * Creates node implementations for the inspection StateGraph.
 *
 * @param {object} [customAdapters] Optional adapter overrides for testing or mock injection
 * @returns {object} Map of node functions
 */
export function createInspectionNodes(customAdapters = {}) {
    const adapters = { ...defaultAdapters, ...customAdapters };

    /**
     * Node 1: Ingest Document
     */
    async function ingestNode(state) {
        const executionOrder = ["ingest"];
        try {
            if (!state.documentId && !state.filePath) {
                return {
                    currentNode: "ingest",
                    executionOrder,
                    status: "failed",
                    errors: [
                        {
                            node: "ingest",
                            message: "documentId or filePath is required for inspection ingestion",
                            timestamp: new Date().toISOString(),
                        },
                    ],
                };
            }

            const ingestionResult = await adapters.runIngestion(state, state.metadata?.ingestOptions);

            return {
                documentId: ingestionResult.documentId,
                ingestionResult,
                currentNode: "ingest",
                executionOrder,
                status: "in_progress",
            };
        } catch (err) {
            return {
                currentNode: "ingest",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "ingest",
                        message: err.message || "Ingestion error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 2: Retrieve Relevant Content
     */
    async function retrieveNode(state) {
        const executionOrder = ["retrieve"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "retrieve", executionOrder };
            }

            const retrievalResults = await adapters.runRetrieval(state, state.metadata?.retrievalOptions);

            return {
                retrievalResults: Array.isArray(retrievalResults) ? retrievalResults : [],
                currentNode: "retrieve",
                executionOrder,
            };
        } catch (err) {
            return {
                currentNode: "retrieve",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "retrieve",
                        message: err.message || "Retrieval error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 3: Extract Findings
     */
    async function extractFindingsNode(state) {
        const executionOrder = ["extract_findings"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "extract_findings", executionOrder };
            }

            const findings = await adapters.runFindingsExtraction(state, state.metadata?.analysisOptions);

            return {
                findings: Array.isArray(findings) ? findings : findings,
                extractionAttempts: 1,
                currentNode: "extract_findings",
                executionOrder,
            };
        } catch (err) {
            return {
                currentNode: "extract_findings",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "extract_findings",
                        message: err.message || "Findings extraction error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 4: Validate Findings (Phase 4 & 6)
     * Validates extracted findings against schema, report evidence grounding, and numeric analysis.
     */
    async function validateFindingsNode(state) {
        const executionOrder = ["validate_findings"];
        try {
            if (state.status === "failed") {
                return {
                    findingValidation: { isValid: false, status: "INVALID", error: state.errors?.[0]?.message || "Prior failure" },
                    currentNode: "validate_findings",
                    executionOrder,
                };
            }

            const validation = validateFindingsArray(state.findings);

            if (!validation.isValid) {
                return {
                    findingValidation: { isValid: false, status: "INVALID", error: validation.error },
                    failureReason: validation.error,
                    currentNode: "validate_findings",
                    executionOrder,
                };
            }

            // Phase 6: Grounding verification & deterministic numeric analysis per finding
            const validatedFindings = [];
            if (Array.isArray(state.findings)) {
                for (const rawFinding of state.findings) {
                    const finding = { ...rawFinding };
                    const isGrounded = validateFindingGrounding(finding, state.retrievalResults);
                    finding.grounded = isGrounded;

                    // Deterministic numeric calculator analysis if values present
                    const numAnalysis = await analyzeFindingNumericThreshold(finding);
                    if (numAnalysis) {
                        finding.numericalAnalysis = numAnalysis;
                    }

                    validatedFindings.push(finding);
                }
            }

            return {
                findings: validatedFindings,
                findingValidation: { isValid: true, status: "VALID" },
                currentNode: "validate_findings",
                executionOrder,
            };
        } catch (err) {
            return {
                findingValidation: { isValid: false, status: "INVALID", error: err.message },
                failureReason: err.message,
                currentNode: "validate_findings",
                executionOrder,
            };
        }
    }

    /**
     * Node 5: Retry Extraction (Phase 4)
     * Bounded retry invoking extraction adapter with repair/retry parameters.
     */
    async function retryExtractionNode(state) {
        const executionOrder = ["retry_extraction"];
        try {
            const nextAttempts = (state.extractionAttempts || 1) + 1;

            const retryOptions = {
                ...state.metadata?.analysisOptions,
                retry: true,
                lastError: state.findingValidation?.error,
            };

            const retriedFindings = await adapters.runFindingsExtraction(state, retryOptions);

            return {
                extractionAttempts: nextAttempts,
                findings: Array.isArray(retriedFindings) ? retriedFindings : retriedFindings,
                currentNode: "retry_extraction",
                executionOrder,
            };
        } catch (err) {
            const nextAttempts = (state.extractionAttempts || 1) + 1;
            return {
                extractionAttempts: nextAttempts,
                currentNode: "retry_extraction",
                executionOrder,
                errors: [
                    {
                        node: "retry_extraction",
                        message: err.message || "Retry extraction error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 6: Retrieve SOP Evidence (Phase 6: Isolated per finding)
     * Calls SOP adapter enforcing documentType='sop' and organizationId boundary.
     */
    async function retrieveSopNode(state) {
        const executionOrder = ["retrieve_sop"];
        try {
            if (state.status === "failed") {
                return { currentNode: "retrieve_sop", executionOrder };
            }

            const sopOptions = {
                organizationId: state.organizationId,
                ...state.metadata?.riskOptions,
                ...state.metadata?.sopOptions,
            };

            const allSopEvidence = [];
            const seenKeys = new Set();
            const updatedFindings = [];

            if (Array.isArray(state.findings) && state.findings.length > 0) {
                const findingsWithSop = await Promise.all(
                    state.findings.map(async (rawFinding) => {
                        const finding = { ...rawFinding };
                        const sopChunks = await adapters.runSopRetrieval(finding, sopOptions);
                        const findingChunks = [];

                        if (Array.isArray(sopChunks)) {
                            for (const chunk of sopChunks) {
                                // Enforce strict tenant boundary: Discard chunks belonging to another company
                                if (state.organizationId && chunk.organizationId && chunk.organizationId !== state.organizationId) {
                                    continue;
                                }
                                findingChunks.push(chunk);
                            }
                        }

                        // Store isolated SOP evidence strictly on this finding
                        finding.sopEvidence = findingChunks;
                        return finding;
                    })
                );

                for (const finding of findingsWithSop) {
                    updatedFindings.push(finding);
                    if (Array.isArray(finding.sopEvidence)) {
                        for (const chunk of finding.sopEvidence) {
                            const key = `${chunk.documentId}:${chunk.page}:${chunk.chunkIndex}`;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                allSopEvidence.push(chunk);
                            }
                        }
                    }
                }
            } else {
                // Fallback query if 0 findings extracted (clean inspection)
                const sopChunks = await adapters.runSopRetrieval(state.task, sopOptions);
                if (Array.isArray(sopChunks)) {
                    for (const chunk of sopChunks) {
                        if (state.organizationId && chunk.organizationId && chunk.organizationId !== state.organizationId) {
                            continue;
                        }
                        allSopEvidence.push(chunk);
                    }
                }
            }

            return {
                sopEvidence: allSopEvidence,
                findings: updatedFindings.length > 0 ? updatedFindings : state.findings,
                currentNode: "retrieve_sop",
                executionOrder,
            };
        } catch (err) {
            return {
                currentNode: "retrieve_sop",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "retrieve_sop",
                        message: err.message || "SOP retrieval error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 7: Check SOP Evidence (Phase 4 & 6)
     * Verifies whether authoritative SOP chunks were retrieved.
     */
    async function checkSopEvidenceNode(state) {
        const executionOrder = ["check_sop_evidence"];
        try {
            // Clean inspections (0 findings) proceed to assess_risk for routine recommendation
            if (Array.isArray(state.findings) && state.findings.length === 0) {
                return {
                    sopEvidenceStatus: "EVIDENCE_FOUND",
                    currentNode: "check_sop_evidence",
                    executionOrder,
                };
            }

            const hasEvidence = Array.isArray(state.sopEvidence) && state.sopEvidence.length > 0;

            return {
                sopEvidenceStatus: hasEvidence ? "EVIDENCE_FOUND" : "NO_EVIDENCE",
                currentNode: "check_sop_evidence",
                executionOrder,
            };
        } catch (err) {
            return {
                sopEvidenceStatus: "NO_EVIDENCE",
                currentNode: "check_sop_evidence",
                executionOrder,
            };
        }
    }

    /**
     * Node 8: Insufficient Evidence Termination (Phase 4)
     * Safe termination without LLM hallucination when no SOP evidence exists.
     */
    async function insufficientEvidenceNode(state) {
        const executionOrder = ["insufficient_evidence"];

        const riskAssessment = {
            ...INSUFFICIENT_EVIDENCE_RESULT.riskAssessment,
            grounded: false,
        };
        const recommendation = INSUFFICIENT_EVIDENCE_RESULT.recommendation;

        return {
            riskAssessment,
            riskAssessments: [riskAssessment],
            recommendation,
            recommendations: [recommendation],
            citations: [],
            sopEvidenceStatus: "NO_EVIDENCE",
            workflowOutcome: "INSUFFICIENT_EVIDENCE",
            status: "completed",
            failureReason: "No authoritative SOP evidence exists in the knowledge base matching findings.",
            currentNode: "insufficient_evidence",
            executionOrder,
        };
    }

    /**
     * Node 9: Assess Risk and Formulate Recommendations (Phase 6: Independent Per-Finding)
     */
    async function assessRiskNode(state) {
        const executionOrder = ["assess_risk"];
        try {
            if (state.status === "failed") {
                return { currentNode: "assess_risk", executionOrder };
            }

            const riskAssessments = [];
            const recommendations = [];
            const rawCitations = [];
            const updatedFindings = [];

            const baseRiskOptions = {
                organizationId: state.organizationId,
                ...state.metadata?.riskOptions,
            };

            if (Array.isArray(state.findings) && state.findings.length > 0) {
                for (const rawFinding of state.findings) {
                    const finding = { ...rawFinding };
                    const findingEvidence = Array.isArray(finding.sopEvidence) ? finding.sopEvidence : [];

                    if (findingEvidence.length > 0) {
                        // Finding has authoritative SOP evidence -> run risk assessment using ONLY its evidence
                        const findingRiskOptions = {
                            ...baseRiskOptions,
                            searchSop: async () => findingEvidence,
                        };
                        const riskResult = await adapters.runRiskAssessment(finding, findingRiskOptions);

                        if (riskResult.riskAssessment) {
                            finding.riskAssessment = riskResult.riskAssessment;
                            riskAssessments.push(riskResult.riskAssessment);
                        }
                        if (riskResult.recommendation) {
                            finding.recommendation = riskResult.recommendation;
                            recommendations.push(riskResult.recommendation);
                        }
                        if (Array.isArray(riskResult.citations)) {
                            finding.citations = riskResult.citations;
                            rawCitations.push(...riskResult.citations);
                        }
                        finding.grounded = riskResult.grounded !== false;
                    } else {
                        // Unsupported finding (STEP 11 — Partial Failure Handling)
                        const ungroundedRisk = {
                            level: null,
                            reason: `Insufficient SOP evidence is available to determine risk level for ${finding.finding}.`,
                            grounded: false,
                        };
                        const ungroundedRec = "Insufficient SOP evidence is available to provide a validated recommendation.";

                        finding.riskAssessment = ungroundedRisk;
                        finding.recommendation = ungroundedRec;
                        finding.citations = [];
                        finding.grounded = false;

                        riskAssessments.push(ungroundedRisk);
                        recommendations.push(ungroundedRec);
                    }

                    updatedFindings.push(finding);
                }
            } else {
                // Safe default when 0 findings detected
                riskAssessments.push({
                    level: null,
                    reason: "No significant inspection findings were detected in the report.",
                    grounded: false,
                });
                recommendations.push("Continue standard operating and inspection schedule.");
            }

            // Primary risk assessment prioritizes highest risk level
            const primaryRisk =
                riskAssessments.find((r) => r.level === "HIGH") ||
                riskAssessments.find((r) => r.level === "MEDIUM") ||
                riskAssessments.find((r) => r.level === "LOW") ||
                riskAssessments[0] || {
                    level: null,
                    reason: "No risk assessment available.",
                    grounded: false,
                };

            const primaryRecommendation =
                recommendations.filter(Boolean).join(" ") || "No specific recommendation generated.";

            return {
                findings: updatedFindings.length > 0 ? updatedFindings : state.findings,
                riskAssessment: primaryRisk,
                riskAssessments,
                recommendation: primaryRecommendation,
                recommendations,
                citations: rawCitations,
                currentNode: "assess_risk",
                executionOrder,
            };
        } catch (err) {
            return {
                currentNode: "assess_risk",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "assess_risk",
                        message: err.message || "Risk assessment error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 10: Validate Risk (Phase 4)
     * Verifies risk levels (LOW/MEDIUM/HIGH/null) and recommendation strings.
     */
    async function validateRiskNode(state) {
        const executionOrder = ["validate_risk"];
        try {
            if (state.status === "failed") {
                return {
                    riskValidation: { isValid: false, status: "INVALID", error: state.errors?.[0]?.message || "Prior failure" },
                    currentNode: "validate_risk",
                    executionOrder,
                };
            }

            const validation = validateRiskStructure(state.riskAssessment, state.recommendation);

            if (validation.isValid) {
                return {
                    riskValidation: { isValid: true, status: "VALID" },
                    currentNode: "validate_risk",
                    executionOrder,
                };
            }

            return {
                riskValidation: { isValid: false, status: "INVALID", error: validation.error },
                failureReason: validation.error,
                currentNode: "validate_risk",
                executionOrder,
            };
        } catch (err) {
            return {
                riskValidation: { isValid: false, status: "INVALID", error: err.message },
                failureReason: err.message,
                currentNode: "validate_risk",
                executionOrder,
            };
        }
    }

    /**
     * Node 11: Safe Failure Node (Phase 4)
     * Handles unrecoverable validation failures without process crashes.
     */
    async function safeFailureNode(state) {
        const executionOrder = ["safe_failure"];

        const failureReason =
            state.failureReason ||
            state.findingValidation?.error ||
            state.riskValidation?.error ||
            state.errors?.[0]?.message ||
            "Workflow validation failed";

        return {
            status: "failed",
            workflowOutcome: "SAFE_FAILURE",
            failureReason,
            errors: [
                {
                    node: state.currentNode || "validation",
                    message: failureReason,
                    timestamp: new Date().toISOString(),
                },
            ],
            currentNode: "safe_failure",
            executionOrder,
        };
    }

    /**
     * Node 12: Validate Citations
     * Calls citation validation adapter to verify cited chunks exist in retrieved SOP evidence.
     */
    async function validateCitationsNode(state) {
        const executionOrder = ["validate_citations"];
        try {
            if (state.status === "failed") {
                return {
                    citationValidation: { isValid: false, status: "INVALID", error: state.errors?.[0]?.message || "Prior failure" },
                    currentNode: "validate_citations",
                    executionOrder,
                };
            }

            const rawCitations = Array.isArray(state.citations) ? state.citations : [];
            const sopEvidence = Array.isArray(state.sopEvidence) ? state.sopEvidence : [];

            // Filter raw citations to eliminate cross-tenant leakage
            const tenantFilteredCitations = rawCitations.filter((c) => {
                if (state.organizationId && c.organizationId && c.organizationId !== state.organizationId) {
                    return false;
                }
                return true;
            });

            const verifiedCitations = adapters.runCitationValidation(tenantFilteredCitations, sopEvidence, state.organizationId);

            // Deduplicate citations
            const seen = new Set();
            const uniqueCitations = verifiedCitations.filter((c) => {
                const key = `${c.documentId}:${c.filename}:${c.page}:${c.chunkIndex}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const check = validateCitationsStructure(uniqueCitations);
            if (!check.isValid) {
                return {
                    citations: uniqueCitations,
                    citationValidation: { isValid: false, status: "INVALID", error: check.error },
                    failureReason: check.error,
                    currentNode: "validate_citations",
                    executionOrder,
                };
            }

            return {
                citations: uniqueCitations,
                citationValidation: { isValid: true, status: "VALID" },
                currentNode: "validate_citations",
                executionOrder,
            };
        } catch (err) {
            return {
                citationValidation: { isValid: false, status: "INVALID", error: err.message },
                failureReason: err.message,
                currentNode: "validate_citations",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "validate_citations",
                        message: err.message || "Citation validation error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    /**
     * Node 13: Generate Report (Phase 6: Report Validation & Tenant Verification)
     * Validates input sections and persists Approval Note DOCX strictly within tenant directory.
     */
    async function generateReportNode(state) {
        const executionOrder = ["generate_report"];
        try {
            if (state.status === "failed") {
                return { currentNode: "generate_report", executionOrder };
            }

            // Phase 6 STEP 14: Report Validation before generation
            if (state.organizationId && (typeof state.organizationId !== "string" || !state.organizationId.trim())) {
                throw new Error("organizationId must be a valid non-empty string when provided");
            }

            const docxData = {
                subject: `Inspection Report Analysis and Approval Recommendation — ${state.documentId || "Report"}`,
                findings: state.findings || [],
                riskAssessment: state.riskAssessment || {
                    level: null,
                    reason: "No risk assessment available.",
                },
                recommendation: state.recommendation || "No specific recommendation generated.",
                citations: state.citations || [],
            };

            const reportOptions = {
                documentId: state.documentId,
                organizationId: state.organizationId,
                task: state.task,
                filename:
                    state.metadata?.filename ||
                    state.metadata?.approvalNoteOptions?.filename ||
                    `Approval_Note_${state.documentId || "generated"}.docx`,
                ...state.metadata?.approvalNoteOptions,
                ...state.metadata?.reportOptions,
            };

            const reportResult = await adapters.runReportGeneration(docxData, reportOptions);

            // Verify report generation produced a valid result
            if (!reportResult || !reportResult.filename) {
                throw new Error("Approval Note DOCX was not successfully generated");
            }

            return {
                report: reportResult,
                workflowOutcome: "SUCCESS",
                currentNode: "generate_report",
                executionOrder,
                status: "completed",
            };
        } catch (err) {
            return {
                currentNode: "generate_report",
                executionOrder,
                status: "failed",
                errors: [
                    {
                        node: "generate_report",
                        message: err.message || "Report generation error",
                        timestamp: new Date().toISOString(),
                    },
                ],
            };
        }
    }

    return {
        ingestNode,
        retrieveNode,
        extractFindingsNode,
        validateFindingsNode,
        retryExtractionNode,
        retrieveSopNode,
        checkSopEvidenceNode,
        insufficientEvidenceNode,
        assessRiskNode,
        validateRiskNode,
        safeFailureNode,
        validateCitationsNode,
        generateReportNode,
    };
}

// Default export of standard nodes connected to production adapters
export const defaultNodes = createInspectionNodes();
export const {
    ingestNode,
    retrieveNode,
    extractFindingsNode,
    validateFindingsNode,
    retryExtractionNode,
    retrieveSopNode,
    checkSopEvidenceNode,
    insufficientEvidenceNode,
    assessRiskNode,
    validateRiskNode,
    safeFailureNode,
    validateCitationsNode,
    generateReportNode,
} = defaultNodes;
