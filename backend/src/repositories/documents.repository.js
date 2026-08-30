import { query } from "../config/db.js";

/**
 * Documents Repository
 * Handles all direct SQL queries for document metadata in PostgreSQL.
 */

export async function createDocument({
  id,
  filename,
  originalFilename,
  status = "Processing",
  chunksStored = 0,
}) {
  const sql = `
    INSERT INTO documents (id, filename, original_filename, status, chunks_stored, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING *;
  `;
  const values = [id, filename, originalFilename, status, chunksStored];
  const res = await query(sql, values);
  return res.rows[0];
}

export async function updateDocument(id, { status, chunksStored }) {
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

  const sql = `
    UPDATE documents
    SET ${updates.join(", ")}
    WHERE id = $1
    RETURNING *;
  `;

  const res = await query(sql, values);
  return res.rows[0] || null;
}

export async function getDocumentById(id) {
  const sql = `SELECT * FROM documents WHERE id = $1;`;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
}

export async function getAllDocuments() {
  const sql = `
    SELECT id, filename, original_filename, status, chunks_stored, created_at, updated_at
    FROM documents
    ORDER BY created_at DESC;
  `;
  const res = await query(sql);
  return res.rows;
}

export async function upsertDocument({
  id,
  filename,
  originalFilename,
  status = "Processing",
  chunksStored = 0,
}) {
  const sql = `
    INSERT INTO documents (id, filename, original_filename, status, chunks_stored, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      filename = EXCLUDED.filename,
      original_filename = EXCLUDED.original_filename,
      status = EXCLUDED.status,
      chunks_stored = EXCLUDED.chunks_stored,
      updated_at = NOW()
    RETURNING *;
  `;
  const values = [id, filename, originalFilename, status, chunksStored];
  const res = await query(sql, values);
  return res.rows[0];
}
