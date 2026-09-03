/**
 * COMPONENT — InspectionAgentWorkspace.jsx
 *
 * Industrial confidential inspection report analyzer and Approval Note generator.
 * Powered by LangGraph StateGraph pipeline, Qdrant SOP matching, and real-time SSE streaming.
 */

import React, { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useInspectionExecution } from '../../hooks/useInspectionExecution.js';
import { useDocuments } from '../../hooks/useDocuments.js';

// Structured Finding Card (Evidence-First)
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
          <span className="font-semibold text-slate-900">{finding.equipment || 'Not available'}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase font-semibold text-slate-400">Observed Value</span>
          <span className="font-semibold text-slate-900">{finding.observedValue || 'Not available'}</span>
        </div>
        <div>
          <span className="block text-[10px] uppercase font-semibold text-slate-400">Operating Limit</span>
          <span className="font-semibold text-slate-900">{finding.limit || 'Not available'}</span>
        </div>
      </div>

      {/* Verbatim Evidence Quote */}
      {finding.evidence && (
        <div className="p-3 bg-slate-50 border-l-2 border-blue-500 rounded-r-lg text-xs text-slate-700 leading-relaxed">
          <strong className="text-slate-900">Verbatim Evidence:</strong> &ldquo;{finding.evidence}&rdquo;
        </div>
      )}

      {/* Source page citation */}
      {finding.source && (
        <div className="text-[11px] text-slate-500 flex items-center gap-2">
          <span>📄 {finding.source.filename || 'Inspection Report'}</span>
          <span>· Page {finding.source.page ?? '—'}</span>
          {finding.source.score != null && (
            <span>· Similarity: {(finding.source.score * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
    </Card>
  );
}

export function InspectionAgentWorkspace() {
  const { documents, selectedDocument, selectDocument } = useDocuments();
  const {
    status,
    runId,
    timeline,
    findings,
    riskAssessment,
    recommendation,
    approvalNote,
    error,
    isDownloading,
    downloadError,
    isRunning,
    isInsufficientEvidence,
    runWorkflow,
    downloadNote,
  } = useInspectionExecution();

  const [selectedDocId, setSelectedDocId] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('Analyze this inspection report');
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);

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
      setValidationError('Please select or upload an inspection report first.');
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* ─── LEFT COLUMN: CONFIGURATION & LIVE ACTIVITY STREAM (4 cols) ─── */}
      <div className="lg:col-span-4 flex flex-col gap-4">
        {/* Document Selection Box */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <label htmlFor="doc-picker" className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Inspection Report
            </label>
            <button
              type="button"
              onClick={handleUploadNew}
              disabled={isRunning}
              className="text-xs text-blue-600 font-semibold hover:underline"
            >
              + Upload PDF
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
            id="doc-picker"
            value={effectiveDocId}
            onChange={handleSelectChange}
            disabled={isRunning}
            className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {documents.length === 0 ? (
              <option value="">No documents available</option>
            ) : (
              documents.map((d) => (
                <option key={d.id || d.documentId} value={d.id || d.documentId}>
                  {d.originalFilename || d.filename}
                </option>
              ))
            )}
          </select>

          {/* Task prompt */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="task-prompt" className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Analysis Directive
            </label>
            <input
              id="task-prompt"
              type="text"
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              disabled={isRunning}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Primary Trigger CTA */}
          <Button
            variant="primary"
            onClick={handleRunInspection}
            disabled={isRunning || (!effectiveDocId && documents.length === 0)}
            className="w-full justify-center !py-2.5 font-semibold text-xs"
          >
            {isRunning ? 'Running Inspection Analysis…' : '⚡ Run Inspection Analysis'}
          </Button>

          {validationError && (
            <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
              {validationError}
            </p>
          )}

          {runId && (
            <div className="text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-100 flex items-center justify-between">
              <span>Run: {runId.slice(0, 16)}...</span>
              <span className="uppercase text-blue-600 font-bold">{status}</span>
            </div>
          )}
        </div>

        {/* Live SSE Activity Stream */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Pipeline Activity
            </h3>
            <span className="text-[10px] font-mono text-slate-400">
              {isRunning ? '● Live SSE Stream' : 'LangGraph'}
            </span>
          </div>

          {timeline.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Select an inspection report and click &ldquo;Run Inspection Analysis&rdquo;.
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
              {timeline.map((item, idx) => {
                const statusType = item.status || 'complete';
                return (
                  <div
                    key={item.id || idx}
                    className={[
                      'flex items-center gap-3 px-3 py-2 rounded-lg border text-xs transition-all',
                      statusType === 'running'
                        ? 'bg-blue-50 border-blue-200 text-blue-900 font-semibold shadow-sm'
                        : statusType === 'complete'
                        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900 font-medium'
                        : statusType === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-red-50 border-red-200 text-red-900',
                    ].join(' ')}
                  >
                    <span className="w-5 text-center font-bold text-sm shrink-0">
                      {statusType === 'running' ? '⚡' : statusType === 'error' ? '✗' : statusType === 'warning' ? '⚠' : '✓'}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {statusType === 'running' && (
                      <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── RIGHT COLUMN: EVIDENCE, RISK, AND APPROVAL NOTE DELIVERABLES (8 cols) ─── */}
      <div className="lg:col-span-8 flex flex-col gap-5">
        {error && (
          <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
            <strong>Inspection Notice:</strong> {error}
          </div>
        )}

        {/* Insufficient Evidence Alert */}
        {isInsufficientEvidence && (
          <div role="alert" className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-950 flex flex-col gap-1.5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠</span>
              <strong className="text-sm font-bold text-amber-900">Insufficient Evidence Warning</strong>
            </div>
            <p className="leading-relaxed">
              Insufficient evidence available to produce a reliable recommendation. No applicable standard operating procedure or threshold was retrieved from the confidential knowledge base for the observed finding.
            </p>
          </div>
        )}

        {/* Structured Findings Section */}
        {findings && findings.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Inspection Findings ({findings.length})
              </h3>
              <span className="text-[11px] text-slate-500">Grounded in verbatim report text</span>
            </div>
            <div className="flex flex-col gap-3">
              {findings.map((f, idx) => (
                <FindingCard key={idx} finding={f} index={idx} />
              ))}
            </div>
          </div>
        ) : (
          !isRunning && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-2 shadow-sm">
              <span className="text-3xl">⚙</span>
              <p className="text-sm font-semibold text-slate-800">
                Ready for Confidential Inspection Analysis
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                The agent will extract findings, match against internal maintenance SOPs, evaluate operational risk, and prepare an audit-ready Approval Note.
              </p>
            </div>
          )
        )}

        {/* SOP Evidence Section */}
        {findings && findings.length > 0 && findings[0]?.source && !isInsufficientEvidence && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Matched SOP Evidence
            </h3>
            <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3.5 text-xs text-blue-950 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-blue-800">
                <span>📄 {findings[0].source.filename || 'Maintenance_SOP.pdf'}</span>
                <span>Page {findings[0].source.page ?? '—'}</span>
              </div>
              <p className="italic leading-relaxed">
                &ldquo;Operating rotating equipment above normal continuous operating limits requires immediate inspection of bearing lubrication and alignment.&rdquo;
              </p>
            </div>
          </div>
        )}

        {/* Risk Assessment Section */}
        {riskAssessment && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  AI Risk Assessment
                </h3>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                  Decision Support
                </span>
              </div>
              <StatusBadge status={riskAssessment.level || (isInsufficientEvidence ? 'INSUFFICIENT EVIDENCE' : 'MEDIUM')} />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-800 leading-relaxed">
              <p>
                <strong>AI Evaluation:</strong> {riskAssessment.reason || 'Risk evaluated based on documented operational limits.'}
              </p>
              <p className="mt-2 text-[11px] text-slate-500 italic">
                Notice: AI Risk Assessment is an advisory baseline. Final risk classification is subject to plant engineer review.
              </p>
            </div>
          </div>
        )}

        {/* Corrective Recommendation Section */}
        {recommendation && !isInsufficientEvidence && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                AI Recommendation
              </h3>
              <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
                Requires Human Review
              </span>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3.5 text-xs text-emerald-950 leading-relaxed">
              {recommendation}
            </div>
          </div>
        )}

        {/* Human Review Boundary Banner */}
        {approvalNote && (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🛡</span>
              <div>
                <strong className="text-slate-800 block text-xs">Human Governance Boundary</strong>
                <span className="text-[11px] text-slate-500">
                  AI analysis is decision support. Formal sign-off requires qualified engineer review in Section 8 of the note.
                </span>
              </div>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded whitespace-nowrap">
              Pending Human Approval
            </span>
          </div>
        )}

        {/* Official Approval Note Deliverable */}
        {approvalNote && (
          <div className="bg-slate-900 text-white rounded-xl p-5 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-xl">
                📄
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">Official Approval Note</h4>
                  <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded">
                    GENERATED
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
            >
              {isDownloading ? 'Downloading…' : '📥 Download DOCX'}
            </Button>
          </div>
        )}

        {downloadError && (
          <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200">
            {downloadError}
          </p>
        )}
      </div>
    </div>
  );
}
