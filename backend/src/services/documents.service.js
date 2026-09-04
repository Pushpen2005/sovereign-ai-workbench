import path from "path";
import fs from "fs";
import crypto from "crypto";
import { query } from "../config/db.js";
import {
  getDocumentStoragePath,
  getOrganizationUploadDir,
  safeDeleteFile,
  validateFilename,
  assertPathContained,
  UPLOADS_ROOT,
} from "../utils/storage.js";
import { deleteChunksByDocumentId } from "../../../ai-service/vectorstore/qdrant.service.js";

import {
  createDocument,
  updateDocument,
  getAllDocuments as fetchAllDocuments,
  getDocumentById as fetchDocumentById,
  upsertDocument,
  deleteDocumentRecord,
} from "../repositories/documents.repository.js";

import { ingestInspectionFile } from "./inspection.service.js";

/**
 * Documents Service
 * Orchestrates business logic, persistence in PostgreSQL,
 * and calls the existing ingestion/RAG pipeline.
 */

/**
 * Get all documents belonging to an organization.
 */
export async function getAllDocuments(organizationId) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("Invalid organization ID");
  }

  const rows = await fetchAllDocuments(organizationId.trim());

  return rows.map((row) => ({
    documentId: row.id,
    organizationId: row.organization_id,
    filename: row.filename,
    originalFilename: row.original_filename,
    status: row.status,
    chunksStored: row.chunks_stored,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get a document by ID.
 */
export async function getDocumentById(id, organizationId) {
  if (!id || typeof id !== "string") {
    throw new Error("Invalid document ID");
  }

  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("Invalid organization ID");
  }

  const row = await fetchDocumentById(
    id.trim(),
    organizationId.trim()
  );

  if (!row) return null;

  return {
    documentId: row.id,
    organizationId: row.organization_id,
    filename: row.filename,
    originalFilename: row.original_filename,
    status: row.status,
    chunksStored: row.chunks_stored,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ingests a document, tracking lifecycle in PostgreSQL:
 *
 * 1. Status -> 'Processing'
 * 2. Run existing extraction -> chunking -> embedding -> Qdrant
 * 3. On success -> 'Indexed' with chunks_stored count
 * 4. On failure -> 'Failed'
 */
export async function processAndIngestDocument(
  target,
  options = {}
) {
  let documentId = options.documentId;
  let filename = options.filename;
  let originalFilename =
    options.originalFilename || options.filename;

  // Organization ID must come from authenticated backend context.
  const organizationId = options.organizationId;

  if (
    !organizationId ||
    typeof organizationId !== "string"
  ) {
    throw new Error("Organization ID is required");
  }

  let targetInput = target;

  if (
    target &&
    typeof target === "object" &&
    target.path
  ) {
    // Multer file object
    const ext = path.extname(
      target.filename ||
        target.originalname ||
        ".pdf"
    );

    documentId =
      documentId ||
      path.basename(
        target.filename ||
          target.originalname,
        ext
      );

    filename =
      target.filename ||
      `${documentId}${ext}`;

    originalFilename =
      target.originalname ||
      filename;

    targetInput = target.path;
  } else if (typeof target === "string") {
    // Path or documentId string
    const ext = path.extname(target);

    if (!documentId) {
      documentId = ext
        ? path.basename(target, ext)
        : target;
    }

    filename =
      filename ||
      path.basename(target);

    originalFilename =
      originalFilename ||
      filename;
  } else if (
    target &&
    typeof target === "object"
  ) {
    documentId =
      documentId ||
      target.documentId ||
      crypto.randomUUID();

    filename =
      filename ||
      target.filename ||
      `${documentId}.pdf`;

    originalFilename =
      originalFilename ||
      target.originalFilename ||
      target.filename ||
      filename;
  }

  if (!documentId) {
    documentId = crypto.randomUUID();
  }

  if (!filename) {
    filename = `${documentId}.pdf`;
  }

  if (!originalFilename) {
    originalFilename = filename;
  }

  // 1. Create PostgreSQL record with status "Processing"
  try {
    await upsertDocument({
      id: documentId,
      organizationId,
      filename,
      originalFilename,
      status: "Processing",
      chunksStored: 0,
    });
  } catch (dbErr) {
    console.error(
      "Failed to initialize document record in PostgreSQL:",
      dbErr?.message
    );

    throw new Error(
      `Database connection or operation failed: ${dbErr?.message}`
    );
  }

  // 2. Run existing PDF -> extraction -> chunking ->
  //    embedding -> Qdrant pipeline
  try {
    const ingestResult =
      await ingestInspectionFile(targetInput, {
        ...options,
        documentId,
        organizationId,
        filename: originalFilename,
      });

    const chunksStored =
      ingestResult?.chunksStored || 0;

    // 3. If successful, update PostgreSQL
    await updateDocument(documentId, {
      status: "Indexed",
      chunksStored,
    });

    return {
      documentId,
      organizationId,
      filename,
      originalFilename,
      status: "Indexed",
      chunksStored,
    };
  } catch (error) {
    // 4. If processing fails, update PostgreSQL
    try {
      await updateDocument(documentId, {
        status: "Failed",
      });
    } catch (updateErr) {
      console.error(
        "Failed to update document status to Failed:",
        updateErr?.message
      );
    }

    throw error;
  }
}

/**
 * Resolves the physical file path for downloading a document.
 * Strictly verifies tenant authorization in PostgreSQL and containment inside uploads/<organizationId>/.
 *
 * @param {string} documentId
 * @param {string} organizationId
 * @returns {Promise<{ filePath: string, filename: string, originalFilename: string }>}
 */
export async function getDocumentDownloadPath(documentId, organizationId) {
  if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
    const error = new Error("documentId must be a non-empty string");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const cleanDocId = documentId.trim();
  if (cleanDocId.includes("/") || cleanDocId.includes("\\") || cleanDocId.includes("..") || cleanDocId.includes("\0") || cleanDocId.includes("%2e")) {
    const error = new Error("Access Denied: Path traversal detected in documentId");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    const error = new Error("organizationId is required");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const cleanOrgId = organizationId.trim();

  // 1. Verify ownership in PostgreSQL
  const docCheck = await query(
    "SELECT id, organization_id, filename, original_filename FROM documents WHERE id = $1 AND organization_id = $2",
    [cleanDocId, cleanOrgId]
  );

  if (docCheck.rows.length === 0) {
    // Check if document belongs to a foreign organization
    const foreignCheck = await query(
      "SELECT id, organization_id FROM documents WHERE id = $1",
      [cleanDocId]
    );
    if (foreignCheck.rows.length > 0) {
      const error = new Error("Forbidden: document belongs to another organization");
      error.status = 403;
      error.statusCode = 403;
      throw error;
    }

    const error = new Error(`Document '${cleanDocId}' not found`);
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  const doc = docCheck.rows[0];

  // 2. Derive path inside tenant upload directory
  const tenantFilePath = getDocumentStoragePath(cleanOrgId, doc.filename);
  let finalPath = tenantFilePath;

  if (!fs.existsSync(finalPath)) {
    // Fallback to legacy root uploads for pre-migration demo records
    const legacyPath = path.resolve(UPLOADS_ROOT, doc.filename);
    if (fs.existsSync(legacyPath)) {
      assertPathContained(legacyPath, UPLOADS_ROOT);
      finalPath = legacyPath;
    } else {
      const error = new Error(`Document file '${doc.filename}' not found on storage`);
      error.status = 404;
      error.statusCode = 404;
      throw error;
    }
  }

  return {
    filePath: finalPath,
    filename: doc.filename,
    originalFilename: doc.original_filename || doc.filename,
  };
}

/**
 * Resolves the physical file path by filename for the authenticated organization.
 *
 * @param {string} filename
 * @param {string} organizationId
 * @returns {Promise<{ filePath: string, filename: string, originalFilename: string }>}
 */
export async function getDocumentDownloadPathByFilename(filename, organizationId) {
  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    const error = new Error("organizationId is required");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const cleanOrgId = organizationId.trim();
  let safeFilename;
  try {
    safeFilename = validateFilename(filename);
  } catch (valErr) {
    const error = new Error(valErr.message);
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  // 1. Verify ownership in PostgreSQL
  const docCheck = await query(
    "SELECT id, organization_id, filename, original_filename FROM documents WHERE (filename = $1 OR original_filename = $1) AND organization_id = $2 LIMIT 1",
    [safeFilename, cleanOrgId]
  );

  if (docCheck.rows.length === 0) {
    const foreignCheck = await query(
      "SELECT id, organization_id FROM documents WHERE filename = $1 OR original_filename = $1 LIMIT 1",
      [safeFilename]
    );
    if (foreignCheck.rows.length > 0) {
      const error = new Error("Forbidden: document belongs to another organization");
      error.status = 403;
      error.statusCode = 403;
      throw error;
    }

    const error = new Error(`Document file '${safeFilename}' not found for organization`);
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  const doc = docCheck.rows[0];
  const tenantFilePath = getDocumentStoragePath(cleanOrgId, doc.filename);
  let finalPath = tenantFilePath;

  if (!fs.existsSync(finalPath)) {
    const legacyPath = path.resolve(UPLOADS_ROOT, doc.filename);
    if (fs.existsSync(legacyPath)) {
      assertPathContained(legacyPath, UPLOADS_ROOT);
      finalPath = legacyPath;
    } else {
      const error = new Error(`Document file '${doc.filename}' not found on storage`);
      error.status = 404;
      error.statusCode = 404;
      throw error;
    }
  }

  return {
    filePath: finalPath,
    filename: doc.filename,
    originalFilename: doc.original_filename || doc.filename,
  };
}

/**
 * Deletes a document:
 * 1. Checks ownership in PostgreSQL.
 * 2. Unlinks physical file inside tenant upload directory.
 * 3. Deletes Qdrant vectors scoped to (documentId, organizationId).
 * 4. Deletes PostgreSQL record.
 *
 * @param {string} documentId
 * @param {string} organizationId
 * @returns {Promise<boolean>}
 */
export async function deleteDocumentById(documentId, organizationId) {
  if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
    const error = new Error("documentId must be a non-empty string");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const cleanDocId = documentId.trim();
  if (cleanDocId.includes("/") || cleanDocId.includes("\\") || cleanDocId.includes("..") || cleanDocId.includes("\0") || cleanDocId.includes("%2e")) {
    const error = new Error("Access Denied: Path traversal detected in documentId");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    const error = new Error("organizationId is required");
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const cleanOrgId = organizationId.trim();

  // 1. Verify ownership in PostgreSQL
  const docCheck = await query(
    "SELECT id, organization_id, filename FROM documents WHERE id = $1 AND organization_id = $2",
    [cleanDocId, cleanOrgId]
  );

  if (docCheck.rows.length === 0) {
    const foreignCheck = await query(
      "SELECT id FROM documents WHERE id = $1",
      [cleanDocId]
    );
    if (foreignCheck.rows.length > 0) {
      const error = new Error("Forbidden: document belongs to another organization");
      error.status = 403;
      error.statusCode = 403;
      throw error;
    }

    const error = new Error(`Document '${cleanDocId}' not found`);
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  const doc = docCheck.rows[0];

  // 2. Safely unlink physical file from tenant directory
  try {
    const tenantUploadDir = getOrganizationUploadDir(cleanOrgId, { create: false });
    const tenantFilePath = getDocumentStoragePath(cleanOrgId, doc.filename);
    safeDeleteFile(tenantFilePath, tenantUploadDir);
  } catch (fsErr) {
    console.warn(`[DocumentsService] Warning during physical file deletion: ${fsErr.message}`);
  }

  // 3. Delete Qdrant vectors strictly scoped to (documentId, organizationId)
  try {
    await deleteChunksByDocumentId(cleanDocId, cleanOrgId);
  } catch (vecErr) {
    console.warn(`[DocumentsService] Warning during vector deletion: ${vecErr.message}`);
  }

  // 4. Delete PostgreSQL record
  await deleteDocumentRecord(cleanDocId, cleanOrgId);

  return true;
}