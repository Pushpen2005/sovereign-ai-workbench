/**
 * API LAYER — documents.api.js
 *
 * Maps backend inspection/document endpoints.
 * NO React state. NO UI logic.
 *
 * Backend endpoint (PR #17):
 *   POST /api/v1/inspection/ingest
 *     multipart/form-data  field: "document"
 *     → { success, documentId, filename, chunksStored }
 */

import { get, postForm, del } from './client.js';

/**
 * Fetch persisted documents from PostgreSQL metadata store, optionally filtered by documentType.
 * @param {string} [documentType] - Optional filter ('sop' | 'inspection' | 'other')
 * @returns {Promise<{ success: boolean, documents: Array }>}
 */
export function fetchDocuments(documentType) {
  const path = documentType && typeof documentType === 'string' && documentType.trim()
    ? `/api/v1/documents?documentType=${encodeURIComponent(documentType.trim().toLowerCase())}`
    : '/api/v1/documents';
  return get(path);
}

/**
 * Upload a PDF file and ingest it into Qdrant + PostgreSQL in a single call.
 *
 * @param {File} file - A PDF File object from the browser
 * @param {string} [documentType] - Canonical document type ('sop' | 'inspection' | 'other')
 * @returns {Promise<{ success: boolean, documentId: string, filename: string, originalFilename?: string, documentType?: string, chunksStored: number }>}
 */
export function uploadDocument(file, documentType) {
  const form = new FormData();
  form.append('document', file);         // field name MUST be "document"
  if (documentType && typeof documentType === 'string' && documentType.trim()) {
    form.append('documentType', documentType.trim().toLowerCase());
  }
  return postForm('/api/v1/documents', form);
}

/**
 * Delete a document by ID (removes PostgreSQL record, tenant physical file, and Qdrant vectors).
 * @param {string} documentId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export function deleteDocument(documentId) {
  if (!documentId) throw new Error('Document ID is required for deletion');
  return del(`/api/v1/documents/${encodeURIComponent(documentId)}`);
}

