/**
 * API LAYER — agent.api.js
 *
 * Maps backend agent orchestration endpoints.
 * NO React state. NO UI logic.
 */

import { post } from './client.js';

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
