/**
 * API LAYER — vision.api.js
 *
 * Maps backend multimodal vision endpoints.
 * NO React state. NO UI logic.
 */

import { postForm } from './client.js';

/**
 * Upload an image and analyze it with the local vision model.
 *
 * @param {File|Blob} file - Image file object (PNG, JPEG, WebP)
 * @param {string} [prompt] - Analysis instructions or inquiry
 * @returns {Promise<{ success: boolean, taskType: string, model: string, analysis: string, structured: object, processing: object }>}
 */
export function analyzeImage(file, prompt) {
  const form = new FormData();
  form.append('image', file);
  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    form.append('prompt', prompt.trim());
  }
  return postForm('/api/v1/vision/analyze', form);
}
