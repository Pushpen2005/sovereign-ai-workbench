import crypto from "crypto";
import { query } from "../config/db.js";

/**
 * Reports Repository
 * Handles all direct SQL queries for report metadata in PostgreSQL.
 */

/**
 * Create a new report record in PostgreSQL.
 * @param {object} params
 * @param {string} [params.id] - Optional custom UUID; defaults to randomUUID()
 * @param {string} [params.documentId] - Referenced document ID
 * @param {string} params.organizationId - Scoped organization ID
 * @param {string} [params.title] - Report title
 * @param {string} params.filename - Generated report filename (e.g. Approval_Note.docx)
 * @param {string|null} [params.riskLevel] - Overall risk assessment (HIGH, MEDIUM, LOW, or null)
 * @param {string} [params.status] - Report status ('GENERATED', 'FAILED')
 * @param {string} [params.task] - Analysis task description
 * @returns {Promise<object>} Created report row
 */
export async function createReport({
  id = crypto.randomUUID(),
  documentId = null,
  organizationId,
  title = "Approval Note",
  filename,
  riskLevel = null,
  status = "GENERATED",
  task = null,
}) {
  const sql = `
    INSERT INTO reports (
      id,
      document_id,
      organization_id,
      title,
      filename,
      risk_level,
      status,
      task,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING
      id,
      document_id AS "documentId",
      organization_id AS "organizationId",
      title,
      filename,
      risk_level AS "riskLevel",
      status,
      task,
      created_at AS "createdAt",
      updated_at AS "updatedAt";
  `;

  const values = [
    id,
    documentId,
    organizationId,
    title,
    filename,
    riskLevel,
    status,
    task,
  ];

  const res = await query(sql, values);
  return res.rows[0];
}

/**
 * Fetch all reports for a specific organization, ordered by newest first.
 * Left joins with documents table to retrieve human-readable document names.
 * @param {string} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @returns {Promise<Array<object>>}
 */
export async function findReportsByOrganizationId(
  organizationId,
  { limit = 50, offset = 0 } = {}
) {
  const sql = `
    SELECT
      r.id,
      r.document_id AS "documentId",
      r.organization_id AS "organizationId",
      r.title,
      r.filename,
      r.risk_level AS "riskLevel",
      r.status,
      r.task,
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt",
      d.filename AS "documentFilename",
      d.original_filename AS "documentOriginalFilename",
      COALESCE(d.original_filename, d.filename, r.document_id, 'Inspection Report') AS "documentName",
      '/api/v1/inspection/download/' || r.filename AS "downloadUrl"
    FROM reports r
    LEFT JOIN documents d ON r.document_id = d.id
    WHERE r.organization_id = $1
    ORDER BY r.created_at DESC
    LIMIT $2 OFFSET $3;
  `;

  const res = await query(sql, [organizationId, limit, offset]);
  return res.rows;
}

/**
 * Find a specific report by its ID and organization ID.
 * @param {string} id
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function findReportById(id, organizationId) {
  const sql = `
    SELECT
      r.id,
      r.document_id AS "documentId",
      r.organization_id AS "organizationId",
      r.title,
      r.filename,
      r.risk_level AS "riskLevel",
      r.status,
      r.task,
      r.created_at AS "createdAt",
      r.updated_at AS "updatedAt",
      d.filename AS "documentFilename",
      d.original_filename AS "documentOriginalFilename",
      COALESCE(d.original_filename, d.filename, r.document_id, 'Inspection Report') AS "documentName",
      '/api/v1/inspection/download/' || r.filename AS "downloadUrl"
    FROM reports r
    LEFT JOIN documents d ON r.document_id = d.id
    WHERE r.id = $1 AND r.organization_id = $2;
  `;

  const res = await query(sql, [id, organizationId]);
  return res.rows[0] || null;
}

/**
 * Count total reports for an organization.
 * @param {string} organizationId
 * @returns {Promise<number>}
 */
export async function countReportsByOrganizationId(organizationId) {
  const sql = `
    SELECT COUNT(*)::int AS count
    FROM reports
    WHERE organization_id = $1;
  `;

  const res = await query(sql, [organizationId]);
  return res.rows[0]?.count || 0;
}
