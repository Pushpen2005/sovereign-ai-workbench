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

import { API_BASE_URL, get, post, postForm } from './client.js';

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
 * Download a generated DOCX file.
 * Returns the raw Response (binary) for blob download.
 * @param {string} filename
 * @returns {Promise<Response>}
 */
export function downloadApprovalNote(filename) {
  return get(`/api/v1/inspection/download/${encodeURIComponent(filename)}`);
}

/**
 * Build the direct download URL for an Approval Note DOCX.
 * @param {string} filename
 * @returns {string}
 */
export function getApprovalNoteDownloadUrl(filename) {
  return `${API_BASE_URL}/api/v1/inspection/download/${encodeURIComponent(filename)}`;
}

/**
 * Trigger immediate browser download of an Approval Note DOCX file.
 * @param {string} filename
 */
export function triggerDocxDownload(filename) {
  if (!filename) return;
  const url = getApprovalNoteDownloadUrl(filename);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Run the inspection analysis workflow on an existing uploaded document.
 * @param {string} documentId - Existing document ID
 * @param {string} [task] - Optional analysis task prompt
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function runInspectionWorkflow(documentId, task = 'Analyze this inspection report') {
  return post('/api/v1/inspection/workflow', { documentId, task });
}

/**
 * Complete workflow supporting either existing documentId or new File.
 * @param {File|string|object} fileOrDocumentId
 * @param {string} [task]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function runWorkflow(fileOrDocumentId, task = '') {
  if (typeof fileOrDocumentId === 'string') {
    return runInspectionWorkflow(fileOrDocumentId, task);
  }
  if (fileOrDocumentId && typeof fileOrDocumentId === 'object' && !(fileOrDocumentId instanceof File)) {
    return runInspectionWorkflow(fileOrDocumentId.documentId, fileOrDocumentId.task || task);
  }
  const form = new FormData();
  form.append('document', fileOrDocumentId);
  if (task) form.append('task', task);
  return postForm('/api/v1/inspection/workflow', form);
}

