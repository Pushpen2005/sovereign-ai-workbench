/**
 * Inspection Workflow Nodes
 *
 * Connects the LangGraph StateGraph orchestration layer to the SovereignAI
 * service adapters.
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
 *   retrieve_sop
 *     ↓
 *   assess_risk
 *     ↓
 *   validate_citations
 *     ↓
 *   generate_report
 *     ↓
 *   END
 *
 * ARCHITECTURAL CONSTRAINTS:
 * - LangGraph is an orchestrator only.
 * - Nodes delegate all domain computations to adapters without duplicating logic.
 * - Errors are caught and safely recorded into the state `errors` channel.
 * - Downstream nodes safely halt if a prior node marked the workflow as failed.
 */

import * as defaultAdapters from "./inspection.adapters.js";

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
     * Calls ingestion adapter to process/index document into Qdrant.
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
     * Calls retrieval adapter to perform multi-aspect domain queries.
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
     * Calls structured analysis adapter to extract findings using schema validation.
     */
    async function extractFindingsNode(state) {
        const executionOrder = ["extract_findings"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "extract_findings", executionOrder };
            }

            const findings = await adapters.runFindingsExtraction(state, state.metadata?.analysisOptions);

            return {
                findings: Array.isArray(findings) ? findings : [],
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
     * Node 4: Retrieve SOP Evidence
     * Calls SOP adapter enforcing documentType='sop'.
     */
    async function retrieveSopNode(state) {
        const executionOrder = ["retrieve_sop"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "retrieve_sop", executionOrder };
            }

            const sopOptions = {
                ...state.metadata?.riskOptions,
                ...state.metadata?.sopOptions,
            };

            const allSopEvidence = [];
            const seenKeys = new Set();

            if (Array.isArray(state.findings) && state.findings.length > 0) {
                for (const finding of state.findings) {
                    const sopChunks = await adapters.runSopRetrieval(finding, sopOptions);
                    if (Array.isArray(sopChunks)) {
                        for (const chunk of sopChunks) {
                            const key = `${chunk.documentId}:${chunk.page}:${chunk.chunkIndex}`;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                allSopEvidence.push(chunk);
                            }
                        }
                    }
                }
            } else {
                // Fallback query if 0 findings extracted
                const sopChunks = await adapters.runSopRetrieval(state.task, sopOptions);
                if (Array.isArray(sopChunks)) {
                    allSopEvidence.push(...sopChunks);
                }
            }

            return {
                sopEvidence: allSopEvidence,
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
     * Node 5: Assess Risk and Formulate Recommendations
     * Calls risk assessment adapter for findings vs SOP evidence.
     */
    async function assessRiskNode(state) {
        const executionOrder = ["assess_risk"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "assess_risk", executionOrder };
            }

            const riskAssessments = [];
            const recommendations = [];
            const rawCitations = [];

            const riskOptions = {
                ...state.metadata?.riskOptions,
            };
            if (!riskOptions.searchSop && Array.isArray(state.sopEvidence) && state.sopEvidence.length > 0) {
                riskOptions.searchSop = async () => state.sopEvidence;
            }

            if (Array.isArray(state.findings) && state.findings.length > 0) {
                for (const finding of state.findings) {
                    const riskResult = await adapters.runRiskAssessment(finding, riskOptions);

                    if (riskResult.riskAssessment) {
                        riskAssessments.push(riskResult.riskAssessment);
                    }
                    if (riskResult.recommendation) {
                        recommendations.push(riskResult.recommendation);
                    }
                    if (Array.isArray(riskResult.citations)) {
                        rawCitations.push(...riskResult.citations);
                    }
                }
            } else {
                // Safe default when 0 findings detected
                riskAssessments.push({
                    level: null,
                    reason: "No significant inspection findings were detected in the report.",
                });
                recommendations.push("Continue standard operating and inspection schedule.");
            }

            const primaryRisk = riskAssessments[0] || {
                level: null,
                reason: "No risk assessment available.",
            };
            const primaryRecommendation = recommendations.join(" ") || "No specific recommendation generated.";

            return {
                riskAssessment: primaryRisk,
                riskAssessments,
                recommendation: primaryRecommendation,
                recommendations,
                citations: rawCitations, // Unfiltered intermediate citations passed to validateCitationsNode
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
     * Node 6: Validate Citations
     * Calls citation validation adapter to verify cited chunks exist in retrieved SOP evidence.
     */
    async function validateCitationsNode(state) {
        const executionOrder = ["validate_citations"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "validate_citations", executionOrder };
            }

            const rawCitations = Array.isArray(state.citations) ? state.citations : [];
            const sopEvidence = Array.isArray(state.sopEvidence) ? state.sopEvidence : [];

            const verifiedCitations = adapters.runCitationValidation(rawCitations, sopEvidence);

            // Deduplicate citations
            const seen = new Set();
            const uniqueCitations = verifiedCitations.filter((c) => {
                const key = `${c.documentId}:${c.filename}:${c.page}:${c.chunkIndex}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            return {
                citations: uniqueCitations,
                currentNode: "validate_citations",
                executionOrder,
            };
        } catch (err) {
            return {
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
     * Node 7: Generate Report
     * Calls report generation adapter to assemble and emit Approval Note DOCX.
     */
    async function generateReportNode(state) {
        const executionOrder = ["generate_report"];
        try {
            if (state.status === "failed" || (state.errors && state.errors.length > 0)) {
                return { currentNode: "generate_report", executionOrder };
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
                filename: state.metadata?.filename || state.metadata?.approvalNoteOptions?.filename || `Approval_Note_${state.documentId || "generated"}.docx`,
                ...state.metadata?.approvalNoteOptions,
                ...state.metadata?.reportOptions,
            };

            const reportResult = await adapters.runReportGeneration(docxData, reportOptions);

            return {
                report: reportResult,
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
        retrieveSopNode,
        assessRiskNode,
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
    retrieveSopNode,
    assessRiskNode,
    validateCitationsNode,
    generateReportNode,
} = defaultNodes;
