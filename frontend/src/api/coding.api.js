/**
 * API LAYER — coding.api.js
 *
 * Maps backend coding generation & secure sandbox execution endpoints.
 * Python-only contract. Supports optional CSV upload.
 * NO React state. NO UI logic.
 */

import { post, postForm } from './client.js';

/**
 * Generate Python code using local Model Router & configured local LLM.
 * @param {string} prompt - Coding prompt
 * @param {string} [language='python'] - Always 'python'
 * @param {File|{content: string, filename: string}|null} [csvFile=null] - Optional CSV upload
 * @returns {Promise<{ success: boolean, taskType: string, model: string, language: string, code: string, rawOutput: string, routingReason: string, isFallback: boolean, csv?: object }>}
 */
export function generateCode(prompt, language = 'python', csvFile = null) {
  if (csvFile instanceof File || csvFile instanceof Blob) {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('language', 'python');
    formData.append('csv', csvFile, csvFile.name || 'data.csv');
    return postForm('/api/v1/coding/generate', formData);
  }

  if (csvFile && typeof csvFile === 'object' && csvFile.content) {
    return post('/api/v1/coding/generate', {
      prompt,
      language: 'python',
      csvContent: csvFile.content,
      csvFilename: csvFile.filename || 'data.csv',
    });
  }

  return post('/api/v1/coding/generate', { prompt, language: 'python' });
}

/**
 * Run Python code strictly inside the isolated Docker sandbox.
 * @param {string} code - Python source code
 * @param {string} [language='python'] - Always 'python'
 * @param {number} [timeoutMs=5000] - Hard execution timeout
 * @param {File|{content: string, filename: string}|null} [csvFile=null] - Optional CSV data
 * @returns {Promise<{ success: boolean, stage: string, stdout: string, stderr: string, exitCode: number|null, timedOut: boolean, stdoutTruncated: boolean, stderrTruncated: boolean, durationMs: number, sandbox: object, csv?: object }>}
 */
export function executeCode(code, language = 'python', timeoutMs = 5000, csvFile = null) {
  if (csvFile instanceof File || csvFile instanceof Blob) {
    const formData = new FormData();
    formData.append('code', code);
    formData.append('language', 'python');
    formData.append('timeoutMs', String(timeoutMs || 5000));
    formData.append('csv', csvFile, csvFile.name || 'data.csv');
    return postForm('/api/v1/coding/execute', formData);
  }

  if (csvFile && typeof csvFile === 'object' && csvFile.content) {
    return post('/api/v1/coding/execute', {
      code,
      language: 'python',
      timeoutMs: timeoutMs || 5000,
      csvContent: csvFile.content,
      csvFilename: csvFile.filename || 'data.csv',
    });
  }

  return post('/api/v1/coding/execute', { code, language: 'python', timeoutMs });
}
