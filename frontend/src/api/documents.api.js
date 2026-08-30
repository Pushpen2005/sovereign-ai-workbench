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

import { get, postForm } from './client.js';

/**
 * Fetch all persisted documents from PostgreSQL metadata store.
 * @returns {Promise<{ success: boolean, documents: Array }>}
 */
export function fetchDocuments() {
  return get('/api/v1/documents');
}

/**
 * Upload a PDF file and ingest it into Qdrant + PostgreSQL in a single call.
 *
 * @param {File} file - A PDF File object from the browser
 * @returns {Promise<{ success: boolean, documentId: string, filename: string, originalFilename?: string, chunksStored: number }>}
 */
export function uploadDocument(file) {
  const form = new FormData();
  form.append('document', file);         // field name MUST be "document"
  return postForm('/api/v1/documents', form);
}
