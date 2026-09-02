/**
 * API LAYER — coding.api.js
 *
 * Maps backend coding generation & secure sandbox execution endpoints.
 * NO React state. NO UI logic.
 */

import { post } from './client.js';

/**
 * Generate Python code using local Model Router & configured local LLM.
 * @param {string} prompt
 * @returns {Promise<{ success: boolean, taskType: string, model: string, language: string, code: string, rawOutput: string, routingReason: string, isFallback: boolean }>}
 */
export function generateCode(prompt) {
  return post('/api/v1/coding/generate', { prompt });
}

/**
 * Run Python code strictly inside the isolated Docker sandbox.
 * @param {string} code
 * @param {string} [language='python']
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ success: boolean, stdout: string, stderr: string, exitCode: number|null, timedOut: boolean, stdoutTruncated: boolean, stderrTruncated: boolean, durationMs: number, sandbox: object }>}
 */
export function executeCode(code, language = 'python', timeoutMs = 5000) {
  return post('/api/v1/coding/execute', { code, language, timeoutMs });
}
