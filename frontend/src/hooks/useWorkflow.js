/**
 * HOOK LAYER — useWorkflow.js
 *
 * Manages the complete approval note workflow state.
 * Components use this hook — they never call fetch directly.
 */

import { useState, useCallback } from 'react';
import {
  mockWorkflowSteps,
  mockFindings,
  mockRiskAssessment,
  mockRecommendation,
  mockCitations,
} from '../data/mockData.js';

export function useWorkflow() {
  const [status, setStatus] = useState('idle'); // idle | running | complete | error
  const [steps, setSteps] = useState([]);
  const [findings, setFindings] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [approvalNote, setApprovalNote] = useState(null);
  const [error, setError] = useState(null);

  /**
   * Simulate stepping through workflow steps.
   * PR #21: Replace with inspection.api.js → runWorkflow()
   */
  const runWorkflow = useCallback(async (_file, _task = '') => {
    setStatus('running');
    setSteps([]);
    setError(null);

    try {
      for (const step of mockWorkflowSteps) {
        await new Promise((r) => setTimeout(r, 500));
        setSteps((prev) => [...prev, step]);
      }

      setFindings(mockFindings);
      setRiskAssessment(mockRiskAssessment);
      setRecommendation(mockRecommendation);
      setCitations(mockCitations);
      setApprovalNote({ filename: 'Approval_Note.docx' });
      setStatus('complete');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Workflow failed');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setSteps([]);
    setFindings([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
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
    isRunning: status === 'running',
    isComplete: status === 'complete',
    runWorkflow,
    reset,
  };
}
