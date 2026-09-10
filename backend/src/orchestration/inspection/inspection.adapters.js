/**
 * Inspection Service Adapters
 *
 * Bridge boundary connecting the LangGraph orchestration layer to existing,
 * tested SovereignAI service implementations.
 *
 * CONSTRAINTS:
 * - DO NOT duplicate business logic, Qdrant queries, MLX calls, or DOCX generation.
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
import { buildSopQuery } from "../../../../ai-service/risk/risk.prompt.js";
import { createReportRecord } from "../../services/reports.service.js";
import { checkKnowledgeBaseSopGate } from "../../services/sop-gate.service.js";

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

    try {
        const result = await ingestInspectionFile(target, ingestOpts);

        return {
            documentId: result.documentId || state.documentId,
            filename: result.filename || (state.filePath ? path.basename(state.filePath) : `${result.documentId}.pdf`),
            chunksStored: result.chunksStored ?? 0,
        };
    } catch (err) {
        if (state.documentId && err.message?.includes("Inspection file could not be found")) {
            return {
                documentId: state.documentId,
                filename: options.filename || state.metadata?.filename || `${state.documentId}.pdf`,
                chunksStored: 0,
            };
        }
        throw err;
    }
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
            documentId,
            {
                organizationId: state.organizationId,
                ...options,
            }
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
            organizationId: state.organizationId,
            task: state.task || "Analyze this inspection report and extract all significant findings.",
        },
        {
            organizationId: state.organizationId,
            ...options,
        }
    );

    return analysisResult.findings || [];
}

const STOP_WORDS = new Set([
    "the", "and", "or", "a", "an", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "is", "are", "was", "were", "be", "been", "this", "that", "these", "those", "it", "its",
    "as", "if", "shall", "should", "must", "can", "could", "may", "might", "will", "would",
    "not", "no", "yes", "all", "any", "some", "every", "per", "into", "over", "than"
]);

function extractKeywords(text) {
    if (!text || typeof text !== "string") return new Set();
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    return new Set(words);
}

/**
 * Deterministically validates a Knowledge Base SOP evidence chunk.
 * Enforces:
 * 1. score >= threshold (default 0.50)
 * 2. organizationId matches authenticated tenant
 * 3. documentType === "sop"
 * 4. documentId, filename, page, chunkIndex, non-empty text
 * 5. Cannot be the inspection report itself (chunk.documentId !== inspectionDocId)
 * 6. Semantic / keyword relevance between candidate observation and SOP chunk
 */
export function validateSopEvidenceChunk(chunk, finding = {}, organizationId = null, inspectionDocId = null, minScore = 0.50) {
    if (!chunk || typeof chunk !== "object") return false;

    // 1. Minimum similarity threshold (canonical 0.50)
    const score = typeof chunk.score === "number" ? chunk.score : 0;
    if (score < minScore) return false;

    // 2. Strict tenant boundary
    if (organizationId && chunk.organizationId && String(chunk.organizationId).trim() !== String(organizationId).trim()) {
        return false;
    }

    // 3. Canonical KB document type
    const docType = (chunk.documentType || "").toLowerCase();
    if (docType !== "sop") return false;

    // 4. Required metadata
    if (!chunk.documentId || typeof chunk.documentId !== "string" || !chunk.documentId.trim()) return false;
    if (!chunk.filename || typeof chunk.filename !== "string" || !chunk.filename.trim()) return false;
    if (chunk.page === undefined || chunk.page === null || isNaN(Number(chunk.page))) return false;
    if (chunk.chunkIndex === undefined || chunk.chunkIndex === null || isNaN(Number(chunk.chunkIndex))) return false;
    if (!chunk.text || typeof chunk.text !== "string" || !chunk.text.trim()) return false;

    // 5. Inspection report cannot be its own SOP evidence authority
    if (inspectionDocId && String(chunk.documentId).trim() === String(inspectionDocId).trim()) {
        return false;
    }

    // 6. Semantic relevance check between candidate observation and SOP text
    const findingKeywords = new Set([
        ...extractKeywords(finding.finding || ""),
        ...extractKeywords(finding.equipment || ""),
        ...extractKeywords(finding.evidence || ""),
    ]);

    if (findingKeywords.size > 0) {
        const chunkKeywords = extractKeywords(chunk.text);
        let matchCount = 0;
        for (const kw of findingKeywords) {
            if (chunkKeywords.has(kw)) {
                matchCount++;
            }
        }
        // At least 1 shared core domain keyword/concept required for relevance
        if (matchCount === 0) {
            return false;
        }
    }

    return true;
}

/**
 * Adapter 4: SOP Retrieval Adapter
 * Calls existing searchSop() enforcing documentType='sop' filter.
 *
 * @param {object|string} finding Inspection finding or task string
 * @param {object} [options] Retrieval options
 * @returns {Promise<Array<object>>} Retrieved SOP chunks
 */
export async function runSopRetrieval(finding, options = {}) {
    let query;
    if (typeof finding === "string") {
        query = finding;
    } else if (finding && typeof finding === "object") {
        query = buildSopQuery(finding);
    }

    if (!query || !query.trim()) {
        return [];
    }

    let allowedDocumentIds = options.allowedDocumentIds;
    const organizationId = options.organizationId;

    // Authoritative Gate: Check PostgreSQL for active approved SOP documents first
    if (organizationId) {
        if (allowedDocumentIds === undefined) {
            const gate = await checkKnowledgeBaseSopGate(organizationId);
            if (!gate.evidenceAvailable) {
                return [];
            }
            allowedDocumentIds = gate.allowedDocumentIds;
        } else if (Array.isArray(allowedDocumentIds) && allowedDocumentIds.length === 0) {
            return [];
        }
    }

    const searchSopFn = options.searchSop ?? searchSop;
    const sopOptions = {
        scoreThreshold: options.scoreThreshold ?? (process.env.SOP_SCORE_THRESHOLD ? parseFloat(process.env.SOP_SCORE_THRESHOLD) : 0.50),
        ...options,
        allowedDocumentIds,
    };
    const sopChunks = await searchSopFn(query.trim(), sopOptions);

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
export function runCitationValidation(rawCitations, retrievedSopChunks, organizationId) {
    return filterValidCitations(rawCitations, retrievedSopChunks, organizationId);
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
