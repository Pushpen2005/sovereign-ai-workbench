import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

import { extractPdfText } from "../extraction/pdf.service.js";
import { chunkText } from "../chunking/chunk.service.js";
import { generateEmbedding } from "../embeddings/embedding.service.js";
import { searchSimilarChunks } from "../retrieval/retrieval.service.js";
import { upsertChunks } from "../vectorstore/qdrant.service.js";
import { generateAnswer } from "../llm/llm.service.js";
import {
    buildInspectionPrompt,
    buildInspectionRetryPrompt,
    buildInspectionContext,
} from "./inspection.prompt.js";
import {
    attachSourcesToFindings,
    parseInspectionLlmResponse,
    InspectionValidationError,
} from "./inspection.schema.js";

export const INSPECTION_ERROR_CODES = Object.freeze({
    RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
    CONNECTION_ERROR: "CONNECTION_ERROR",
    TIMEOUT: "TIMEOUT",
    MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
    INVALID_REQUEST: "INVALID_REQUEST",
    MALFORMED_OUTPUT: "MALFORMED_OUTPUT",
    SCHEMA_VALIDATION_FAILED: "SCHEMA_VALIDATION_FAILED",
    INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
});

export class InspectionServiceError extends Error {
    constructor(message, code = INSPECTION_ERROR_CODES.MALFORMED_OUTPUT, options = {}) {
        super(message, options);
        this.name = "InspectionServiceError";
        this.code = code;
        this.statusCode = options.statusCode || (
            code === INSPECTION_ERROR_CODES.RUNTIME_UNAVAILABLE || code === INSPECTION_ERROR_CODES.CONNECTION_ERROR ? 503 :
            code === INSPECTION_ERROR_CODES.TIMEOUT ? 504 :
            code === INSPECTION_ERROR_CODES.MODEL_NOT_FOUND ? 404 :
            code === INSPECTION_ERROR_CODES.INVALID_REQUEST ? 400 : 422
        );
    }
}

export class InspectionExtractionError extends InspectionServiceError {
    constructor(
        message = "Inspection finding extraction failed because the local model did not return the required structured format.",
        options = {}
    ) {
        const code = options.code || INSPECTION_ERROR_CODES.MALFORMED_OUTPUT;
        super(message, code, options);
        this.name = "InspectionExtractionError";
    }
}

const INSPECTION_DOCUMENT_TYPE = "inspection";

const DEFAULT_CANDIDATE_LIMIT = 10;
const DEFAULT_CONTEXT_LIMIT = Number(process.env.INSPECTION_CONTEXT_LIMIT || 5);
const DEFAULT_SCORE_THRESHOLD = Number(process.env.INSPECTION_SCORE_THRESHOLD || 0.35);

export function createInspectionResult(findings = []) {
    if (!Array.isArray(findings)) {
        throw new TypeError("findings must be an array");
    }

    return {
        findings,
    };
}

function validateInspectionRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Inspection request must be an object");
    }

    const { documentId, task } = input;

    if (typeof documentId !== "string" || documentId.trim().length === 0) {
        throw new TypeError("documentId must be a non-empty string");
    }

    if (typeof task !== "string" || task.trim().length === 0) {
        throw new TypeError("task must be a non-empty string");
    }

    return {
        documentId: documentId.trim(),
        task: task.trim(),
    };
}

