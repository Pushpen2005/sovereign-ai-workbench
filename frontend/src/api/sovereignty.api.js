/**
 * API LAYER — sovereignty.api.js
 *
 * Maps backend security, sovereignty, and platform health endpoints.
 * NO React state. NO UI logic.
 */

import { get } from './client.js';

/**
 * Fetches the real-time sovereignty manifest from the backend.
 * Verifies local LLM, embeddings, vector DB, OCR, database, and zero cloud AI API dependencies.
 *
 * @returns {Promise<{
 *   status: 'sovereign' | 'degraded',
 *   auditTimestamp: string,
 *   components: object,
 *   externalCloudApiKeys: Array<string>,
 *   sovereignty: object
 * }>}
 */
export function getSovereigntyStatus() {
  return get('/api/v1/sovereignty');
}

/**
 * Fetches general system health status.
 *
 * @returns {Promise<{ status: 'ok' }>}
 */
export function getSystemHealth() {
  return get('/api/v1/health');
}
