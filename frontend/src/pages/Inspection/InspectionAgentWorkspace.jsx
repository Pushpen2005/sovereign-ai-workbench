/**
 * COMPONENT — InspectionAgentWorkspace.jsx
 *
 * Industrial Agent Workspace for Confidential Inspection Analysis and Approval Note Generation.
 * Powered by LangGraph StateGraph pipeline, Qdrant SOP vector matching, and real-time SSE streaming.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useInspectionExecution } from '../../hooks/useInspectionExecution.js';
import { useDocuments } from '../../hooks/useDocuments.js';

// Structured Finding Card (Evidence-First Presentation)
function FindingCard({ finding, index }) {
  return (
    <Card className="!p-4 bg-white border-slate-200 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center">
            #{index + 1}
          </span>
          <p className="text-sm font-bold text-slate-900">
            {finding.finding || 'Inspection Finding'}
          </p>
        </div>
        <StatusBadge status={finding.severity || 'MEDIUM'} />
      </div>

      {/* Grid of Equipment, Observed Value, Operating Limit */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-700">
        <div>
          <span className="block text-[10px] uppercase font-semibold text-slate-400">Equipment</span>
          <span className="font-semibold text-slate-900">{finding.equipment || 'Not specified'}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase font-semibold text-slate-400">Observed Value</span>
          <span className="font-semibold text-slate-900 text-amber-700">{finding.observedValue || '—'}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase font-semibold text-slate-400">Operating Limit</span>
          <span className="font-semibold text-slate-900">{finding.limit || '—'}</span>
        </div>
      </div>

      {/* Verbatim Evidence Quote */}
      {finding.evidence && (
        <div className="p-3 bg-blue-50/50 border-l-2 border-blue-500 rounded-r-lg text-xs text-slate-800 leading-relaxed">
          <strong className="text-blue-900">Verbatim Evidence:</strong> &ldquo;{finding.evidence}&rdquo;
        </div>
      )}

      {/* Source Citation */}
      {finding.source && (
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <span className="font-medium text-slate-700">📄 {finding.source.filename || 'Inspection Report'}</span>
          <span>· Page {finding.source.page ?? '1'}</span>
          {finding.source.score != null && (
            <span>· Match: {(finding.source.score * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
    </Card>
  );
}

// SOP Evidence Card
function SopEvidenceCard({ chunk }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col gap-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
          <span>📘</span>
          <span>{chunk.filename || 'Standard Operating Procedure'}</span>
          <span className="text-slate-400 text-[11px]">· Page {chunk.page ?? '1'}</span>
        </div>
        {chunk.score != null && (
          <span className="text-[10px] font-mono bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
            {(chunk.score * 100).toFixed(0)}% match
          </span>
        )}
      </div>
      <p className="text-slate-700 italic bg-white p-2.5 rounded border border-slate-100 leading-relaxed">
        &ldquo;{chunk.text?.trim() || 'Authoritative SOP excerpt'}&rdquo;
      </p>
    </div>
  );
}

export function InspectionAgentWorkspace() {
  const { documents, selectedDocument, selectDocument } = useDocuments();
  const {
    status,
    runId,
    canonicalStages,
    stageStates,
    currentOperation,
    elapsedSeconds,
    findings,
    sopEvidence,
    riskAssessment,
    recommendation,
    approvalNote,
    error,
    isDownloading,
    downloadError,
    isRunning,
    isInsufficientEvidence,
    runWorkflow,
    reconnectRun,
    downloadNote,
    reset,
  } = useInspectionExecution();

  const [selectedDocId, setSelectedDocId] = useState('');
  const [taskPrompt, setTaskPrompt] = useState(
    'Analyze this inspection report, extract all significant findings, evaluate against maintenance SOPs, and prepare approval note.'
  );
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);

  // Check URL query parameters for runId to support reconnecting on refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const existingRunId = params.get('runId');
    if (existingRunId && !runId) {
      reconnectRun(existingRunId);
    }
  }, [reconnectRun, runId]);

  const effectiveDocId =
    selectedDocId ||
    selectedDocument?.documentId ||
    selectedDocument?.id ||
    documents[0]?.documentId ||
    documents[0]?.id ||
    '';

  const handleSelectChange = (e) => {
    const val = e.target.value;
    setSelectedDocId(val);
    setValidationError('');
    const matched = documents.find((d) => (d.documentId || d.id) === val);
    if (matched) selectDocument(matched);
  };

  const handleRunInspection = async () => {
    const targetDocId = selectedDocId || effectiveDocId;
    if (!targetDocId) {
      setValidationError('Please select an inspection report or upload a new PDF first.');
      return;
    }
    setValidationError('');
    await runWorkflow(targetDocId, taskPrompt);
  };

  const handleUploadNew = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setValidationError('');
    await runWorkflow(file, taskPrompt);
  };

  const selectedDocObj = documents.find((d) => (d.documentId || d.id) === effectiveDocId);

  // Status mapping for header badge
  let headerStatusBadge = 'IDLE';
  let headerStatusColor = 'bg-slate-100 text-slate-700 border-slate-300';
  if (isRunning) {
    headerStatusBadge = 'ANALYSING';
    headerStatusColor = 'bg-blue-50 text-blue-800 border-blue-300 animate-pulse';
  } else if (status === 'completed') {
    headerStatusBadge = 'COMPLETED';
    headerStatusColor = 'bg-emerald-50 text-emerald-800 border-emerald-300';
  } else if (isInsufficientEvidence) {
    headerStatusBadge = 'INSUFFICIENT EVIDENCE';
    headerStatusColor = 'bg-amber-50 text-amber-800 border-amber-300';
  } else if (status === 'failed') {
    headerStatusBadge = 'FAILED';
    headerStatusColor = 'bg-red-50 text-red-800 border-red-300';
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ─── SECTION A: AGENT WORKSPACE HEADER ─── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Inspection Approval Agent
            </h2>
            <span
              className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${headerStatusColor}`}
              role="status"
              aria-live="polite"
            >
              ● {headerStatusBadge}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            AI-assisted inspection analysis and approval note generation
          </p>
        </div>

        {/* Runtime Metadata Chips */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Selected Model</span>
            <span className="font-mono font-bold text-slate-800">llama3.2:3b</span>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Hardware Engine</span>
            <span className="font-mono font-semibold text-slate-700">Apple Silicon Metal</span>
          </div>

          {runId && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <span className="text-slate-400 block text-[10px] font-semibold uppercase">Run ID</span>
              <span className="font-mono text-slate-700" title={runId}>
                {runId.length > 20 ? `${runId.slice(0, 18)}…` : runId}
              </span>
            </div>
          )}

          {status !== 'idle' && (
            <Button
              variant="outline"
              onClick={reset}
              disabled={isRunning}
              className="!py-1.5 !px-3 text-xs"
              aria-label="Start new analysis"
            >
              New Analysis
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ─── LEFT COLUMN: INPUT & REAL-TIME ACTIVITY TIMELINE (5 cols) ─── */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Section B: Inspection Input */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <label htmlFor="report-select" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Inspection Report
              </label>
              <button
                type="button"
                onClick={handleUploadNew}
                disabled={isRunning}
                className="text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1"
                aria-label="Upload inspection report PDF"
              >
                <span>↑</span> Upload Report PDF
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            <select
              id="report-select"
              value={effectiveDocId}
              onChange={handleSelectChange}
              disabled={isRunning}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {documents.length === 0 ? (
                <option value="">No indexed reports found</option>
              ) : (
                documents.map((d) => (
                  <option key={d.id || d.documentId} value={d.id || d.documentId}>
                    {d.originalFilename || d.filename} {d.status ? `(${d.status})` : ''}
                  </option>
                ))
              )}
            </select>

            {selectedDocObj && (
              <div className="text-[11px] text-slate-500 bg-slate-50 rounded p-2 flex items-center justify-between border border-slate-200">
                <span className="truncate">File: <strong>{selectedDocObj.originalFilename || selectedDocObj.filename}</strong></span>
                <span className="font-mono text-emerald-700 font-bold shrink-0">{selectedDocObj.status || 'Indexed'}</span>
              </div>
            )}

            {/* Directive */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="analysis-directive" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Analysis Directive
              </label>
              <textarea
                id="analysis-directive"
                rows={2}
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                disabled={isRunning}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {/* Start Button */}
            <Button
              variant="primary"
              onClick={handleRunInspection}
              disabled={isRunning || (!effectiveDocId && documents.length === 0)}
              className="w-full justify-center !py-2.5 font-bold text-xs"
              aria-label="Start Inspection Agent workflow"
            >
              {isRunning ? 'Analyzing Inspection Report…' : '⚡ Start Inspection Agent'}
            </Button>

            {validationError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200 font-medium">
                {validationError}
              </p>
            )}
          </div>

          {/* Section C: Agent Activity Timeline */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Agent Activity Timeline
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                LangGraph StateGraph
              </span>
            </div>

            {/* Section D: Current Operation & Truthful Elapsed Time */}
            <div className="p-3 bg-slate-900 text-white rounded-lg flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 truncate">
                {isRunning ? (
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping shrink-0" />
                ) : (
                  <span className="text-slate-400">●</span>
                )}
                <div className="truncate">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 block">Current Operation</span>
                  <span className="font-bold truncate">{currentOperation}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] uppercase font-semibold text-slate-400 block">Elapsed</span>
                <span className="font-mono font-bold text-amber-400 text-sm">
                  {elapsedSeconds > 0 ? `${elapsedSeconds}s` : '—'}
                </span>
              </div>
            </div>

            {/* 8 Canonical Stages */}
            <div className="flex flex-col gap-2.5 pt-1">
              {canonicalStages.map((stage) => {
                const state = stageStates[stage.id] || { status: 'pending' };
                const st = state.status;

                let icon = '○';
                let rowStyle = 'bg-slate-50/60 border-slate-200 text-slate-500';
                let iconStyle = 'text-slate-400 font-mono';

                if (st === 'running') {
                  icon = '⚡';
                  rowStyle = 'bg-blue-50 border-blue-300 text-blue-900 font-semibold shadow-sm ring-1 ring-blue-300';
                  iconStyle = 'text-blue-600 animate-bounce';
                } else if (st === 'completed') {
                  icon = '✓';
                  rowStyle = 'bg-emerald-50/70 border-emerald-200 text-emerald-950 font-medium';
                  iconStyle = 'text-emerald-700 font-bold';
                } else if (st === 'failed') {
                  icon = '✗';
                  rowStyle = 'bg-red-50 border-red-200 text-red-900';
                  iconStyle = 'text-red-600 font-bold';
                } else if (st === 'skipped') {
                  icon = '—';
                  rowStyle = 'bg-slate-50/40 border-slate-100 text-slate-400 line-through';
                  iconStyle = 'text-slate-400';
                }

                return (
                  <div
                    key={stage.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs transition-all ${rowStyle}`}
                    role="listitem"
                  >
                    <span className={`w-5 text-center text-sm shrink-0 ${iconStyle}`}>
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{stage.label}</span>
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-70">
                          {st}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-75 truncate">{stage.description}</p>
                      {state.message && (
                        <p className="text-[11px] text-red-700 font-medium mt-0.5">{state.message}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── RIGHT COLUMN: DELIVERABLES, EVIDENCE & AUDIT PANELS (7 cols) ─── */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Section 5: Failure Notice Card */}
          {error && (
            <div
              role="alert"
              className="p-4 bg-red-50 border border-red-300 rounded-xl text-xs text-red-900 flex flex-col gap-2 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-red-700">✗</span>
                <strong className="text-sm font-bold text-red-900">Inspection Analysis Error</strong>
              </div>
              <p className="leading-relaxed">{error}</p>
              <div className="flex items-center justify-between pt-2 border-t border-red-200">
                <span className="font-mono text-[11px] text-red-700">Run: {runId || 'N/A'}</span>
                <Button
                  variant="outline"
                  onClick={handleRunInspection}
                  className="!py-1 !px-3 text-xs bg-white text-red-800 border-red-300"
                >
                  Retry Analysis
                </Button>
              </div>
            </div>
          )}

          {/* Section 5: Insufficient Evidence Safe Refusal Alert */}
          {isInsufficientEvidence && (
            <div
              role="alert"
              className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 flex flex-col gap-2 shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">⚠</span>
                <strong className="text-sm font-bold text-amber-900">Insufficient SOP Evidence</strong>
              </div>
              <p className="leading-relaxed">
                No sufficient SOP evidence was found. The system did not generate a grounded risk recommendation.
                The observed finding does not align with any validated standard operating procedure in the confidential knowledge base.
              </p>
            </div>
          )}

          {/* Section E: Findings Panel */}
          {findings && findings.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Extracted Findings ({findings.length})
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">Grounded in verbatim report text</span>
              </div>
              <div className="flex flex-col gap-3">
                {findings.map((f, idx) => (
                  <FindingCard key={idx} finding={f} index={idx} />
                ))}
              </div>
            </div>
          ) : (
            !isRunning && (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center justify-center gap-2 shadow-sm">
                <span className="text-3xl">⚙</span>
                <p className="text-sm font-semibold text-slate-800">
                  Ready for Inspection Analysis
                </p>
                <p className="text-xs text-slate-400 max-w-sm">
                  Select an industrial report and click &ldquo;Start Inspection Agent&rdquo; to begin grounded extraction and audit note generation.
                </p>
              </div>
            )
          )}

          {/* Section F: SOP Evidence Panel */}
          {sopEvidence && sopEvidence.length > 0 && !isInsufficientEvidence && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Retrieved SOP Evidence ({sopEvidence.length})
                </h3>
                <span className="text-[11px] font-mono text-blue-700 font-semibold">Qdrant Vectorstore</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {sopEvidence.map((chunk, idx) => (
                  <SopEvidenceCard key={idx} chunk={chunk} index={idx} />
                ))}
              </div>
            </div>
          )}

          {/* Section G: Risk Panel */}
          {riskAssessment && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    AI Risk Assessment
                  </h3>
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                    Decision Support
                  </span>
                </div>
                <StatusBadge
                  status={riskAssessment.level || (isInsufficientEvidence ? 'INSUFFICIENT EVIDENCE' : 'MEDIUM')}
                />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-800 leading-relaxed">
                <p>
                  <strong>Evaluated Risk:</strong> {riskAssessment.reason || 'Risk determined based on threshold exceedance and SOP procedure.'}
                </p>
                <p className="mt-2 text-[11px] text-slate-500 italic">
                  Advisory baseline only. Formal sign-off requires qualified inspection engineer approval.
                </p>
              </div>
            </div>
          )}

          {/* Section H: Recommendation Panel */}
          {recommendation && !isInsufficientEvidence && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Validated Recommendation
                </h3>
                <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                  Requires Human Sign-off
                </span>
              </div>
              <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3.5 text-xs text-emerald-950 leading-relaxed font-medium">
                {recommendation}
              </div>
            </div>
          )}

          {/* Section I: Report Generation & Download Deliverable */}
          {approvalNote && (
            <div className="flex flex-col gap-3">
              {/* Human Governance Boundary Banner */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">🛡</span>
                  <div>
                    <strong className="text-slate-800 block text-xs">Human Governance Boundary</strong>
                    <span className="text-[11px] text-slate-500">
                      Formal sign-off requires plant authority review in Section 8 of the note.
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded whitespace-nowrap">
                  Pending Human Approval
                </span>
              </div>

              {/* Official Approval Note Deliverable Box */}
              <div className="bg-slate-900 text-white rounded-xl p-5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-xl">
                    📄
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white">Official Approval Note</h4>
                      <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded">
                        ✓ GENERATED
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      {approvalNote.filename} · Executive DOCX Deliverable
                    </p>
                  </div>
                </div>

                <Button
                  variant="primary"
                  onClick={() => downloadNote()}
                  disabled={isDownloading}
                  className="!py-2 !px-4 text-xs font-bold shrink-0 shadow-lg"
                  aria-label="Download generated Approval Note DOCX"
                >
                  {isDownloading ? 'Downloading…' : '📥 Download Approval Note'}
                </Button>
              </div>

              {downloadError && (
                <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
                  {downloadError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InspectionAgentWorkspace;
