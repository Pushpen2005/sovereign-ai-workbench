import { searchSop } from "../../../ai-service/knowledge/sop.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";
import {
  getAllDocuments,
  processAndIngestDocument,
  deleteDocumentById,
} from "../services/documents.service.js";
import { query } from "../config/db.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const MAX_QUERY_LENGTH = 2000;
const DEFAULT_SOP_SCORE_THRESHOLD = 0.5;
const MAX_KB_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * Knowledge Base Controller
 *
 * Dedicated controller for reference SOPs, procedures, safety manuals,
 * and engineering guidelines. Strictly tenant-isolated and scoped to canonical
 * documentType = "sop".
 */

/**
 * GET /api/v1/knowledge
 * Lists all Knowledge Base (SOP) documents for the authenticated organization.
 */
export async function listKnowledgeDocuments(req, res, next) {
  try {
    const organizationId = resolveAuthenticatedOrganization(req);
    const documents = await getAllDocuments(organizationId, "sop");

    return res.status(200).json({
      success: true,
      documents,
      count: documents.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/knowledge
 * Ingests an SOP / Knowledge Base PDF document into PostgreSQL and Qdrant.
 * Strictly forces canonical documentType = "sop".
 */
export async function uploadKnowledgeDocument(req, res, next) {
  try {
    const organizationId = resolveAuthenticatedOrganization(req);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FILE",
        message: "PDF document file is required under field 'document'",
      });
    }

    if (req.file.size > MAX_KB_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        code: "FILE_TOO_LARGE",
        message: "File size exceeds the 50MB maximum limit for Knowledge Base documents",
      });
    }

    const originalFilename = req.file.originalname || "knowledge_base.pdf";
    if (!originalFilename.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({
        success: false,
        code: "INVALID_FILE_TYPE",
        message: "Only PDF files are supported for Knowledge Base ingestion",
      });
    }

    const options = {
      organizationId,
      documentId: req.body?.documentId,
      filename: req.body?.filename || req.file.filename,
      originalFilename,
      documentType: "sop", // Canonical representation for Knowledge Base
    };

    const result = await processAndIngestDocument(req.file, options);

    return res.status(200).json({
      success: true,
      documentId: result.documentId,
      organizationId: result.organizationId,
      filename: result.filename,
      originalFilename: result.originalFilename,
      documentType: "sop",
      status: result.status,
      chunksStored: result.chunksStored,
      extractionMethod: result.extractionMethod || "pdf-text",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/knowledge/search
 * Executes tenant-scoped semantic retrieval across canonical documentType="sop".
 * Pure evidence retrieval — ZERO LLM generation invoked.
 */
export async function searchKnowledge(req, res, next) {
  try {
    // 1. Authenticate user & resolve authoritative organizationId
    const organizationId = resolveAuthenticatedOrganization(req);

    // 2. Validate query
    const rawQuery = req.body?.query ?? req.body?.finding ?? req.body?.q;
    if (typeof rawQuery !== "string" || rawQuery.trim().length === 0) {
      return res.status(400).json({
        success: false,
        code: "INVALID_QUERY",
        message: "Query must be a non-empty string",
      });
    }

    const trimmedQuery = rawQuery.trim();
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({
        success: false,
        code: "QUERY_TOO_LONG",
        message: `Query exceeds maximum allowed length of ${MAX_QUERY_LENGTH} characters`,
      });
    }

    // 3. Validate and bound topK / limit
    let topK = DEFAULT_TOP_K;
    const rawTopK = req.body?.topK ?? req.body?.limit;
    if (rawTopK !== undefined && rawTopK !== null) {
      const parsed = Number.parseInt(rawTopK, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          code: "INVALID_LIMIT",
          message: "topK must be a positive integer between 1 and 20",
        });
      }
      topK = Math.min(parsed, MAX_TOP_K);
    }

    // 4. Validate scoreThreshold if provided (defaults to 0.50 canonical SOP threshold)
    let scoreThreshold = DEFAULT_SOP_SCORE_THRESHOLD;
    if (req.body?.scoreThreshold !== undefined && req.body?.scoreThreshold !== null) {
      const parsedScore = Number.parseFloat(req.body.scoreThreshold);
      if (Number.isNaN(parsedScore) || parsedScore < 0 || parsedScore > 1) {
        return res.status(400).json({
          success: false,
          code: "INVALID_SCORE_THRESHOLD",
          message: "scoreThreshold must be a number between 0.0 and 1.0",
        });
      }
      scoreThreshold = parsedScore;
    }

    // 5. Execute semantic search over canonical documentType="sop" in Qdrant
    const rawResults = await searchSop(trimmedQuery, {
      organizationId,
      limit: topK,
      scoreThreshold,
    });

    // 6. Format results according to canonical contract
    const results = (rawResults || []).map((item) => ({
      text: item.text,
      score: typeof item.score === "number" ? Math.round(item.score * 10000) / 10000 : item.score,
      documentId: item.documentId || null,
      filename: item.filename || null,
      page: item.page ?? 1,
      chunkIndex: item.chunkIndex ?? 0,
      documentType: "sop",
      source: item.source || item.extractionMethod || "pdf-text",
      extractionMethod: item.extractionMethod || "pdf-text",
    }));

    return res.status(200).json({
      success: true,
      query: trimmedQuery,
      results,
      total: results.length,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/v1/knowledge/:id
 * Removes a Knowledge Base document, its PostgreSQL record, and its Qdrant vectors.
 * Strictly verifies tenant ownership before deletion.
 */
export async function deleteKnowledgeDocument(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string" || !id.trim()) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ID",
        message: "Valid document ID is required",
      });
    }

    const organizationId = resolveAuthenticatedOrganization(req);
    const cleanDocId = id.trim();

    // Check if document exists and verify tenant ownership
    const docCheck = await query(
      "SELECT id, organization_id, document_type FROM documents WHERE id = $1",
      [cleanDocId]
    );

    if (docCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "DOCUMENT_NOT_FOUND",
        message: `Knowledge Base document with ID '${cleanDocId}' not found`,
      });
    }

    const doc = docCheck.rows[0];
    if (doc.organization_id !== organizationId) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Forbidden: Knowledge Base document belongs to another organization",
      });
    }

    await deleteDocumentById(cleanDocId, organizationId);

    return res.status(200).json({
      success: true,
      message: `Knowledge Base document '${cleanDocId}' deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
}

