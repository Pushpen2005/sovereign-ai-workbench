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
  { id: 'READING_REPORT', label: 'Reading report', description: 'Ingesting and reading inspection report' },
  { id: 'EXTRACTING_FINDINGS', label: 'Extracting findings', description: 'Extracting observations with verbatim evidence' },
  { id: 'SEARCHING_KB', label: 'Searching Knowledge Base', description: 'Searching Knowledge Base for relevant SOP evidence' },
  { id: 'VALIDATING_SOP_EVIDENCE', label: 'Validating SOP evidence', description: 'Validating SOP evidence against safety threshold' },
  { id: 'ANALYSING_RISK', label: 'Analysing risk', description: 'Evaluating operational risk against operating limits' },
  { id: 'PREPARING_RECOMMENDATION', label: 'Preparing recommendation', description: 'Formulating actionable maintenance recommendations' },
  { id: 'GENERATING_APPROVAL_NOTE', label: 'Preparing approval note', description: 'Compiling audit-ready executive Approval Note DOCX deliverable' },
  { id: 'COMPLETED', label: 'Completed', description: 'Inspection workflow completed successfully' },
];

const STAGE_ORDER = CANONICAL_STAGES.map((s) => s.id);

const NODE_TO_STAGE = {
  ingest: 'READING_REPORT',
  retrieve: 'READING_REPORT',
  extract_findings: 'EXTRACTING_FINDINGS',
  validate_findings: 'EXTRACTING_FINDINGS',
  retry_extraction: 'EXTRACTING_FINDINGS',
  retrieve_sop: 'SEARCHING_KB',
  check_sop_evidence: 'VALIDATING_SOP_EVIDENCE',
  assess_risk: 'ANALYSING_RISK',
  validate_risk: 'PREPARING_RECOMMENDATION',
  validate_citations: 'PREPARING_RECOMMENDATION',
  generate_report: 'GENERATING_APPROVAL_NOTE',
};

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
  const [candidateObservations, setCandidateObservations] = useState([]);
  const [findings, setFindings] = useState([]);
  const [sopEvidence, setSopEvidence] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [approvalNote, setApprovalNote] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);
  const [workflowOutcome, setWorkflowOutcome] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);

  // Truthful elapsed time counter
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
      advanceStageTo('READING_REPORT', 'running');
      setCurrentOperation('Reading report');
      appendTimelineEvent({
        id: eventId,
        type: 'run_started',
        label: `Pipeline initiated (${data?.filename || data?.documentId || 'Inspection Report'})`,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'inspection_stage') {
      const stage = data?.stage;
      const stageStatus = data?.status || (stage === 'COMPLETED' ? 'completed' : 'running');
      const message = data?.message || '';

      if (stage) {
        if (stage === 'COMPLETED') {
          advanceStageTo('COMPLETED', 'completed');
          setStatus('completed');
          setCurrentOperation('Completed');
        } else {
          advanceStageTo(stage, stageStatus);
          setCurrentOperation(message || stage);
        }
      }

      appendTimelineEvent({
        id: eventId,
        type: 'inspection_stage',
        stage,
        label: message || stage,
        status: stageStatus,
        timestamp,
      });
    } else if (type === 'node_started') {
      const node = data?.node || 'stage';
      const stageId = NODE_TO_STAGE[node];
      let label = `Running stage: ${node}`;

      if (stageId) {
        const canonical = CANONICAL_STAGES.find((s) => s.id === stageId);
        label = canonical ? canonical.label : node;
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

      if (node === 'ingest' || node === 'retrieve') label = 'Inspection report parsed';
      else if (node === 'extract_findings') label = 'Observations extracted from report text';
      else if (node === 'validate_findings') label = 'Observations validated against schema';
      else if (node === 'retrieve_sop') label = 'Knowledge Base SOP search completed';
      else if (node === 'check_sop_evidence') label = 'SOP evidence sufficiency confirmed';
      else if (node === 'assess_risk') label = 'Operational risk evaluated';
      else if (node === 'validate_risk') label = 'Risk & recommendation validated';
      else if (node === 'validate_citations') label = 'Citations verified';
      else if (node === 'generate_report') label = 'Approval Note DOCX deliverable compiled';

      appendTimelineEvent({
        id: eventId,
        type: 'node_completed',
        node,
        label,
        status: 'complete',
        timestamp,
      });
    } else if (type === 'observations_extracted') {
      if (Array.isArray(data?.observations)) {
        setCandidateObservations(data.observations);
      }
    } else if (type === 'findings_extracted') {
      // Authoritative validated findings emitted only after evidence gate confirmation
      if (Array.isArray(data?.findings)) {
        setFindings(data.findings);
      }
    } else if (type === 'sop_matched') {
      if (Array.isArray(data?.sopEvidence)) {
        setSopEvidence(data.sopEvidence);
      }
    } else if (type === 'risk_assessed') {
      const primaryRisk = data?.riskAssessment || (Array.isArray(data?.riskAssessments) ? data.riskAssessments[0] : null);
      if (primaryRisk) {
        setRiskAssessment(primaryRisk);
      }
      const rec = data?.recommendation || (Array.isArray(data?.recommendations) ? data.recommendations[0] : null);
      if (rec) {
        setRecommendation(rec);
      }
      if (Array.isArray(data?.citations)) {
        setCitations(data.citations);
      }
    } else if (type === 'report_generated') {
      if (data?.reportFilename) {
        const url = `/api/v1/inspection/download/${encodeURIComponent(data.reportFilename)}`;
        setApprovalNote({
          filename: data.reportFilename,
          downloadUrl: url,
        });
        setDownloadUrl(url);
      }
    } else if (type === 'validation') {
      const validator = data?.validator || 'validation';
      let label = `Validation: ${validator}`;
      if (validator === 'validate_findings') {
        label = data?.valid
          ? `Findings validated (${data?.observationsCount || 0} confirmed)`
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
      advanceStageTo('COMPLETED', 'completed');

      if (data?.reportFilename) {
        const url = data?.downloadUrl || `/api/v1/inspection/download/${encodeURIComponent(data.reportFilename)}`;
        setApprovalNote({
          reportId: data?.reportId || null,
          filename: data.reportFilename,
          downloadUrl: url,
        });
        setReportId(data?.reportId || null);
        setDownloadUrl(url);
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
          if (stageId === 'VALIDATING_SOP_EVIDENCE') {
            next[stageId] = { ...next[stageId], status: 'completed', message: 'No authoritative SOP evidence' };
            passedStop = true;
          } else if (passedStop) {
            next[stageId] = { ...next[stageId], status: 'skipped' };
          }
        }
        return next;
      });

      setFindings([]);
      setRiskAssessment(null);
      setRecommendation(null);
      setApprovalNote(null);
      setReportId(null);
      setDownloadUrl(null);

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
    advanceStageTo('READING_REPORT', 'running');
    setCurrentOperation('Reading report');
    setTimeline([]);
    setCandidateObservations([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setReportId(null);
    setDownloadUrl(null);
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
      const resData = response?.data || response;
      const data = resData?.data || resData;

      const returnedFindings = Array.isArray(data?.validatedFindings) && data.validatedFindings.length > 0
        ? data.validatedFindings
        : (Array.isArray(data?.findings) ? data.findings : []);

      let primaryRisk = null;
      if (data?.risk && typeof data.risk === 'object') {
        primaryRisk = data.risk;
      } else if (data?.riskAssessment && typeof data.riskAssessment === 'object') {
        primaryRisk = data.riskAssessment;
      } else if (Array.isArray(data?.riskAssessments) && data.riskAssessments.length > 0) {
        primaryRisk = data.riskAssessments[0];
      }

      let consolidatedRec = null;
      if (typeof data?.recommendation === 'string') {
        consolidatedRec = data.recommendation;
      } else if (Array.isArray(data?.recommendations) && data.recommendations.length > 0) {
        consolidatedRec = data.recommendations.join(' ');
      } else if (data?.recommendation && typeof data.recommendation === 'object') {
        consolidatedRec = data.recommendation.action || data.recommendation.recommendation || '';
      }

      const returnedCitations = Array.isArray(data?.citations) ? data.citations : [];

      let returnedNote = null;
      let safeDownloadUrl = data?.downloadUrl || null;
      if (data?.approvalNote && typeof data.approvalNote === 'object') {
        returnedNote = data.approvalNote;
        safeDownloadUrl = safeDownloadUrl || data.approvalNote.downloadUrl;
      } else if (safeDownloadUrl) {
        const extractedFilename = safeDownloadUrl.split('/').pop() || 'Approval_Note.docx';
        returnedNote = {
          filename: data.filename || extractedFilename,
          downloadUrl: safeDownloadUrl,
        };
      } else if (data?.filename) {
        safeDownloadUrl = `/api/v1/inspection/download/${encodeURIComponent(data.filename)}`;
        returnedNote = {
          filename: data.filename,
          downloadUrl: safeDownloadUrl,
        };
      }

      const outcome = data?.orchestration?.workflowOutcome || (data?.status === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : 'SUCCESS');
      setWorkflowOutcome(outcome);

      if (outcome === 'INSUFFICIENT_EVIDENCE') {
        setStatus('stopped');
        setCurrentOperation('Terminated: Insufficient Evidence');
        setFindings([]);
        setRiskAssessment(null);
        setRecommendation(null);
        setCitations([]);
        setApprovalNote(null);
        setDownloadUrl(null);

        setStageStates((prev) => {
          const next = { ...prev };
          let passedStop = false;
          for (const sId of STAGE_ORDER) {
            if (sId === 'VALIDATING_SOP_EVIDENCE') {
              next[sId] = { ...next[sId], status: 'completed', message: 'No authoritative SOP evidence' };
              passedStop = true;
            } else if (passedStop) {
              next[sId] = { ...next[sId], status: 'skipped' };
            }
          }
          return next;
        });
      } else {
        setFindings(returnedFindings);
        setRiskAssessment(primaryRisk);
        setRecommendation(consolidatedRec);
        setCitations(returnedCitations);
        setApprovalNote(returnedNote);
        setReportId(data?.reportId || returnedNote?.reportId || null);
        setDownloadUrl(safeDownloadUrl);
        setStatus('completed');
        setCurrentOperation('Completed');
        advanceStageTo('COMPLETED', 'completed');
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
  }, [status, advanceStageTo, handleSseEvent, appendTimelineEvent]);

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
          advanceStageTo('COMPLETED', 'completed');
          if (res.data.report?.filename) {
            const url = `/api/v1/inspection/download/${encodeURIComponent(res.data.report.filename)}`;
            setApprovalNote({
              reportId: res.data.report.reportId || null,
              filename: res.data.report.filename,
              downloadUrl: url,
            });
            setReportId(res.data.report.reportId || null);
            setDownloadUrl(url);
          }
        } else if (res.data.status === 'failed') {
          setStatus('failed');
          setError(res.data.error || 'Inspection run recorded as failed');
        }
      }
    } catch (err) {
      console.warn('[useInspectionExecution] Failed to fetch run snapshot:', err.message);
    }
  }, [advanceStageTo, handleSseEvent]);

  /**
   * Download the generated Approval Note DOCX.
   */
  const downloadNote = useCallback(async (customUrlOrFilename) => {
    const target = customUrlOrFilename || downloadUrl || approvalNote?.downloadUrl || approvalNote?.filename;
    if (!target) {
      setDownloadError('No generated report file available to download.');
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    try {
      await downloadApprovalNote(target, approvalNote?.filename);
    } catch (err) {
      setDownloadError(err?.message || 'Failed to download report file.');
    } finally {
      setIsDownloading(false);
    }
  }, [approvalNote, downloadUrl]);

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
    setCandidateObservations([]);
    setFindings([]);
    setSopEvidence([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setApprovalNote(null);
    setReportId(null);
    setDownloadUrl(null);
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
    candidateObservations,
    findings,
    validatedFindings: findings,
    sopEvidence,
    riskAssessment,
    risk: riskAssessment,
    recommendation,
    citations,
    approvalNote,
    reportId,
    downloadUrl,
    error,
    workflowOutcome,
    isDownloading,
    downloadError,
    isRunning: status === 'running',
    isInsufficientEvidence: workflowOutcome === 'INSUFFICIENT_EVIDENCE',
    runWorkflow,
    reconnectRun,
    downloadNote,
    downloadApprovalNote: downloadNote,
    reset,
  };
}
