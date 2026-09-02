/**
 * API LAYER — inspection.api.js
 *
 * Maps all backend inspection / workflow endpoints.
 * NO React state. NO UI logic.
 *
 * Backend endpoints:
 *   POST /api/v1/inspection/ingest       — Ingest inspection document
 *   POST /api/v1/inspection/analyze      — Extract findings
 *   POST /api/v1/inspection/risk         — Assess risk for a finding
 *   POST /api/v1/inspection/approval-note — Generate Approval Note DOCX
 *   GET  /api/v1/inspection/download/:f  — Download DOCX
 *   POST /api/v1/inspection/workflow     — Complete end-to-end workflow
 */

import axiosInstance, { post, postForm, API_BASE_URL } from './client.js';

/**
 * Ingest an inspection PDF into Qdrant.
 * @param {File} file - PDF file
 * @returns {Promise<{ success: boolean, documentId: string, chunksStored: number }>}
 */
export function ingestInspection(file) {
  const form = new FormData();
  form.append('document', file);
  return postForm('/api/v1/inspection/ingest', form);
}

/**
 * Extract findings from an ingested document.
 * @param {string} documentId
 * @param {string} [task]
 * @returns {Promise<{ success: boolean, findings: Array }>}
 */
export function analyzeInspection(documentId, task = '') {
  return post('/api/v1/inspection/analyze', { documentId, task });
}

/**
 * Assess risk for an inspection finding.
 * @param {object} finding - PR #13 finding object
 * @returns {Promise<{ riskAssessment: object, recommendation: string, citations: Array }>}
 */
export function assessRisk(finding) {
  return post('/api/v1/inspection/risk', { finding });
}

/**
 * Generate an Approval Note DOCX.
 * @param {object} data - findings + risk + recommendation + citations
 * @returns {Promise<{ success: boolean, filename: string, downloadUrl: string }>}
 */
export function generateApprovalNote(data) {
  return post('/api/v1/inspection/approval-note', data);
}

/**
 * Get direct download URL for a generated DOCX file.
 * @param {string} filename
 * @returns {string}
 */
export function getDownloadUrl(filename) {
  return `${API_BASE_URL}/api/v1/inspection/download/${encodeURIComponent(filename)}`;
}

/**
 * Download a generated DOCX file directly as a Blob.
 * Triggers safe programmatic browser file download.
 * @param {string} filename
 * @returns {Promise<string>} downloaded filename
 */
export async function downloadApprovalNote(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename is required for download');
  }

  const res = await axiosInstance.get(
    `/api/v1/inspection/download/${encodeURIComponent(filename)}`,
    { responseType: 'blob' }
  );

  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
  return filename;
}

/**
 * Run the complete inspection workflow in one call.
 * Accepts either a File object (multipart upload) or documentId string / descriptor object.
 * @param {File|string|object} input - Inspection PDF File or documentId
 * @param {string} [task]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function runWorkflow(input, task = '') {
  if (input instanceof File || input instanceof Blob) {
    const form = new FormData();
    form.append('document', input);
    if (task) form.append('task', task);
    return postForm('/api/v1/inspection/workflow', form);
  }

  if (typeof input === 'string') {
    return post('/api/v1/inspection/workflow', { documentId: input, task });
  }

  if (input && typeof input === 'object') {
    return post('/api/v1/inspection/workflow', {
      ...input,
      task: task || input.task || '',
    });
  }

  throw new Error('Valid document file or documentId is required to run workflow');
}
