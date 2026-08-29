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
    buildInspectionContext,
} from "./inspection.prompt.js";
import {
    attachSourcesToFindings,
    parseInspectionLlmResponse,
} from "./inspection.schema.js";

const INSPECTION_DOCUMENT_TYPE = "inspection";

const DEFAULT_CANDIDATE_LIMIT = 10;
const DEFAULT_CONTEXT_LIMIT = 5;
const DEFAULT_SCORE_THRESHOLD = 0.5;

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

export async function analyzeInspectionReport(input, options = {}) {
    const { documentId, task } = validateInspectionRequest(input);

    const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
    const contextLimit = options.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
    const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

    const generateEmbeddingFn = options.generateEmbedding ?? generateEmbedding;
    const searchSimilarChunksFn = options.searchSimilarChunks ?? searchSimilarChunks;
    const generateAnswerFn = options.generateAnswer ?? generateAnswer;

    const queryEmbedding = await generateEmbeddingFn(task);

    const chunks = await searchSimilarChunksFn(
        queryEmbedding,
        candidateLimit,
        documentId
    );

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
    const rawResponse = await generateAnswerFn(prompt, options.model);
    const parsedResponse = parseInspectionLlmResponse(rawResponse);
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

    const { pages } = await extractPdfTextFn(filePath);
    const rawChunks = chunkTextFn(pages, documentId);

    if (rawChunks.length === 0) {
        throw new Error(`No text content could be extracted from: ${filename}`);
    }

    const chunksWithMeta = rawChunks.map((chunk) => ({
        ...chunk,
        filename,
        documentType: INSPECTION_DOCUMENT_TYPE,
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
    };
}

export {
    DEFAULT_CANDIDATE_LIMIT,
    DEFAULT_CONTEXT_LIMIT,
    DEFAULT_SCORE_THRESHOLD,
    INSPECTION_DOCUMENT_TYPE,
};