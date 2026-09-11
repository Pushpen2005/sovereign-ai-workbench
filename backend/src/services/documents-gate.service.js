import { query } from "../config/db.js";

/**
 * Authoritative Documents Gate
 *
 * PostgreSQL is the sole authoritative source of truth for whether active
 * uploaded documents are available for normal AI Search / Document Chat.
 *
 * Invariant:
 * IF:
 *   PostgreSQL has zero active documents for organizationId
 *   OR
 *   the requested documentId does not exist / is deleted / is not Indexed / chunks <= 0
 * THEN:
 *   Retrieval, Qdrant search, and Gemma MLX invocation MUST be SKIPPED.
 *   Deterministic no-evidence response must be returned:
 *   {
 *     available: false,
 *     count: 0,
 *     allowedDocumentIds: [],
 *     reason: "no_documents_available"
 *   }
 *
 * Required document status:
 *   organization_id = authenticated organizationId
 *   AND status = 'Indexed'
 *   AND chunks_stored > 0
 *
 * @param {string} organizationId
 * @param {string|null|undefined} [documentId]
 * @returns {Promise<{
 *   available: boolean,
 *   count: number,
 *   allowedDocumentIds: string[],
 *   forbidden?: boolean,
 *   reason: string,
 *   document?: object
 * }>}
 */
export async function checkDocumentsGate(organizationId, documentId = null) {
  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    console.log(
      `[DOC_GATE] organizationId=${organizationId || "missing"} activeDocCount=0 qdrantSearch=SKIPPED reason=invalid_organization_id`
    );
    return {
      available: false,
      count: 0,
      allowedDocumentIds: [],
      reason: "invalid_organization_id",
    };
  }

  const cleanOrgId = organizationId.trim();
  const cleanDocId = typeof documentId === "string" && documentId.trim() ? documentId.trim() : null;

  try {
    if (cleanDocId) {
      // Specific document requested
      const docRes = await query(
        `SELECT id, organization_id, filename, original_filename, status, chunks_stored, document_type
         FROM documents
         WHERE id = $1`,
        [cleanDocId]
      );

      const rows = docRes?.rows || [];
      if (rows.length === 0) {
        console.log(
          `[DOC_GATE] organizationId=${cleanOrgId} documentId=${cleanDocId} docFound=false qdrantSearch=SKIPPED reason=no_documents_available`
        );
        return {
          available: false,
          count: 0,
          allowedDocumentIds: [],
          reason: "no_documents_available",
          notFound: true,
        };
      }

      const doc = rows[0];
      if (doc.organization_id !== cleanOrgId) {
        console.warn(
          `[DOC_GATE] Cross-tenant violation attempt: caller org=${cleanOrgId} requested doc org=${doc.organization_id} docId=${cleanDocId}`
        );
        return {
          available: false,
          count: 0,
          allowedDocumentIds: [],
          forbidden: true,
          reason: "forbidden_tenant",
        };
      }

      // Check if document is active/indexed
      const isIndexed = doc.status === "Indexed" && Number(doc.chunks_stored) > 0;
      if (!isIndexed) {
        console.log(
          `[DOC_GATE] organizationId=${cleanOrgId} documentId=${cleanDocId} status=${doc.status} chunks=${doc.chunks_stored} qdrantSearch=SKIPPED reason=no_documents_available`
        );
        return {
          available: false,
          count: 0,
          allowedDocumentIds: [],
          reason: "no_documents_available",
          notReady: true,
        };
      }

      console.log(
        `[DOC_GATE] organizationId=${cleanOrgId} documentId=${cleanDocId} activeDocCount=1 qdrantSearch=ENABLED`
      );
      return {
        available: true,
        count: 1,
        allowedDocumentIds: [doc.id],
        reason: "ok",
        document: doc,
      };
    }

    // General AI Search across document library
    const listRes = await query(
      `SELECT id, filename, status, chunks_stored
       FROM documents
       WHERE organization_id = $1
         AND status = 'Indexed'
         AND chunks_stored > 0`,
      [cleanOrgId]
    );

    const activeRows = listRes?.rows || [];
    const allowedDocumentIds = activeRows.map((r) => r.id);

    if (allowedDocumentIds.length === 0) {
      console.log(
        `[DOC_GATE] organizationId=${cleanOrgId} activeDocCount=0 qdrantSearch=SKIPPED reason=no_documents_available`
      );
      return {
        available: false,
        count: 0,
        allowedDocumentIds: [],
        reason: "no_documents_available",
      };
    }

    console.log(
      `[DOC_GATE] organizationId=${cleanOrgId} activeDocCount=${allowedDocumentIds.length} qdrantSearch=ENABLED`
    );
    return {
      available: true,
      count: allowedDocumentIds.length,
      allowedDocumentIds,
      reason: "ok",
    };
  } catch (dbErr) {
    console.error(
      `[DOC_GATE] Database query error for organizationId=${cleanOrgId}:`,
      dbErr.message
    );
    // Fail closed
    return {
      available: false,
      count: 0,
      allowedDocumentIds: [],
      reason: "database_error",
    };
  }
}
