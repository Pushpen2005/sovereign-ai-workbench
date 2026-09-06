import { query } from "../config/db.js";

/**
 * Documents Repository
 * Handles all direct SQL queries for document metadata in PostgreSQL.
 */

/**
 * Create or update a document.
 */
export async function createDocument({
  id,
  organizationId,
  filename,
  originalFilename,
  documentType = "inspection",
  status = "Processing",
  chunksStored = 0,
  extractionMethod = "pdf-text",
}) {
  const sql = `
    INSERT INTO documents (
      id,
      organization_id,
      filename,
      original_filename,
      document_type,
      status,
      chunks_stored,
      extraction_method,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      filename = EXCLUDED.filename,
      original_filename = EXCLUDED.original_filename,
      document_type = COALESCE(EXCLUDED.document_type, documents.document_type),
      status = EXCLUDED.status,
      chunks_stored = EXCLUDED.chunks_stored,
      extraction_method = COALESCE(EXCLUDED.extraction_method, documents.extraction_method),
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    id,
    organizationId,
    filename,
    originalFilename,
    documentType,
    status,
    chunksStored,
    extractionMethod,
  ];

  const res = await query(sql, values);

  return res.rows[0];
}

/**
 * Update document processing status/chunk count.
 */
export async function updateDocument(
  id,
  { status, chunksStored, extractionMethod }
) {
  const updates = ["updated_at = NOW()"];
  const values = [id];

  let paramIndex = 2;

  if (status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(status);
  }

  if (chunksStored !== undefined) {
    updates.push(`chunks_stored = $${paramIndex++}`);
    values.push(chunksStored);
  }

  if (extractionMethod !== undefined) {
    updates.push(`extraction_method = $${paramIndex++}`);
    values.push(extractionMethod);
  }

  const sql = `
    UPDATE documents
    SET ${updates.join(", ")}
    WHERE id = $1
    RETURNING *;
  `;

  const res = await query(sql, values);

  return res.rows[0] || null;
}

/**
 * Get a document by ID.
 */
export async function getDocumentById(
  id,
  organizationId
) {
  const sql = `
    SELECT *
    FROM documents
    WHERE id = $1
      AND organization_id = $2;
  `;

  const res = await query(sql, [
    id,
    organizationId,
  ]);

  return res.rows[0] || null;
}

/**
 * Get all documents.
 *
 * NOTE:
 * For multi-tenant security, this should eventually
 * accept organizationId and filter by it.
 */
export async function getAllDocuments(organizationId, documentType = null) {
  const values = [organizationId];
  let whereClause = "WHERE organization_id = $1";

  if (documentType && typeof documentType === "string" && documentType.trim() !== "") {
    whereClause += " AND document_type = $2";
    values.push(documentType.trim().toLowerCase());
  }

  const sql = `
    SELECT
      id,
      organization_id,
      filename,
      original_filename,
      document_type,
      status,
      chunks_stored,
      extraction_method,
      created_at,
      updated_at
    FROM documents
    ${whereClause}
    ORDER BY created_at DESC;
  `;

  const res = await query(sql, values);

  return res.rows;
}

/**
 * Create or update a document.
 */
export async function upsertDocument({
  id,
  organizationId,
  filename,
  originalFilename,
  documentType = "inspection",
  status = "Processing",
  chunksStored = 0,
}) {
  const sql = `
    INSERT INTO documents (
      id,
      organization_id,
      filename,
      original_filename,
      document_type,
      status,
      chunks_stored,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      filename = EXCLUDED.filename,
      original_filename = EXCLUDED.original_filename,
      document_type = COALESCE(EXCLUDED.document_type, documents.document_type),
      status = EXCLUDED.status,
      chunks_stored = EXCLUDED.chunks_stored,
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    id,
    organizationId,
    filename,
    originalFilename,
    documentType,
    status,
    chunksStored,
  ];

  const res = await query(sql, values);

  return res.rows[0];
}

/**
 * Delete a document record scoped to organization.
 */
export async function deleteDocumentRecord(id, organizationId) {
  const sql = `
    DELETE FROM documents
    WHERE id = $1 AND organization_id = $2
    RETURNING *;
  `;
  const res = await query(sql, [id, organizationId]);
  return res.rows[0] || null;
}