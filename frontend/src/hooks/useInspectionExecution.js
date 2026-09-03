/**
 * HOOK LAYER — useInspectionExecution.js
 *
 * Manages industrial inspection workflow execution with real-time LangGraph
 * SSE event streaming, structured findings presentation, and Approval Note DOCX download.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { runWorkflow as runWorkflowApi, downloadApprovalNote } from '../api/inspection.api.js';
import { subscribeToSse } from '../services/sseClient.js';

export function useInspectionExecution() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  const [runId, setRunId] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [findings, setFindings] = useState([]);
  const [sopEvidence, setSopEvidence] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [approvalNote, setApprovalNote] = useState(null);
  const [error, setError] = useState(null);
  const [workflowOutcome, setWorkflowOutcome] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  const unsubscribeRef = useRef(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  const appendTimelineEvent = useCallback((event) => {
    setTimeline((prev) => {
      if (event.id && prev.some((e) => e.id === event.id)) {
        return prev;
      }
      return [...prev, event];
    });
  }, []);

  const handleSseEvent = useCallback((sseEvent) => {
    const { type, data, timestamp } = sseEvent;
    if (type === 'heartbeat') return;

    const eventId = sseEvent.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (type === 'connected') {
      appendTimelineEvent({
        id: eventId,
        type: 'connected',
        label: 'Connected to live inspection pipeline stream',
        status: 'complete',
        timestamp,
      });
    } else if (type === 'run_started') {
      setStatus('running');
      appendTimelineEvent({
        id: eventId,
        type: 'run_started',
        label: `Pipeline initiated (${data?.filename || data?.documentId || 'Inspection Report'})`,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'node_started') {
      const node = data?.node || 'stage';
      let label = `Running stage: ${node}`;
      if (node === 'ingest') label = 'Ingesting & indexing inspection document';
      else if (node === 'retrieve') label = 'Retrieving relevant document chunks';
      else if (node === 'extract_findings') label = 'Extracting structured findings with verbatim evidence';
      else if (node === 'validate_findings') label = 'Validating findings schema & integrity';
      else if (node === 'retry_extraction') label = 'Retrying structured extraction (attempt 2)';
      else if (node === 'retrieve_sop') label = 'Searching internal SOP knowledge base in Qdrant';
      else if (node === 'check_sop_evidence') label = 'Evaluating SOP evidence sufficiency';
      else if (node === 'assess_risk') label = 'Assessing equipment operational risk';
      else if (node === 'validate_risk') label = 'Validating risk assessment schema';
      else if (node === 'validate_citations') label = 'Verifying citations & anti-hallucination check';
      else if (node === 'generate_report') label = 'Compiling audit-ready Approval Note DOCX';

      appendTimelineEvent({
        id: eventId,
        type: 'node_started',
        node,
        label,
        status: 'running',
        timestamp,
      });
    } else if (type === 'node_completed') {
      const node = data?.node || 'stage';
      let label = `Completed stage: ${node}`;
      if (node === 'ingest') label = 'Document parsed & vectors indexed in Qdrant';
      else if (node === 'retrieve') label = 'Evidence chunks retrieved';
      else if (node === 'extract_findings') label = 'Findings extracted from verbatim report text';
      else if (node === 'validate_findings') label = 'Findings structure validated';
      else if (node === 'retry_extraction') label = 'Extraction retry completed';
      else if (node === 'retrieve_sop') label = 'Matched against internal maintenance SOPs';
      else if (node === 'check_sop_evidence') label = 'SOP evidence verified';
      else if (node === 'assess_risk') label = 'Risk evaluated with standard operating criteria';
      else if (node === 'validate_risk') label = 'Risk assessment verified';
      else if (node === 'validate_citations') label = 'Citations verified';
      else if (node === 'generate_report') label = 'Approval Note DOCX generated';

      appendTimelineEvent({
        id: eventId,
        type: 'node_completed',
        node,
        label,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'validation') {
      const validator = data?.validator || 'validation';
      let label = `Validation: ${validator}`;
      if (validator === 'validate_findings') {
        label = data?.valid
          ? `Findings validated (${data?.findingsCount || 0} findings confirmed)`
          : 'Findings failed schema validation; triggering bounded retry';
      } else if (validator === 'check_sop_evidence') {
        label = data?.status === 'EVIDENCE_FOUND'
          ? 'SOP evidence confirmed in knowledge base'
          : 'No applicable SOP evidence found for observed condition';
      } else if (validator === 'validate_risk') {
        label = data?.valid ? 'Risk assessment schema validated' : 'Risk schema invalid';
      } else if (validator === 'validate_citations') {
        label = `Citations verified (${data?.citationsCount || 0} grounded quotes)`;
      }

      appendTimelineEvent({
        id: eventId,
        type: 'validation',
        validator,
        label,
        status: data?.valid === false ? 'warning' : 'complete',
        timestamp,
      });
    } else if (type === 'run_completed') {
      setStatus('completed');
      setWorkflowOutcome(data?.workflowOutcome || 'SUCCESS');
      appendTimelineEvent({
        id: eventId,
        type: 'run_completed',
        label: 'Inspection workflow completed successfully',
        status: 'complete',
        timestamp,
      });
    } else if (type === 'run_stopped') {
      setStatus('stopped');
      setWorkflowOutcome(data?.outcome || 'INSUFFICIENT_EVIDENCE');
      appendTimelineEvent({
        id: eventId,
        type: 'run_stopped',
        label: data?.outcome === 'INSUFFICIENT_EVIDENCE'
          ? 'Insufficient evidence available to produce a reliable recommendation'
          : `Pipeline stopped: ${data?.reason || 'Terminated safely'}`,
        status: 'warning',
        timestamp,
      });
    } else if (type === 'run_failed') {
      setStatus('failed');
      setError(data?.reason || 'Inspection workflow encountered an error');
      appendTimelineEvent({
        id: eventId,
        type: 'run_failed',
        label: `Pipeline failed: ${data?.reason || 'Safe failure triggered'}`,
        status: 'error',
        timestamp,
      });
    }
  }, [appendTimelineEvent]);

  /**
   * Run the inspection workflow with SSE stream tracking.
   */
  const runWorkflow = useCallback(async (input, task = '') => {
    if (!input || status === 'running') {
      return;
    }

    const cleanRunId = `insp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setRunId(cleanRunId);
    setStatus('running');
    setTimeline([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
    setWorkflowOutcome(null);

    // 1. Establish SSE subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    unsubscribeRef.current = subscribeToSse(`/api/v1/inspection/runs/${cleanRunId}/stream`, {
      onEvent: handleSseEvent,
      onError: (err) => {
        console.warn('[useInspectionExecution] SSE warning:', err.message);
      },
      onClose: () => {
        // stream ended
      },
    });

    // 2. Invoke POST API
    try {
      let targetInput = input;
      if (typeof input === 'string') {
        targetInput = { documentId: input, task, runId: cleanRunId };
      } else if (input instanceof File || input instanceof Blob) {
        // file upload
      } else if (typeof input === 'object') {
        targetInput = { ...input, runId: cleanRunId };
      }

      const response = await runWorkflowApi(targetInput, task);
      const data = response?.data || response;

      const returnedFindings = Array.isArray(data?.findings) ? data.findings : [];
      let primaryRisk = null;
      if (Array.isArray(data?.riskAssessments) && data.riskAssessments.length > 0) {
        primaryRisk = data.riskAssessments[0];
      } else if (data?.riskAssessment && typeof data.riskAssessment === 'object') {
        primaryRisk = data.riskAssessment;
      }

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
          downloadUrl: `/api/v1/inspection/download/${encodeURIComponent(data.filename)}`,
        };
      }

      setFindings(returnedFindings);
      setRiskAssessment(primaryRisk);
      setRecommendation(consolidatedRec);
      setCitations(returnedCitations);
      setApprovalNote(returnedNote);
      setWorkflowOutcome(data?.orchestration?.workflowOutcome || 'SUCCESS');

      if (data?.orchestration?.workflowOutcome === 'INSUFFICIENT_EVIDENCE') {
        setStatus('stopped');
      } else {
        setStatus('completed');
      }
    } catch (err) {
      setStatus('failed');
      const safeMessage = err?.message || 'Inspection analysis failed. Please try again.';
      setError(safeMessage);
      appendTimelineEvent({
        id: `err-${Date.now()}`,
        type: 'run_failed',
        label: `Pipeline error: ${safeMessage}`,
        status: 'error',
        timestamp: Date.now(),
      });
    }
  }, [status, handleSseEvent, appendTimelineEvent]);

  /**
   * Download the generated Approval Note DOCX.
   */
  const downloadNote = useCallback(async (customFilename) => {
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
  }, [approvalNote]);

  const reset = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setStatus('idle');
    setRunId(null);
    setTimeline([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
    setWorkflowOutcome(null);
  }, []);

  return {
    status,
    runId,
    timeline,
    findings,
    sopEvidence,
    riskAssessment,
    recommendation,
    citations,
    approvalNote,
    workflowOutcome,
    error,
    isDownloading,
    downloadError,
    isRunning: status === 'running',
    isCompleted: status === 'completed',
    isFailed: status === 'failed',
    isStopped: status === 'stopped',
    isInsufficientEvidence: workflowOutcome === 'INSUFFICIENT_EVIDENCE',
    runWorkflow,
    downloadNote,
    reset,
  };
}
