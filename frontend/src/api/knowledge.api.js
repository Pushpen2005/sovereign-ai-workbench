/**
 * API LAYER — knowledge.api.js
 *
 * Interactive Knowledge Base Semantic Search Simulator.
 * Strictly tenant-isolated and scoped to canonical documentType="sop".
 */

import { post } from './client.js';

/**
 * Execute interactive semantic search across the organization's knowledge base SOPs.
 *
 * @param {object} params
 * @param {string} params.query - Engineering finding or search query
 * @param {number} [params.topK=5] - Number of chunks to retrieve (1-20)
 * @param {number} [params.scoreThreshold=0.0] - Minimum similarity score threshold
 * @returns {Promise<{ success: boolean, query: string, results: Array<{ text: string, score: number, documentId: string, filename: string, page: number, chunkIndex: number, documentType: string, extractionMethod: string }>, total: number }>}
 */
export function searchKnowledgeBase({ query, topK = 5, scoreThreshold = 0.0 }) {
  return post('/api/v1/knowledge/search', {
    query,
    topK,
    scoreThreshold,
  });
}
