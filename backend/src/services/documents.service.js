import path from "path";
import crypto from "crypto";
import {
  createDocument,
  updateDocument,
  getAllDocuments as fetchAllDocuments,
  getDocumentById as fetchDocumentById,
  upsertDocument,
} from "../repositories/documents.repository.js";
import { ingestInspectionFile } from "./inspection.service.js";

/**
 * Documents Service
 * Orchestrates business logic, persistence in PostgreSQL,
 * and calls the existing ingestion/RAG pipeline.
 */

export async function getAllDocuments() {
  const rows = await fetchAllDocuments();
  return rows.map((row) => ({
    documentId: row.id,
    filename: row.filename,
    originalFilename: row.original_filename,
    status: row.status,
    chunksStored: row.chunks_stored,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getDocumentById(id) {
  if (!id || typeof id !== "string") {
    throw new Error("Invalid document ID");
  }
  const row = await fetchDocumentById(id.trim());
  if (!row) return null;

  return {
    documentId: row.id,
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
 * 1. Status -> 'Processing'
 * 2. Run existing extraction -> chunking -> embedding -> Qdrant
 * 3. On success -> 'Indexed' with chunks_stored count
 * 4. On failure -> 'Failed'
 */
export async function processAndIngestDocument(target, options = {}) {
  let documentId = options.documentId;
  let filename = options.filename; // stored filename or fallback
  let originalFilename = options.originalFilename || options.filename;
  let targetInput = target;

  if (target && typeof target === "object" && target.path) {
    // Multer file object
    const ext = path.extname(target.filename || target.originalname || ".pdf");
    documentId =
      documentId ||
      path.basename(target.filename || target.originalname, ext);
    filename = target.filename || `${documentId}${ext}`;
    originalFilename = target.originalname || filename;
    targetInput = target.path;
  } else if (typeof target === "string") {
    // Path or documentId string
    const ext = path.extname(target);
    if (!documentId) {
      documentId = ext ? path.basename(target, ext) : target;
    }
    filename = filename || path.basename(target);
    originalFilename = originalFilename || filename;
  } else if (target && typeof target === "object") {
    documentId = documentId || target.documentId || crypto.randomUUID();
    filename = filename || target.filename || `${documentId}.pdf`;
    originalFilename = originalFilename || target.originalFilename || target.filename || filename;
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
      filename,
      originalFilename,
      status: "Processing",
      chunksStored: 0,
    });
  } catch (dbErr) {
    console.error("Failed to initialize document record in PostgreSQL:", dbErr.message);
    // Continue ingestion or let caller handle DB failure
    throw new Error(`Database connection or operation failed: ${dbErr.message}`);
  }

  // 2. Run existing PDF -> extraction -> chunking -> embedding -> Qdrant pipeline
  try {
    const ingestResult = await ingestInspectionFile(targetInput, {
      ...options,
      documentId,
      filename: originalFilename,
    });

    const chunksStored = ingestResult.chunksStored || 0;

    // 3. If successful, update PostgreSQL with status "Indexed"
    await updateDocument(documentId, {
      status: "Indexed",
      chunksStored,
    });

    return {
      documentId,
      filename,
      originalFilename,
      status: "Indexed",
      chunksStored,
    };
  } catch (error) {
    // 4. If processing fails, update PostgreSQL with status "Failed"
    try {
      await updateDocument(documentId, {
        status: "Failed",
      });
    } catch (updateErr) {
      console.error("Failed to update document status to Failed:", updateErr.message);
    }
    throw error;
  }
}
