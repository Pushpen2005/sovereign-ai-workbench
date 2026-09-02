/**
 * Inspection Service Adapters
 *
 * Bridge boundary connecting the LangGraph orchestration layer to existing,
 * tested SovereignAI service implementations.
 *
 * CONSTRAINTS:
 * - DO NOT duplicate business logic, Qdrant queries, Ollama calls, or DOCX generation.
 * - Call existing service functions directly.
 * - Map input state and output results cleanly to and from InspectionAgentState.
 */

import path from "path";
import {
    ingestInspectionFile,
    runApprovalNoteGeneration,
} from "../../services/inspection.service.js";
import {
    analyzeInspectionReport,
    resolveInspectionRetrievalQueries,
} from "../../../../ai-service/inspection/inspection.service.js";
import { generateEmbedding } from "../../../../ai-service/embeddings/embedding.service.js";
import { searchSimilarChunks } from "../../../../ai-service/retrieval/retrieval.service.js";
import { searchSop } from "../../../../ai-service/knowledge/sop.service.js";
import { assessFindingRisk } from "../../../../ai-service/risk/risk.service.js";
import { filterValidCitations } from "../../../../ai-service/risk/risk.schema.js";
import { createReportRecord } from "../../services/reports.service.js";

/**
 * Adapter 1: Ingestion Adapter
 * Calls existing ingestInspectionFile().
 *
 * @param {object} state Graph state
 * @param {object} [options] Ingestion options
 * @returns {Promise<{ documentId: string, filename: string, chunksStored: number }>}
 */
export async function runIngestion(state, options = {}) {
    const target = state.filePath || state.metadata?.input || state.documentId;
    if (!target) {
        throw new Error("documentId or filePath is required to run inspection ingestion");
    }

    const ingestOpts = {
        ...options,
        documentId: state.documentId || options.documentId,
        filename: options.filename || state.metadata?.filename,
        organizationId: state.organizationId || options.organizationId,
    };

    const result = await ingestInspectionFile(target, ingestOpts);

    return {
        documentId: result.documentId || state.documentId,
        filename: result.filename || (state.filePath ? path.basename(state.filePath) : `${result.documentId}.pdf`),
        chunksStored: result.chunksStored ?? 0,
    };
}

/**
 * Adapter 2: Retrieval Adapter
 * Reuses the existing multi-aspect retrieval logic across observation dimensions
 * (equipment, operating limits, non-compliance observations).
 *
 * @param {object} state Graph state
 * @param {object} [options] Retrieval options
 * @returns {Promise<Array<object>>} Deduplicated candidate chunks
 */
export async function runRetrieval(state, options = {}) {
    const documentId = state.documentId;
    if (!documentId) {
        throw new Error("documentId is required for inspection retrieval");
    }

    const candidateLimit = options.candidateLimit ?? 10;
    const generateEmbeddingFn = options.generateEmbedding ?? generateEmbedding;
    const searchSimilarChunksFn = options.searchSimilarChunks ?? searchSimilarChunks;

    // Use existing multi-aspect query resolution
    const queries = resolveInspectionRetrievalQueries(state.task, options);
    const chunkMap = new Map();

    for (const q of queries) {
        const queryEmbedding = await generateEmbeddingFn(q);
        const candidates = await searchSimilarChunksFn(
            queryEmbedding,
            candidateLimit,
            documentId
        );

        if (Array.isArray(candidates)) {
            for (const chunk of candidates) {
                const key = `${chunk.documentId || ""}:${chunk.page ?? ""}:${chunk.chunkIndex ?? ""}`;
                if (!chunkMap.has(key) || chunkMap.get(key).score < chunk.score) {
                    chunkMap.set(key, chunk);
                }
            }
        }
    }

    return Array.from(chunkMap.values()).sort((a, b) => b.score - a.score);
}

/**
 * Adapter 3: Findings Extraction Adapter
 * Calls existing analyzeInspectionReport().
 * Preserves structured JSON extraction, schema validation, retry/repair, and source linkage.
 *
 * @param {object} state Graph state
 * @param {object} [options] Analysis options
 * @returns {Promise<Array<object>>} Validated findings
 */
