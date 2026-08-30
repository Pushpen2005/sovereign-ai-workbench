/**
 * HOOK LAYER — useWorkflow.js
 *
 * Manages the complete inspection analysis and approval note workflow state.
 * Connects directly to POST /api/v1/inspection/workflow.
 */

import { useState, useCallback, useRef } from 'react';
import { runWorkflow as runWorkflowApi } from '../api/inspection.api.js';

export const WORKFLOW_STEPS = [
  { id: 'reading', label: 'Reading inspection report' },
  { id: 'extracting', label: 'Extracting findings' },
  { id: 'searching', label: 'Searching relevant SOPs' },
  { id: 'assessing', label: 'Assessing risk' },
  { id: 'recommending', label: 'Preparing recommendation' },
  { id: 'generating', label: 'Generating approval note' },
];

export function useWorkflow() {
  const [status, setStatus] = useState('idle'); // idle | running | complete | error
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [steps, setSteps] = useState([]);
  const [findings, setFindings] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [riskAssessments, setRiskAssessments] = useState([]);
  const [recommendation, setRecommendation] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [citations, setCitations] = useState([]);
  const [approvalNote, setApprovalNote] = useState(null);
  const [analyzedDoc, setAnalyzedDoc] = useState(null); // { documentId, filename }
  const [error, setError] = useState(null);

  const stepTimerRef = useRef(null);

  /**
   * Run the complete inspection workflow on an existing documentId or File.
   * @param {string|File|object} target - documentId string or File
   * @param {string} [task] - Optional task prompt
   */
  const runWorkflow = useCallback(async (target, task = 'Analyze this inspection report') => {
    setStatus('running');
    setError(null);
    setActiveStepIndex(0);

    // Initialize progress checklist with first step running
    setSteps(
      WORKFLOW_STEPS.map((s, idx) => ({
        ...s,
        status: idx === 0 ? 'running' : 'pending',
      }))
    );

    // Simulate realistic sequential progress milestones while server computes
    let currentIdx = 0;
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    stepTimerRef.current = setInterval(() => {
      currentIdx += 1;
      if (currentIdx < WORKFLOW_STEPS.length - 1) {
        setActiveStepIndex(currentIdx);
        setSteps((prev) =>
          prev.map((s, idx) => ({
            ...s,
            status:
              idx < currentIdx
                ? 'complete'
                : idx === currentIdx
                ? 'running'
                : 'pending',
          }))
        );
      }
    }, 1200);

    try {
      const response = await runWorkflowApi(target, task);

      if (stepTimerRef.current) clearInterval(stepTimerRef.current);

      // Backend returns: { success: true, data: { documentId, filename, findings, riskAssessments, ... } }
      const data = response?.data || response;

      const rawFindings = data?.findings || [];
      const rawRisks = data?.riskAssessments || [];
      const rawRecs = data?.recommendations || [];
      const rawCitations = data?.citations || [];
      const note = data?.approvalNote || null;

      // Mark all steps complete
      setSteps(
        WORKFLOW_STEPS.map((s) => ({
          ...s,
          status: 'complete',
        }))
      );
      setActiveStepIndex(WORKFLOW_STEPS.length);

      setFindings(rawFindings);
      setRiskAssessments(rawRisks);
      setRiskAssessment(rawRisks[0] || null);
      setRecommendations(rawRecs);
      setRecommendation(rawRecs[0] || (rawRecs.length ? rawRecs.join(' ') : null));
      setCitations(rawCitations);
      setApprovalNote(note);
      setAnalyzedDoc({
        documentId: data?.documentId || (typeof target === 'string' ? target : null),
        filename: data?.filename || 'Inspection_Report.pdf',
      });

      setStatus('complete');
      return data;
    } catch (err) {
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
      setStatus('error');
      const msg = err?.message || 'Inspection analysis workflow failed. Please try again.';
      setError(msg);
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    setStatus('idle');
    setActiveStepIndex(0);
    setSteps([]);
    setFindings([]);
    setRiskAssessment(null);
    setRiskAssessments([]);
    setRecommendation(null);
    setRecommendations([]);
    setCitations([]);
    setApprovalNote(null);
    setAnalyzedDoc(null);
    setError(null);
  }, []);

  return {
    status,
    activeStepIndex,
    steps,
    findings,
    riskAssessment,
    riskAssessments,
    recommendation,
    recommendations,
    citations,
    approvalNote,
    analyzedDoc,
    error,
    isRunning: status === 'running',
    isComplete: status === 'complete',
    runWorkflow,
    reset,
  };
}

