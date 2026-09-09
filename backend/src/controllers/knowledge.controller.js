import { searchSop } from "../../../ai-service/knowledge/sop.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;
const MAX_QUERY_LENGTH = 2000;

/**
 * Knowledge Base Controller
 *
 * Exposes interactive semantic search over the tenant-scoped SOP/knowledge base.
 * Purely exploratory / verification retrieval — ZERO LLM inference invoked.
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

    // 4. Validate scoreThreshold if provided (defaults to 0.0 for exploratory search)
    let scoreThreshold = 0.0;
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