export async function runFindingsExtraction(state, options = {}) {
    const documentId = state.documentId;
    if (!documentId) {
        throw new Error("documentId is required for findings extraction");
    }

    const analysisResult = await analyzeInspectionReport(
        {
            documentId,
            task: state.task || "Analyze this inspection report and extract all significant findings.",
        },
        options
    );

    return analysisResult.findings || [];
}

/**
 * Adapter 4: SOP Retrieval Adapter
 * Calls existing searchSop() with strict documentType="sop" filter.
 *
 * @param {object} finding Finding object or search query string
 * @param {object} [options] Search options
 * @returns {Promise<Array<object>>} Retrieved SOP chunks
 */
export async function runSopRetrieval(finding, options = {}) {
    let query;
    if (typeof finding === "string") {
        query = finding;
    } else if (finding && typeof finding === "object") {
        query = [finding.equipment, finding.finding, finding.observedValue]
            .filter(Boolean)
            .join(" ");
    }

    if (!query || !query.trim()) {
        return [];
    }

    const searchSopFn = options.searchSop ?? searchSop;
    const sopChunks = await searchSopFn(query.trim(), options);

    return Array.isArray(sopChunks) ? sopChunks : [];
}

/**
 * Adapter 5: Risk Assessment Adapter
 * Calls existing assessFindingRisk().
 * Preserves LOW, MEDIUM, HIGH, null ratings, and INSUFFICIENT_EVIDENCE_RESULT handling.
 *
 * @param {object} finding Inspection finding
 * @param {object} [options] Risk options
 * @returns {Promise<object>} Risk assessment and recommendations
 */
export async function runRiskAssessment(finding, options = {}) {
    if (!finding || typeof finding !== "object") {
        return {
            riskAssessment: {
                level: null,
                reason: "No finding provided for risk assessment.",
            },
            recommendation: "Continue standard inspection schedule.",
            citations: [],
        };
    }

    return assessFindingRisk(finding, options);
}

/**
 * Adapter 6: Citation Validation Adapter
 * Calls existing filterValidCitations().
 * Verifies that cited chunks exist in the retrieved SOP evidence and discards hallucinations.
 *
 * @param {Array<object>} rawCitations Citations from LLM output
 * @param {Array<object>} retrievedSopChunks Authoritative retrieved SOP chunks
 * @returns {Array<object>} Verified citations
 */
export function runCitationValidation(rawCitations, retrievedSopChunks) {
    return filterValidCitations(rawCitations, retrievedSopChunks);
}

/**
 * Adapter 7: Report Generation Adapter
 * Calls existing runApprovalNoteGeneration() and optionally persists to PostgreSQL reports table.
 *
 * @param {object} data Payload containing subject, findings, riskAssessment, recommendation, citations
 * @param {object} [options] Report options (outputPath, filename, organizationId)
 * @returns {Promise<object>} Report metadata ({ filename, filePath, downloadUrl, reportId })
 */
export async function runReportGeneration(data, options = {}) {
    const docxResult = await runApprovalNoteGeneration(data, options);

    let reportRecord = null;
    if (options.persistReportRecord && options.organizationId && typeof options.organizationId === "string") {
        try {
            reportRecord = await createReportRecord({
                documentId: options.documentId || null,
                organizationId: options.organizationId,
                title: options.title || `Approval Note — ${options.documentId || "Inspection"}`,
                filename: docxResult.filename,
                riskLevel: data.riskAssessment?.level || null,
                status: "GENERATED",
                task: options.task || "Inspection Report Analysis and Approval Recommendation",
            });
        } catch (dbErr) {
            console.warn(`[Report Adapter] Non-fatal DB report creation warning: ${dbErr.message}`);
        }
    }

    return {
        filename: docxResult.filename,
        filePath: docxResult.filePath,
        downloadUrl: `/api/v1/inspection/download/${docxResult.filename}`,
        reportId: reportRecord?.id || null,
    };
}
