/**
 * HOOK LAYER — useWorkflow.js
 *
 * Manages the complete approval note workflow state.
 * Connects directly to backend API: POST /api/v1/inspection/workflow
 * and download API: GET /api/v1/inspection/download/:filename
 *
 * NO mockData imports. NO setTimeout simulations.
 */

import { useState, useCallback } from 'react';
import {
  runWorkflow as runWorkflowApi,
  downloadApprovalNote,
} from '../api/inspection.api.js';

const INITIAL_PIPELINE_STEPS = [
  { id: '1', label: '1. Ingesting & indexing inspection document', status: 'running' },
  { id: '2', label: '2. Extracting structured findings with verbatim evidence', status: 'pending' },
  { id: '3', label: '3. Searching SOP knowledge base in Qdrant', status: 'pending' },
  { id: '4', label: '4. Evaluating risk & generating recommendation', status: 'pending' },
  { id: '5', label: '5. Compiling audit-ready Approval Note DOCX', status: 'pending' },
];

export function useWorkflow() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'running' | 'complete' | 'error'
  const [steps, setSteps] = useState([]);
  const [findings, setFindings] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [approvalNote, setApprovalNote] = useState(null);
  const [error, setError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  /**
   * Run the live inspection workflow against the backend API.
   * @param {File|string|object} input - PDF File or documentId
   * @param {string} [task] - Optional analysis instructions
   */
  const runWorkflow = useCallback(
    async (input, task = '') => {
      // Prevent duplicate concurrent submissions
      if (status === 'running') {
        return;
      }

      if (!input) {
        setStatus('error');
        setError('Please select an inspection report first.');
        return;
      }

      setStatus('running');
      setSteps(INITIAL_PIPELINE_STEPS);
      setError(null);
      setDownloadError(null);

      try {
        const response = await runWorkflowApi(input, task);
        const data = response?.data || response;

        const returnedFindings = Array.isArray(data?.findings) ? data.findings : [];

        // Primary risk assessment object
        let primaryRisk = null;
        if (Array.isArray(data?.riskAssessments) && data.riskAssessments.length > 0) {
          primaryRisk = data.riskAssessments[0];
        } else if (data?.riskAssessment && typeof data.riskAssessment === 'object') {
          primaryRisk = data.riskAssessment;
        }

        // Consolidated recommendation text
        let consolidatedRec = null;
        if (Array.isArray(data?.recommendations) && data.recommendations.length > 0) {
          consolidatedRec = data.recommendations.join(' ');
        } else if (typeof data?.recommendation === 'string') {
          consolidatedRec = data.recommendation;
        }

        const returnedCitations = Array.isArray(data?.citations) ? data.citations : [];

        let returnedNote = null;
        if (data?.approvalNote && typeof data.approvalNote === 'object') {
          returnedNote = data.approvalNote;
        } else if (data?.filename) {
          returnedNote = {
            filename: data.filename,
            downloadUrl: `/api/v1/inspection/download/${data.filename}`,
          };
        }

        setFindings(returnedFindings);
        setRiskAssessment(primaryRisk);
        setRecommendation(consolidatedRec);
        setCitations(returnedCitations);
        setApprovalNote(returnedNote);

        // Mark all stages completed
        setSteps([
          { id: '1', label: '1. Ingesting & indexing inspection document', status: 'complete' },
          { id: '2', label: '2. Extracting structured findings with verbatim evidence', status: 'complete' },
          { id: '3', label: '3. Searching SOP knowledge base in Qdrant', status: 'complete' },
          { id: '4', label: '4. Evaluating risk & generating recommendation', status: 'complete' },
          { id: '5', label: '5. Compiling audit-ready Approval Note DOCX', status: 'complete' },
        ]);

        setStatus('complete');
      } catch (err) {
        setStatus('error');
        const safeMessage = err?.message || 'Inspection analysis failed. Please try again.';
        setError(safeMessage);
        setSteps((prev) =>
          prev.map((s) => (s.status === 'running' ? { ...s, status: 'error' } : s))
        );
      }
    },
    [status]
  );

  /**
   * Download the generated Approval Note DOCX from the backend.
   * @param {string} [customFilename]
   */
  const downloadNote = useCallback(
    async (customFilename) => {
      const targetFilename = customFilename || approvalNote?.filename;
      if (!targetFilename) {
        setDownloadError('No generated report file available to download.');
        return;
      }

      setIsDownloading(true);
      setDownloadError(null);

      try {
        await downloadApprovalNote(targetFilename);
      } catch (err) {
        setDownloadError(err?.message || 'Failed to download report file.');
      } finally {
        setIsDownloading(false);
      }
    },
    [approvalNote]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setSteps([]);
    setFindings([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
    setDownloadError(null);
    setIsDownloading(false);
  }, []);

  return {
    status,
    steps,
    findings,
    riskAssessment,
    recommendation,
    citations,
    approvalNote,
    error,
    isDownloading,
    downloadError,
    isRunning: status === 'running',
    isComplete: status === 'complete',
    runWorkflow,
    downloadNote,
    reset,
  };
}
