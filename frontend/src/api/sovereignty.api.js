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

/**
 * Fetches configured model registry and local model availability from Model Router.
 *
 * @returns {Promise<{
 *   registry: object,
 *   installedModels: Array<{name: string, size: number}>,
 *   diagnostic: object,
 *   ollamaUrl: string
 * }>}
 */
export function getModelGovernanceStatus() {
  return get('/api/v1/router/models');
}

/**
 * Fetches machine-readable security and sovereignty status.
 *
 * @returns {Promise<{
 *   sovereignty: object,
 *   timestamp: string
 * }>}
 */
export function getSecurityStatus() {
  return get('/api/v1/security/status');
}

