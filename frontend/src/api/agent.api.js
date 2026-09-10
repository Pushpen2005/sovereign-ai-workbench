/**
 * API LAYER — agent.api.js
 *
 * Maps backend agent orchestration endpoints.
 * NO React state. NO UI logic.
 */

import { get, post } from './client.js';

/**
 * Execute an autonomous agent task for a given goal.
 *
 * @param {string} goal - The objective / inquiry for the agent
 * @param {object} [options]
 * @param {number} [options.maxSteps] - Optional limit on tool execution steps
 * @param {number} [options.timeoutMs] - Optional execution timeout in milliseconds
 * @returns {Promise<{ success: boolean, goal: string, model: string, answer: string, steps: Array<object>, sources: Array<object>, deliverable: object, durationMs: number }>}
 */
export function runAgent(goal, options = {}) {
  return post('/api/v1/agent/run', {
    goal,
    ...options,
  });
}

/**
 * Fetch paginated agent runs for the organization.
 *
 * @param {object} [params]
 * @param {number} [params.limit]
 * @param {number} [params.offset]
 * @param {string} [params.status]
 * @returns {Promise<{ success: boolean, data: Array<object> }>}
 */
export function fetchAgentRuns(params = {}) {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', params.limit);
  if (params.offset) query.set('offset', params.offset);
  if (params.status) query.set('status', params.status);
  const qStr = query.toString();
  return get(`/api/v1/agent/runs${qStr ? `?${qStr}` : ''}`);
}

/**
 * Fetch details of a specific agent run.
 *
 * @param {string} runId
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function fetchAgentRun(runId) {
  return get(`/api/v1/agent/runs/${encodeURIComponent(runId)}`);
}

/**
 * Fetch execution timeline steps for an agent run.
 *
 * @param {string} runId
 * @returns {Promise<{ success: boolean, data: Array<object> }>}
 */
export function fetchAgentRunSteps(runId) {
  return get(`/api/v1/agent/runs/${encodeURIComponent(runId)}/steps`);
}

/**
 * Execute an inspection agent workflow for a given documentId.
 *
 * @param {string} documentId - Target document identifier
 * @param {string} [goal] - User goal / instructions
 * @returns {Promise<object>}
 */
export function runInspectionAgentApi(documentId, goal) {
  return post('/api/v1/agent/inspection', {
    documentId,
    goal,
  });
}

/**
 * Phase 7 — Execute inspection analysis agent workflow.
 *
 * @param {string} documentId
 * @param {string} [organizationId]
 * @returns {Promise<{ success: boolean, runId: string, status: string, result: object }>}
 */
export function analyzeInspectionAgent(documentId, organizationId) {
  return post('/api/v1/agents/inspection/analyze', {
    documentId,
    organizationId,
  });
}

/**
 * Phase 7 — Fetch activity / status for an inspection run.
 *
 * @param {string} runId
 * @returns {Promise<object>}
 */
export function fetchInspectionRunActivity(runId) {
  return get(`/api/v1/agents/inspection/runs/${encodeURIComponent(runId)}`);
}



