import { query } from "../config/db.js";

/**
 * Authoritative Knowledge Base SOP Gate
 *
 * PostgreSQL is the sole authoritative source of truth for whether SOP
 * evidence exists for an organization.
 *
 * Required invariant:
 * IF:
 *   PostgreSQL has zero active Knowledge Base documents for organizationId
 *   OR
 *   there are zero approved/indexed SOP documents for organizationId
 * THEN:
 *   Qdrant SOP retrieval MUST NOT return evidence.
 *   Instead return:
 *   {
 *     evidenceAvailable: false,
 *     approvedSopCount: 0,
 *     allowedDocumentIds: [],
 *     reason: "knowledge_base_empty"
 *   }
 *
 * Condition:
 *   organization_id = authenticated organizationId
 *   AND document_type = 'sop'
 *   AND status = 'Indexed'
 *   AND chunks_stored > 0
 *
 * @param {string} organizationId
 * @returns {Promise<{
 *   evidenceAvailable: boolean,
 *   approvedSopCount: number,
 *   allowedDocumentIds: string[],
 *   reason: string|null
 * }>}
 */
export async function checkKnowledgeBaseSopGate(organizationId) {
  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    console.log(`[KB_GATE] organizationId=${organizationId || "missing"} approvedSopCount=0 qdrantSearch=SKIPPED reason=invalid_organization_id`);
    return {
      evidenceAvailable: false,
      approvedSopCount: 0,
      allowedDocumentIds: [],
      reason: "invalid_organization_id",
    };
  }

  const cleanOrgId = organizationId.trim();

  try {
    const res = await query(
      `SELECT id, status, chunks_stored
       FROM documents
       WHERE organization_id = $1
         AND document_type = 'sop'
         AND status = 'Indexed'
         AND chunks_stored > 0`,
      [cleanOrgId]
    );

    const rows = res?.rows || [];
    const allowedDocumentIds = rows.map((r) => r.id);

    if (allowedDocumentIds.length === 0) {
      console.log(`[KB_GATE] organizationId=${cleanOrgId} approvedSopCount=0 qdrantSearch=SKIPPED reason=knowledge_base_empty`);
      return {
        evidenceAvailable: false,
        approvedSopCount: 0,
        allowedDocumentIds: [],
        reason: "knowledge_base_empty",
      };
    }

    console.log(`[KB_GATE] organizationId=${cleanOrgId} approvedSopCount=${allowedDocumentIds.length} allowedDocumentIds=${JSON.stringify(allowedDocumentIds)} qdrantSearch=ENABLED`);
    return {
      evidenceAvailable: true,
      approvedSopCount: allowedDocumentIds.length,
      allowedDocumentIds,
      reason: null,
    };
  } catch (dbErr) {
    console.error(`[KB_GATE] Database query error for organizationId=${cleanOrgId}:`, dbErr.message);
    // Fail closed
    return {
      evidenceAvailable: false,
      approvedSopCount: 0,
      allowedDocumentIds: [],
      reason: "database_error",
    };
  }
}
