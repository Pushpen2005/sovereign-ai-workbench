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

import { postForm } from './client.js';

/**
 * Upload a PDF file and ingest it into Qdrant in a single call.
 *
 * The backend controller at POST /api/v1/inspection/ingest accepts a multipart
 * file, extracts text (OCR fallback), chunks, embeds (384-d), and upserts to
 * Qdrant — all in one request.
 *
 * @param {File} file - A PDF File object from the browser
 * @returns {Promise<{ success: boolean, documentId: string, filename: string, chunksStored: number }>}
 */
export function uploadDocument(file) {
  const form = new FormData();
  form.append('document', file);         // field name MUST be "document"
  return postForm('/api/v1/inspection/ingest', form);
  // browser sets Content-Type: multipart/form-data; boundary=... automatically
}
