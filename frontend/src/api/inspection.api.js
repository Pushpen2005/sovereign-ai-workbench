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

import { get, post, postForm } from './client.js';

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
 * Run the complete inspection workflow in one call.
 * @param {File} file - Inspection PDF
 * @param {string} [task]
 * @returns {Promise<{ success: boolean, data: object }>}
 */
export function runWorkflow(file, task = '') {
  const form = new FormData();
  form.append('document', file);
  if (task) form.append('task', task);
  return postForm('/api/v1/inspection/workflow', form);
}
