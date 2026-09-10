/**
 * API LAYER — knowledge.api.js
 *
 * Interactive Knowledge Base Semantic Search Simulator.
 * Strictly tenant-isolated and scoped to canonical documentType="sop".
 */

import { get, post, postForm, del } from './client.js';

/**
 * Fetch all persisted Knowledge Base (SOP) documents for the authenticated organization.
 * @returns {Promise<{ success: boolean, documents: Array, count: number }>}
 */
export function fetchKnowledgeDocuments() {
  return get('/api/v1/knowledge');
}

/**
 * Upload a PDF file directly into the Knowledge Base (enforces canonical documentType="sop").
 * @param {File} file
 * @returns {Promise<{ success: boolean, documentId: string, filename: string, documentType: string, chunksStored: number }>}
 */
export function uploadKnowledgeDocument(file) {
  const form = new FormData();
  form.append('document', file);
  return postForm('/api/v1/knowledge', form);
}

/**
 * Delete a Knowledge Base document and associated Qdrant vectors by document ID.
 * @param {string} documentId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export function deleteKnowledgeDocument(documentId) {
  if (!documentId) throw new Error('Document ID is required for deletion');
  return del(`/api/v1/knowledge/${encodeURIComponent(documentId)}`);
}

/**
 * Execute interactive semantic search across the organization's knowledge base SOPs.
 *
 * @param {object} params
 * @param {string} params.query - Engineering finding or search query
 * @param {number} [params.topK=5] - Number of chunks to retrieve (1-20)
 * @param {number} [params.scoreThreshold=0.5] - Minimum similarity score threshold
 * @returns {Promise<{ success: boolean, query: string, results: Array<{ text: string, score: number, documentId: string, filename: string, page: number, chunkIndex: number, documentType: string, extractionMethod: string }>, total: number }>}
 */
export function searchKnowledgeBase({ query, topK = 5, scoreThreshold = 0.5 }) {
  return post('/api/v1/knowledge/search', {
    query,
    topK,
    scoreThreshold,
  });
}