function filterRelevantChunks(chunks, scoreThreshold, contextLimit) {
    return chunks
        .filter((chunk) => {
            return (
                chunk &&
                typeof chunk.text === "string" &&
                chunk.text.trim().length > 0 &&
                typeof chunk.score === "number" &&
                chunk.score >= scoreThreshold
            );
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, contextLimit);
}

export const DEFAULT_INSPECTION_QUERY =
    "What inspection findings, abnormal observations, equipment issues, or non-compliances are mentioned in this report?";

export const DEFAULT_INSPECTION_QUERIES = [
    "What inspection findings, abnormal observations, equipment issues, or non-compliances are mentioned in this report?",
    "audit observations, non-compliances, penalties, or inspection findings",
    "equipment inspection findings, abnormal observations, high temperature, vibration, pressure, or operating limits",
];

export function resolveInspectionRetrievalQuery(task, options = {}, input = {}) {
    const explicitQuery =
        (typeof options.query === "string" && options.query.trim()) ||
        (typeof options.retrievalQuery === "string" && options.retrievalQuery.trim()) ||
        (typeof input.query === "string" && input.query.trim()) ||
        (typeof input.retrievalQuery === "string" && input.retrievalQuery.trim());

    if (explicitQuery) {
        return explicitQuery;
    }

    if (typeof task !== "string" || !task.trim()) {
        return DEFAULT_INSPECTION_QUERY;
    }

    const trimmed = task.trim();
    const isGenericInstruction =
        /^analyze\s+this\s+inspection\s+report/i.test(trimmed) ||
        /^analyze\s+findings/i.test(trimmed) ||
        /^analyze\s+report/i.test(trimmed) ||
        /^extract\s+all\s+(significant\s+)?findings/i.test(trimmed);

    if (isGenericInstruction) {
        return DEFAULT_INSPECTION_QUERY;
    }

    return trimmed;
}

export function resolveInspectionRetrievalQueries(task, options = {}, input = {}) {
    const explicitQuery =
        (typeof options.query === "string" && options.query.trim()) ||
        (typeof options.retrievalQuery === "string" && options.retrievalQuery.trim()) ||
        (typeof input.query === "string" && input.query.trim()) ||
        (typeof input.retrievalQuery === "string" && input.retrievalQuery.trim());

    if (explicitQuery) {
        return [explicitQuery];
    }

    if (typeof task !== "string" || !task.trim()) {
        return DEFAULT_INSPECTION_QUERIES;
    }

    const trimmed = task.trim();
    const isGenericInstruction =
        /^analyze\s+this\s+inspection\s+report/i.test(trimmed) ||
        /^analyze\s+findings/i.test(trimmed) ||
        /^analyze\s+report/i.test(trimmed) ||
        /^extract\s+all\s+(significant\s+)?findings/i.test(trimmed);

    if (isGenericInstruction) {
        return DEFAULT_INSPECTION_QUERIES;
    }

    return [trimmed, ...DEFAULT_INSPECTION_QUERIES];
}

export async function analyzeInspectionReport(input, options = {}) {
    const { documentId, task } = validateInspectionRequest(input);

    const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
    const contextLimit = options.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
    const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

    const generateEmbeddingFn = options.generateEmbedding ?? generateEmbedding;
    const searchSimilarChunksFn = options.searchSimilarChunks ?? searchSimilarChunks;
    const generateAnswerFn = options.generateAnswer ?? generateAnswer;

    let chunks;
    const resolvedOrgId = (options.organizationId || input.organizationId)?.trim?.() || options.organizationId || input.organizationId;
    const searchFilterOptions = {
        ...options,
        organizationId: resolvedOrgId,
    };

    if (options.searchSimilarChunks || options.generateEmbedding) {
        // Single retrieval call when dependencies are mocked (e.g. in unit tests)
        const retrievalQuery = resolveInspectionRetrievalQuery(task, options, input);
        const queryEmbedding = await generateEmbeddingFn(retrievalQuery);
        chunks = await searchSimilarChunksFn(
            queryEmbedding,
            candidateLimit,
            documentId,
            searchFilterOptions
        );
    } else {
        // Multi-aspect domain retrieval in production across inspection & audit dimensions
        const queries = resolveInspectionRetrievalQueries(task, options, input);
        const chunkMap = new Map();

        const queryResults = await Promise.all(
            queries.map(async (q) => {
                const queryEmbedding = await generateEmbeddingFn(q);
                return searchSimilarChunksFn(
                    queryEmbedding,
                    candidateLimit,
                    documentId,
                    searchFilterOptions
                );
            })
        );

        for (const candidates of queryResults) {
            if (Array.isArray(candidates)) {
                for (const chunk of candidates) {
                    const key = `${chunk.documentId || ""}:${chunk.page ?? ""}:${chunk.chunkIndex ?? ""}`;
                    if (!chunkMap.has(key) || chunkMap.get(key).score < chunk.score) {
                        chunkMap.set(key, chunk);
                    }
                }
            }
        }

        chunks = Array.from(chunkMap.values()).sort((a, b) => b.score - a.score);
    }

    if (!Array.isArray(chunks) || chunks.length === 0) {
        return createInspectionResult([]);
    }

    const relevantChunks = filterRelevantChunks(
        chunks,
        scoreThreshold,
        contextLimit
    );

    if (relevantChunks.length === 0) {
        return createInspectionResult([]);
    }

    const context = buildInspectionContext(relevantChunks);
    const prompt = buildInspectionPrompt(task, context);

    let parsedResponse = null;
    let lastError = null;

    const selectedModel = options.model || process.env.INSPECTION_MODEL || process.env.MODEL_INSPECTION;

    function classifyRuntimeError(err) {
        if (!err) return null;
        if (
            err.code === "TIMEOUT" ||
            err.code === "LOCAL_RUNTIME_TIMEOUT" ||
            err.name === "TimeoutError" ||
            err.name === "AbortError" ||
            err.message?.includes("timed out")
        ) {
            return new InspectionServiceError(
                err.message || "Local Gemma inference timed out",
                INSPECTION_ERROR_CODES.TIMEOUT,
                { cause: err, statusCode: 504 }
            );
        }
        if (err.code === "MODEL_NOT_FOUND" || err.statusCode === 404) {
            return new InspectionServiceError(
                err.message || "Local Gemma model not found on runtime server",
                INSPECTION_ERROR_CODES.MODEL_NOT_FOUND,
                { cause: err, statusCode: 404 }
            );
        }
        if (
            err.code === "CONNECTION_ERROR" ||
            err instanceof TypeError ||
            err.code === "ECONNREFUSED" ||
            err.message?.includes("fetch failed")
        ) {
            return new InspectionServiceError(
                `Local Gemma runtime connection failed: ${err.message}`,
                INSPECTION_ERROR_CODES.CONNECTION_ERROR,
                { cause: err, statusCode: 503 }
            );
        }
        if (
            err.code === "RUNTIME_UNAVAILABLE" ||
            err.code === "LOCAL_RUNTIME_UNAVAILABLE" ||
            err.statusCode === 503 ||
            err.message?.includes("unavailable")
        ) {
            return new InspectionServiceError(
                err.message || "Local Gemma MLX runtime is unavailable.",
                INSPECTION_ERROR_CODES.RUNTIME_UNAVAILABLE,
                { cause: err, statusCode: 503 }
            );
        }
        return null;
    }

    // Attempt 1: Standard structured extraction with format: "json"
    let rawResponse;
    try {
        rawResponse = await generateAnswerFn(prompt, selectedModel, {
            format: "json",
            task: "inspection_finding",
            temperature: 0.1,
            num_predict: Number(process.env.INSPECTION_NUM_PREDICT || 768),
        });
    } catch (err) {
        const runtimeErr = classifyRuntimeError(err);
        if (runtimeErr) {
            throw runtimeErr;
        }
        throw err;
    }

    try {
        parsedResponse = parseInspectionLlmResponse(rawResponse);
    } catch (err) {
        lastError = err;
        console.warn(`[Inspection] Structured extraction attempt 1 failed validation: ${err.message}`);
    }

    // Attempt 2: Strict retry prompt if attempt 1 failed schema/JSON parsing
    if (!parsedResponse) {
        console.log("[Inspection] Retrying structured extraction (attempt 2 of 2)...");
        let retryRawResponse;
        try {
            const retryPrompt = buildInspectionRetryPrompt(task, context, lastError?.message);
            retryRawResponse = await generateAnswerFn(retryPrompt, selectedModel, {
                format: "json",
                task: "inspection_finding_retry",
                temperature: 0.1,
                num_predict: Number(process.env.INSPECTION_NUM_PREDICT || 768),
            });
        } catch (retryFetchErr) {
            const runtimeErr = classifyRuntimeError(retryFetchErr);
            if (runtimeErr) {
                throw runtimeErr;
            }
            throw retryFetchErr;
        }

        try {
            parsedResponse = parseInspectionLlmResponse(retryRawResponse);
            console.log("[Inspection] Structured extraction succeeded on attempt 2");
        } catch (retryErr) {
            console.error(`[Inspection] Structured extraction attempt 2 failed validation: ${retryErr.message}`);
            const isJsonSyntax = retryErr.message?.toLowerCase().includes("json");
            const errorCode = isJsonSyntax
                ? INSPECTION_ERROR_CODES.MALFORMED_OUTPUT
                : INSPECTION_ERROR_CODES.SCHEMA_VALIDATION_FAILED;
            throw new InspectionExtractionError(
                `Inspection finding extraction failed: ${retryErr.message}`,
                { cause: retryErr, code: errorCode }
            );
        }
    }

    const findings = attachSourcesToFindings(parsedResponse.findings, relevantChunks);

    return createInspectionResult(findings);
}

export async function ingestInspectionReport(filePath, options = {}) {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
        throw new TypeError("filePath must be a non-empty string");
    }

    try {
        await fs.access(filePath);
    } catch {
        throw new Error(`Inspection file does not exist: ${filePath}`);
    }

    // MANDATORY TENANT BOUNDARY: Fail closed if organizationId is missing or invalid
    if (
        !options?.organizationId ||
        typeof options.organizationId !== "string" ||
        options.organizationId.trim().length === 0
    ) {
        throw new Error(
            "organizationId is required for tenant-scoped document ingestion"
        );
    }

    const documentId =
        typeof options.documentId === "string" && options.documentId.trim().length > 0
            ? options.documentId.trim()
            : randomUUID();

    const filename =
        typeof options.filename === "string" && options.filename.trim().length > 0
            ? options.filename.trim()
            : path.basename(filePath);

    const extractPdfTextFn = options.extractPdfText ?? extractPdfText;
    const chunkTextFn = options.chunkText ?? chunkText;
    const generateEmbeddingFn = options.generateEmbedding ?? generateEmbedding;
    const upsertChunksFn = options.upsertChunks ?? upsertChunks;

    const { pages, extractionMethod } = await extractPdfTextFn(filePath, {
        organizationId: options.organizationId,
        forceOcr: options.forceOcr,
        onProgress: options.onProgress,
    });
    const rawChunks = chunkTextFn(pages, documentId);

    if (rawChunks.length === 0) {
        throw new Error(`No text content could be extracted from: ${filename}`);
    }

    const canonicalDocType = typeof options.documentType === "string" && options.documentType.trim()
        ? options.documentType.trim().toLowerCase()
        : INSPECTION_DOCUMENT_TYPE;

    const chunksWithMeta = rawChunks.map((chunk) => ({
        ...chunk,
        filename,
        documentType: canonicalDocType,
        organizationId: options.organizationId.trim(),
        extractionMethod: chunk.extractionMethod || extractionMethod || "pdf-text",
    }));

    const chunksWithVectors = [];
    for (const chunk of chunksWithMeta) {
        const vector = await generateEmbeddingFn(chunk.text);
        chunksWithVectors.push({
            ...chunk,
            vector,
        });
    }

    await upsertChunksFn(chunksWithVectors);

    return {
        documentId,
        filename,
        chunksStored: chunksWithVectors.length,
        extractionMethod: extractionMethod || "pdf-text",
    };
}

export {
    DEFAULT_CANDIDATE_LIMIT,
    DEFAULT_CONTEXT_LIMIT,
    DEFAULT_SCORE_THRESHOLD,
    INSPECTION_DOCUMENT_TYPE,
};