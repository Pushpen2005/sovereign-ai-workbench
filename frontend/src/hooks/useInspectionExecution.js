/**
 * HOOK LAYER — useInspectionExecution.js
 *
 * Manages industrial inspection workflow execution with real-time LangGraph
 * SSE event streaming, 8-stage activity timeline, structured findings presentation,
 * SOP evidence preview, and Approval Note DOCX download.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  runWorkflow as runWorkflowApi,
  downloadApprovalNote,
  getInspectionRun,
} from '../api/inspection.api.js';
import { subscribeToSse } from '../services/sseClient.js';

export const CANONICAL_STAGES = [
  { id: 'reading_report', label: 'Reading report', node: 'ingest', description: 'Ingesting and parsing inspection report' },
  { id: 'retrieving_evidence', label: 'Retrieving evidence', node: 'retrieve', description: 'Retrieving relevant document chunks' },
  { id: 'extracting_findings', label: 'Extracting findings', node: 'extract_findings', description: 'Extracting findings with verbatim evidence' },
  { id: 'searching_sop', label: 'Searching SOP', node: 'retrieve_sop', description: 'Searching maintenance SOPs in Qdrant' },
  { id: 'checking_evidence', label: 'Checking evidence', node: 'check_sop_evidence', description: 'Verifying SOP evidence sufficiency' },
  { id: 'analysing_risk', label: 'Analysing risk', node: 'assess_risk', description: 'Evaluating risk against operating limits' },
  { id: 'preparing_recommendation', label: 'Preparing recommendation', node: 'validate_risk', description: 'Formulating action recommendations and citations' },
  { id: 'generating_approval_note', label: 'Generating Approval Note', node: 'generate_report', description: 'Compiling audit-ready executive DOCX deliverable' },
];

const STAGE_ORDER = CANONICAL_STAGES.map((s) => s.id);

function getInitialStageStates() {
  const map = {};
  for (const stage of CANONICAL_STAGES) {
    map[stage.id] = {
      id: stage.id,
      label: stage.label,
      description: stage.description,
      status: 'pending', // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      message: '',
    };
  }
  return map;
}

export function useInspectionExecution() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  const [runId, setRunId] = useState(null);
  const [stageStates, setStageStates] = useState(getInitialStageStates);
  const [currentStageId, setCurrentStageId] = useState(null);
  const [currentOperation, setCurrentOperation] = useState('Idle');
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

  // Real truthful elapsed time counter
  const [startTime, setStartTime] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const unsubscribeRef = useRef(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);

  // Timer effect
  useEffect(() => {
    let timer = null;
    if (status === 'running' && startTime) {
      timer = setInterval(() => {
        setElapsedSeconds(Number(((Date.now() - startTime) / 1000).toFixed(1)));
      }, 100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [status, startTime]);

  const appendTimelineEvent = useCallback((event) => {
    setTimeline((prev) => {
      if (event.id && prev.some((e) => e.id === event.id)) {
        return prev;
      }
      return [...prev, event];
    });
  }, []);

  // Helper to transition stages forward
  const advanceStageTo = useCallback((targetStageId, targetStatus = 'running') => {
    setCurrentStageId(targetStageId);
    const targetIdx = STAGE_ORDER.indexOf(targetStageId);
    if (targetIdx === -1) return;

    setStageStates((prev) => {
      const next = { ...prev };
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const stageId = STAGE_ORDER[i];
        if (i < targetIdx) {
          next[stageId] = { ...next[stageId], status: 'completed' };
        } else if (i === targetIdx) {
          next[stageId] = { ...next[stageId], status: targetStatus };
        } else {
          if (next[stageId].status !== 'skipped' && next[stageId].status !== 'failed') {
            next[stageId] = { ...next[stageId], status: 'pending' };
          }
        }
      }
      return next;
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
      advanceStageTo('reading_report', 'running');
      setCurrentOperation('Reading inspection report');
      appendTimelineEvent({
        id: eventId,
        type: 'run_started',
        label: `Pipeline initiated (${data?.filename || data?.documentId || 'Inspection Report'})`,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'node_started') {
      const node = data?.node || 'stage';
      let stageId = null;
      let label = `Running stage: ${node}`;

      if (node === 'ingest') {
        stageId = 'reading_report';
        label = 'Reading inspection report';
      } else if (node === 'retrieve') {
        stageId = 'retrieving_evidence';
        label = 'Retrieving relevant evidence';
      } else if (node === 'extract_findings') {
        stageId = 'extracting_findings';
        label = 'Extracting findings';
      } else if (node === 'validate_findings') {
        stageId = 'extracting_findings';
        label = 'Validating findings structure';
      } else if (node === 'retry_extraction') {
        stageId = 'extracting_findings';
        label = 'Retrying findings extraction';
      } else if (node === 'retrieve_sop') {
        stageId = 'searching_sop';
        label = 'Searching relevant SOP';
      } else if (node === 'check_sop_evidence') {
        stageId = 'checking_evidence';
        label = 'Checking evidence';
      } else if (node === 'assess_risk') {
        stageId = 'analysing_risk';
        label = 'Analysing risk';
      } else if (node === 'validate_risk' || node === 'validate_citations') {
        stageId = 'preparing_recommendation';
        label = 'Preparing recommendation';
      } else if (node === 'generate_report') {
        stageId = 'generating_approval_note';
        label = 'Generating Approval Note';
      }

      if (stageId) {
        advanceStageTo(stageId, 'running');
        setCurrentOperation(label);
      }

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
      let label = `Completed: ${node}`;

      if (node === 'ingest') label = 'Inspection report parsed';
      else if (node === 'retrieve') label = 'Evidence chunks retrieved';
      else if (node === 'extract_findings') label = 'Findings extracted from report text';
      else if (node === 'validate_findings') label = 'Findings validated against schema';
      else if (node === 'retrieve_sop') label = 'Matched against maintenance SOPs';
      else if (node === 'check_sop_evidence') label = 'SOP evidence sufficiency confirmed';
      else if (node === 'assess_risk') label = 'Operational risk evaluated';
      else if (node === 'validate_risk') label = 'Risk & recommendation validated';
      else if (node === 'validate_citations') label = 'Citations verified';
      else if (node === 'generate_report') label = 'Approval Note DOCX compiled';

      appendTimelineEvent({
        id: eventId,
        type: 'node_completed',
        node,
        label,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'findings_extracted') {
      if (Array.isArray(data?.findings)) {
        setFindings(data.findings);
      }
    } else if (type === 'sop_matched') {
      if (Array.isArray(data?.sopEvidence)) {
        setSopEvidence(data.sopEvidence);
      }
    } else if (type === 'risk_assessed') {
      if (data?.riskAssessment) {
        setRiskAssessment(data.riskAssessment);
      }
      if (data?.recommendation) {
        setRecommendation(data.recommendation);
      }
      if (Array.isArray(data?.citations)) {
        setCitations(data.citations);
      }
    } else if (type === 'report_generated') {
      if (data?.reportFilename) {
        setApprovalNote({
          filename: data.reportFilename,
          downloadUrl: `/api/v1/inspection/download/${encodeURIComponent(data.reportFilename)}`,
        });
      }
    } else if (type === 'validation') {
      const validator = data?.validator || 'validation';
      let label = `Validation: ${validator}`;
      if (validator === 'validate_findings') {
        label = data?.valid
          ? `Findings validated (${data?.findingsCount || 0} confirmed)`
          : 'Findings validation failed; retrying';
      } else if (validator === 'check_sop_evidence') {
        label = data?.status === 'EVIDENCE_FOUND'
          ? 'Authoritative SOP evidence confirmed'
          : 'No applicable SOP evidence found for condition';
      } else if (validator === 'validate_risk') {
        label = data?.valid ? 'Risk assessment verified' : 'Risk assessment invalid';
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
      setCurrentOperation('Completed');
      setWorkflowOutcome(data?.workflowOutcome || 'SUCCESS');

      // Complete all stages
      setStageStates((prev) => {
        const next = { ...prev };
        for (const stageId of STAGE_ORDER) {
          next[stageId] = { ...next[stageId], status: 'completed' };
        }
        return next;
      });

      if (data?.reportFilename) {
        setApprovalNote({
          filename: data.reportFilename,
          downloadUrl: `/api/v1/inspection/download/${encodeURIComponent(data.reportFilename)}`,
        });
      }

      appendTimelineEvent({
        id: eventId,
        type: 'run_completed',
        label: '✓ Approval Note generated and ready for review',
        status: 'complete',
        timestamp,
      });
    } else if (type === 'run_stopped') {
      setStatus('stopped');
      setWorkflowOutcome(data?.outcome || 'INSUFFICIENT_EVIDENCE');
      setCurrentOperation('Terminated: Insufficient Evidence');

      setStageStates((prev) => {
        const next = { ...prev };
        let passedStop = false;
        for (const stageId of STAGE_ORDER) {
          if (stageId === 'checking_evidence') {
            next[stageId] = { ...next[stageId], status: 'completed', message: 'No authoritative SOP evidence' };
            passedStop = true;
          } else if (passedStop) {
            next[stageId] = { ...next[stageId], status: 'skipped' };
          }
        }
        return next;
      });

      appendTimelineEvent({
        id: eventId,
        type: 'run_stopped',
        label: 'No sufficient SOP evidence was found. The system did not generate a grounded risk recommendation.',
        status: 'warning',
        timestamp,
      });
    } else if (type === 'run_failed') {
      setStatus('failed');
      const reason = data?.reason || 'Inspection workflow encountered an error';
      setError(reason);
      setCurrentOperation(`Failed: ${reason}`);

      setStageStates((prev) => {
        const next = { ...prev };
        let failedMarked = false;
        for (const stageId of STAGE_ORDER) {
          if (next[stageId].status === 'running' || (!failedMarked && next[stageId].status === 'pending')) {
            next[stageId] = { ...next[stageId], status: 'failed', message: reason };
            failedMarked = true;
          } else if (failedMarked) {
            next[stageId] = { ...next[stageId], status: 'skipped' };
          }
        }
        return next;
      });

      appendTimelineEvent({
        id: eventId,
        type: 'run_failed',
        label: `Pipeline failed: ${reason}`,
        status: 'error',
        timestamp,
      });
    }
  }, [advanceStageTo, appendTimelineEvent]);

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
    setStageStates(getInitialStageStates());
    setCurrentStageId('reading_report');
    setCurrentOperation('Reading inspection report');
    setTimeline([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
    setWorkflowOutcome(null);

    const now = Date.now();
    setStartTime(now);
    setElapsedSeconds(0);

    // 1. Establish SSE subscription before workflow POST to capture early events
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    unsubscribeRef.current = subscribeToSse(`/api/v1/inspection/runs/${cleanRunId}/stream`, {
      autoReconnect: true,
      onEvent: handleSseEvent,
      onError: (err) => {
        console.warn('[useInspectionExecution] SSE stream notice:', err.message);
      },
    });

    // 2. Invoke POST workflow API
    try {
      let targetInput = input;
      if (typeof input === 'string') {
        targetInput = { documentId: input, task, runId: cleanRunId };
      } else if (input instanceof File || input instanceof Blob) {
        targetInput = input;
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

      // Populate deliverables
      setFindings(returnedFindings);
      setRiskAssessment(primaryRisk);
      setRecommendation(consolidatedRec);
      setCitations(returnedCitations);
      setApprovalNote(returnedNote);
      setWorkflowOutcome(data?.orchestration?.workflowOutcome || 'SUCCESS');

      if (data?.orchestration?.workflowOutcome === 'INSUFFICIENT_EVIDENCE') {
        setStatus('stopped');
        setCurrentOperation('Terminated: Insufficient Evidence');
      } else {
        setStatus('completed');
        setCurrentOperation('Completed');
        // Mark all stages completed
        setStageStates((prev) => {
          const next = { ...prev };
          for (const sId of STAGE_ORDER) {
            next[sId] = { ...next[sId], status: 'completed' };
          }
          return next;
        });
      }
    } catch (err) {
      setStatus('failed');
      const safeMessage = err?.message || 'Inspection analysis failed. Please try again.';
      setError(safeMessage);
      setCurrentOperation(`Failed: ${safeMessage}`);
      setStageStates((prev) => {
        const next = { ...prev };
        let marked = false;
        for (const sId of STAGE_ORDER) {
          if (!marked && next[sId].status === 'running') {
            next[sId] = { ...next[sId], status: 'failed', message: safeMessage };
            marked = true;
          } else if (marked) {
            next[sId] = { ...next[sId], status: 'skipped' };
          }
        }
        return next;
      });
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
   * Reconnect to an existing run without re-executing.
   */
  const reconnectRun = useCallback(async (targetRunId) => {
    if (!targetRunId) return;
    setRunId(targetRunId);
    setStatus('running');

    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    unsubscribeRef.current = subscribeToSse(`/api/v1/inspection/runs/${encodeURIComponent(targetRunId)}/stream`, {
      autoReconnect: true,
      onEvent: handleSseEvent,
      onError: (err) => {
        console.warn('[useInspectionExecution] SSE reconnect notice:', err.message);
      },
    });

    try {
      const res = await getInspectionRun(targetRunId);
      if (res?.data) {
        if (res.data.status === 'completed') {
          setStatus('completed');
          setCurrentOperation('Completed');
          if (res.data.report?.filename) {
            setApprovalNote({
              filename: res.data.report.filename,
              downloadUrl: `/api/v1/inspection/download/${encodeURIComponent(res.data.report.filename)}`,
            });
          }
        } else if (res.data.status === 'failed') {
          setStatus('failed');
          setError(res.data.error || 'Inspection run recorded as failed');
        }
      }
    } catch (err) {
      console.warn('[useInspectionExecution] Failed to fetch run snapshot:', err.message);
    }
  }, [handleSseEvent]);

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
    setStageStates(getInitialStageStates());
    setCurrentStageId(null);
    setCurrentOperation('Idle');
    setTimeline([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setError(null);
    setWorkflowOutcome(null);
    setStartTime(null);
    setElapsedSeconds(0);
    setDownloadError(null);
  }, []);

  return {
    status,
    runId,
    canonicalStages: CANONICAL_STAGES,
    stageStates,
    currentStageId,
    currentOperation,
    elapsedSeconds,
    timeline,
    findings,
    sopEvidence,
    riskAssessment,
    recommendation,
    citations,
    approvalNote,
    error,
    workflowOutcome,
    isDownloading,
    downloadError,
    isRunning: status === 'running',
    isInsufficientEvidence: workflowOutcome === 'INSUFFICIENT_EVIDENCE',
    runWorkflow,
    reconnectRun,
    downloadNote,
    reset,
  };
}
