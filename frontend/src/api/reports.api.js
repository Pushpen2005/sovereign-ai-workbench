/**
 * API LAYER — reports.api.js
 *
 * Maps backend reports endpoints.
 * NO React state. NO UI logic.
 */

import { get } from './client.js';

/**
 * Fetch all reports for the active organization.
 * @param {object} [params]
 * @param {number} [params.limit=50]
 * @param {number} [params.offset=0]
 * @returns {Promise<{ success: boolean, count: number, total: number, data: Array }>}
 */
export function fetchReports(params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);

  const qs = query.toString();
  const endpoint = qs ? `/api/v1/reports?${qs}` : '/api/v1/reports';
  return get(endpoint);
}

/**
 * Fetch a single report by its UUID.
 * @param {string} id
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function fetchReportById(id) {
  return get(`/api/v1/reports/${encodeURIComponent(id)}`);
}
