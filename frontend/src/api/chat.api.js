/**
 * API LAYER — chat.api.js
 *
 * Maps backend RAG / chat endpoints.
 * NO React state. NO UI logic.
 *
 * Backend endpoint (PR #17):
 *   POST /api/v1/chat/ask
 *   Body: { question: string, documentId?: string }
 *
 * NOTE: documentId must be omitted (not null) when searching all documents.
 * The retrieval service rejects null but accepts undefined/omitted.
 */

import { post } from './client.js';

/**
 * Ask a question against indexed documents.
 * @param {string} question
 * @param {string|null|undefined} documentId - Scope to a specific doc, or omit for all
 * @returns {Promise<{ success, answer, sources }>}
 */
export function askQuestion(question, documentId) {
  const body = { question };
  // Only include documentId when it is a non-empty string — omit otherwise
  if (typeof documentId === 'string' && documentId.trim()) {
    body.documentId = documentId.trim();
  }
  return post('/api/v1/chat/ask', body);
}
