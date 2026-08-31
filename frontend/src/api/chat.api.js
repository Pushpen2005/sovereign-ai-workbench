/**
 * API LAYER — chat.api.js
 *
 * Maps backend RAG / chat persistence endpoints.
 * NO React state. NO UI logic.
 */

import { get, post } from './client.js';

/**
 * Ask a question against indexed documents with conversation persistence.
 * @param {string} question
 * @param {string|null|undefined} [documentId] - Scope to a specific doc, or omit for all
 * @param {string|null|undefined} [conversationId] - Existing conversation ID to append to
 * @returns {Promise<{ success: boolean, conversationId: string, answer: string, sources: Array }>}
 */
export function askQuestion(question, documentId, conversationId) {
  const body = { question };
  if (typeof documentId === 'string' && documentId.trim()) {
    body.documentId = documentId.trim();
  }
  if (typeof conversationId === 'string' && conversationId.trim()) {
    body.conversationId = conversationId.trim();
  }
  return post('/api/v1/chat/ask', body);
}

/**
 * Fetch conversation history for the organization.
 * @param {object} [params]
 * @param {number} [params.limit=50]
 * @param {number} [params.offset=0]
 * @returns {Promise<{ success: boolean, count: number, data: Array }>}
 */
export function fetchChatHistory(params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);

  const qs = query.toString();
  const endpoint = qs ? `/api/v1/chat/history?${qs}` : '/api/v1/chat/history';
  return get(endpoint);
}

/**
 * Fetch messages for a specific conversation.
 * @param {string} conversationId
 * @returns {Promise<{ success: boolean, conversation: object, data: Array }>}
 */
export function fetchConversationMessages(conversationId) {
  return get(`/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
}

/**
 * Fetch chat query and conversation stats for the organization.
 * @returns {Promise<{ success: boolean, data: { queries: number, conversations: number } }>}
 */
export function fetchChatStats() {
  return get('/api/v1/chat/stats');
}
