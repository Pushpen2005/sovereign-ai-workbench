/**
 * API LAYER — ai.api.js
 *
 * Exposes local AI model runtime health checks.
 * NO React state. NO UI logic.
 */

import { get } from './client.js';

/**
 * Check real-time health of local model runtimes (Vision, Coding, Inspection).
 * @returns {Promise<{ vision: object, coding: object, inspection: object }>}
 */
export function getAiHealth() {
  return get('/api/v1/ai/health');
}
