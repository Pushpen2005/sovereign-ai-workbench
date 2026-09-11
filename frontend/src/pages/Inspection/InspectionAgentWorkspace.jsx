/**
 * COMPONENT — InspectionAgentWorkspace.jsx
 *
 * Industrial Inspection Agent Workspace
 * Multi-step, grounded, observable analysis of industrial inspection reports
 * with real-time LangGraph SSE execution and executive Approval Note DOCX deliverable.
 */

import React, { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';
import { useInspectionExecution, CANONICAL_STAGES } from '../../hooks/useInspectionExecution.js';

function displayValue(value, fallback = '—') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => displayValue(item, '')).filter(Boolean).join(', ') || fallback;
  }
  if (typeof value === 'object') {
    const preferred = value.text || value.value || value.label || value.name || value.filename;
    return preferred != null ? displayValue(preferred, fallback) : JSON.stringify(value);
  }
  return fallback;
}

export function InspectionAgentWorkspace() {
  const { documents, selectedDocument, selectDocument } = useDocuments({ documentType: 'inspection' });

  const {
    status,
    stageStates,
    currentOperation,
    findings,
    sopEvidence,
    riskAssessment,
    recommendation,
    citations,
    approvalNote,
    downloadUrl,
    error: executionError,
    workflowOutcome,
    isDownloading,
    downloadError,
    downloadApprovalNote,
    runWorkflow,
  } = useInspectionExecution();

  const [selectedDocId, setSelectedDocId] = useState('');
  const [localError, setLocalError] = useState(null);

  const effectiveDocId =
    selectedDocId ||
    selectedDocument?.documentId ||
    selectedDocument?.id ||
    documents[0]?.documentId ||
    documents[0]?.id ||
    '';

  const selectedDocObj = documents.find((d) => (d.documentId || d.id) === effectiveDocId);

  const handleSelectChange = (e) => {
    const val = e.target.value;
    setSelectedDocId(val);
    setLocalError(null);
    const matched = documents.find((d) => (d.documentId || d.id) === val);
    if (matched) selectDocument(matched);
  };

  const isRunning = status === 'running';
  const isInsufficientEvidence =
    workflowOutcome === 'INSUFFICIENT_EVIDENCE' || (status === 'stopped' && findings.length === 0);

  const hasSuccessfulDeliverables =
    status === 'completed' &&
    riskAssessment !== null &&
    recommendation !== null &&
    (approvalNote !== null || downloadUrl !== null);

  const hasResults =
    hasSuccessfulDeliverables ||
    isInsufficientEvidence ||
    findings.length > 0 ||
    riskAssessment !== null;

  const displayError = localError || executionError;

  const handleRunAnalysis = async () => {
    if (!effectiveDocId) {
      setLocalError('Please select an inspection report first.');
      return;
    }
    setLocalError(null);

    runWorkflow({
      documentId: effectiveDocId,
      filePath: selectedDocObj?.filePath,
      filename: selectedDocObj?.filename || selectedDocObj?.originalFilename,
    });
  };

  const handleDownload = async () => {
    const target = downloadUrl || approvalNote?.downloadUrl || approvalNote?.filename;
    if (!target) return;
    await downloadApprovalNote(target);
  };

  const headerStatusLabel = isRunning
    ? 'ANALYSING'
    : hasSuccessfulDeliverables
    ? 'COMPLETED'
    : isInsufficientEvidence
    ? 'INSUFFICIENT EVIDENCE'
    : status === 'failed'
    ? 'FAILED'
    : 'IDLE';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Inspection Agent
            </h2>
            <span
              className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                isRunning
                  ? 'bg-blue-50 text-blue-800 border-blue-300 animate-pulse'
                  : hasSuccessfulDeliverables
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : isInsufficientEvidence
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : status === 'failed'
                  ? 'bg-red-50 text-red-800 border-red-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              ● {headerStatusLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Sovereign LangGraph Orchestration with Knowledge Base SOP Evidence Gate
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Engine</span>
            <span className="font-mono font-semibold text-slate-800">Gemma MLX :8080</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Knowledge Base</span>
            <span className="font-mono font-semibold text-slate-800">Qdrant Vector Store</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Report Selection & Agent Activity */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Document Selection Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <label htmlFor="inspection-report-select" className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Document
            </label>
            <select
              id="inspection-report-select"
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

            <Button
              variant="primary"
              onClick={handleRunAnalysis}
              disabled={isRunning || !effectiveDocId}
              className="w-full justify-center !py-2.5 font-bold text-xs"
            >
              {isRunning ? 'Generating Approval Doc…' : 'Generate Approval Doc'}
            </Button>

            {displayError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200 font-medium">
                {displayError}
              </p>
            )}
          </div>

          {/* Agent Activity Timeline */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Pipeline Execution
                </h3>
                <p className="text-[11px] text-slate-400">Grounded 8-Stage LangGraph State Machine</p>
              </div>
              {isRunning && (
                <span className="text-[11px] font-mono text-blue-600 font-bold animate-pulse">
                  {currentOperation}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {CANONICAL_STAGES.map((s) => {
                const stageState = stageStates[s.id] || { status: 'pending' };
                const st = stageState.status;

                let icon = '○';
                let rowStyle = 'bg-slate-50/60 border-slate-200 text-slate-500';
                let iconStyle = 'text-slate-400';

                if (st === 'running') {
                  icon = '⚡';
                  rowStyle = 'bg-blue-50 border-blue-300 text-blue-900 font-semibold shadow-sm ring-1 ring-blue-300';
                  iconStyle = 'text-blue-600 animate-bounce';
                } else if (st === 'completed') {
                  icon = '✓';
                  rowStyle = 'bg-emerald-50/70 border-emerald-200 text-emerald-950 font-medium';
                  iconStyle = 'text-emerald-700 font-bold';
                } else if (st === 'skipped') {
                  icon = '—';
                  rowStyle = 'bg-slate-50/40 border-slate-200 text-slate-400 opacity-60';
                  iconStyle = 'text-slate-400';
                } else if (st === 'failed') {
                  icon = '✕';
                  rowStyle = 'bg-red-50 border-red-200 text-red-900 font-medium';
                  iconStyle = 'text-red-600 font-bold';
                }

                return (
                  <div
                    key={s.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs transition-all ${rowStyle}`}
                  >
                    <span className={`w-5 text-center text-sm shrink-0 ${iconStyle}`}>
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{s.label}</span>
                        <span className="text-[10px] uppercase font-mono tracking-wider opacity-70">
                          {st}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-75 truncate">{s.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Grounded Inspection Results Hierarchy & Approval Note Deliverable */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {!hasResults && !isRunning && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center justify-center gap-2 shadow-sm">
              <span className="text-3xl">⚙</span>
              <p className="text-sm font-semibold text-slate-800">
                Ready to analyze
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                Select an inspection report and click &ldquo;Analyze Inspection Report&rdquo; to execute the multi-step agent workflow.
              </p>
            </div>
          )}

          {isInsufficientEvidence && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-6 shadow-sm flex flex-col gap-3 text-amber-950">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚠️</span>
                <h3 className="font-bold text-sm tracking-tight uppercase">
                  INSUFFICIENT EVIDENCE
                </h3>
              </div>
              <p className="text-xs leading-relaxed">
                Analysis halted at the Knowledge Base Evidence Gate. No sufficiently relevant SOP evidence was found in the Knowledge Base for the reported observations within approved tenant boundaries.
              </p>
              <p className="text-[11px] text-amber-800 font-medium">
                Per SovereignAI safety constraints, risks and recommendations are never hallucinated from unsupported observations, and no Approval Note DOCX was generated.
              </p>
            </div>
          )}

          {hasResults && !isInsufficientEvidence && (
            <div className="flex flex-col gap-5">
              {/* 1. INSPECTION FINDINGS */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    INSPECTION FINDINGS ({findings.length})
                  </h3>
                  <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Validated Findings
                  </span>
                </div>

                {findings.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No validated abnormal findings recorded.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {findings.map((f, idx) => (
                      <Card key={idx} className="!p-3.5 bg-slate-50/50 border-slate-200 flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{displayValue(f.finding)}</span>
                          <StatusBadge status={displayValue(f.severity, 'MEDIUM')} />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white p-2.5 rounded border border-slate-200 text-[11px]">
                          {f.equipment && (
                            <div>
                              <span className="text-slate-400 block text-[9px] uppercase font-semibold">Equipment</span>
                              <span className="font-semibold text-slate-800 truncate block">{displayValue(f.equipment)}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Observed</span>
                            <span className="font-semibold text-amber-800 font-mono">{displayValue(f.observedValue)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Limit</span>
                            <span className="font-semibold text-slate-700 font-mono">{displayValue(f.limit)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Source / Page</span>
                            <span className="text-slate-600 truncate block">
                              {displayValue(f.source, 'Report')}{f.page ? ` (p. ${displayValue(f.page)})` : ''}
                            </span>
                          </div>
                        </div>
                        {f.evidence && (
                          <div className="bg-white p-2 rounded border border-slate-100 text-[11px] text-slate-600 italic">
                            &ldquo;{displayValue(f.evidence)}&rdquo;
                          </div>
                        )}
                        {Array.isArray(f?.sopEvidence) && f.sopEvidence[0]?.filename && (
                          <div className="text-[10px] text-blue-700 bg-blue-50/50 p-1.5 rounded border border-blue-100 flex items-center gap-1.5">
                            <span className="font-semibold">SOP Evidence:</span>
                            <span>{f.sopEvidence[0].filename} (Page {f.sopEvidence[0].page ?? 1})</span>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. TECHNICAL ANALYSIS */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    TECHNICAL ANALYSIS
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Operating Parameter Verification
                  </span>
                </div>

                <div className="flex flex-col gap-2.5">
                  {findings.map((f, idx) => {
                    const analysisText = f.analysis || f.technicalAnalysis;
                    return (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-800 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{displayValue(f.equipment || f.finding)}</span>
                          {f.observedValue && f.limit && (
                            <span className="font-mono text-[11px] font-semibold text-slate-600">
                              {displayValue(f.observedValue)} vs. {displayValue(f.limit)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-700 leading-relaxed">
                          {displayValue(
                            analysisText,
                            'Observed parameter evaluated directly against authoritative Standard Operating Procedure (SOP) operating threshold.'
                          )}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. RISK ASSESSMENT */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    RISK ASSESSMENT
                  </h3>
                  {riskAssessment?.level && (
                    <StatusBadge status={riskAssessment.level} />
                  )}
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-col gap-2.5">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                      Level:
                    </span>
                    <span className="text-sm font-bold text-slate-900 tracking-tight font-mono">
                      {riskAssessment?.level || '—'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                      Reason:
                    </span>
                    <p className="text-xs text-slate-800 leading-relaxed font-normal mt-0.5">
                      {riskAssessment?.reason || 'Evaluated against operational criteria.'}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 italic">
                    Grounded in validated Standard Operating Procedure limits. Requires authorized plant authority review prior to dispatch.
                  </div>
                </div>
              </div>

              {/* 4. RECOMMENDATION */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    RECOMMENDATION
                  </h3>
                </div>
                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-950 font-medium leading-relaxed">
                  {displayValue(
                    typeof recommendation === 'string'
                      ? recommendation
                      : recommendation?.action || recommendation?.recommendation
                  )}
                </div>
              </div>

              {/* 5. REFERENCES */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    REFERENCES ({citations.length || sopEvidence.length})
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Knowledge Base SOP Evidence
                  </span>
                </div>

                {(citations.length === 0 && sopEvidence.length === 0) ? (
                  <p className="text-xs text-slate-500 italic">No validated SOP citations recorded.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(citations.length > 0 ? citations : sopEvidence).map((c, idx) => (
                      <div key={idx} className="flex flex-col gap-1 p-3 bg-slate-50 rounded border border-slate-200 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span>📄</span>
                            <span className="font-semibold text-slate-800 font-mono text-[11px]">{displayValue(c.filename, 'Evidence')}</span>
                            {c.page != null && <span className="text-slate-400">· Page {displayValue(c.page)}</span>}
                            {c.chunkIndex != null && (
                              <span className="text-slate-400 font-mono text-[10px]">(Chunk {displayValue(c.chunkIndex)})</span>
                            )}
                          </div>
                          {c.score != null && (
                            <span className="text-[10px] font-mono bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                              {(c.score * 100).toFixed(0)}% match
                            </span>
                          )}
                        </div>
                        {c.text && (
                          <p className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-100 line-clamp-3">
                            &ldquo;{displayValue(c.text)}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. APPROVAL NOTE & DOWNLOAD */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      APPROVAL NOTE
                    </h3>
                    <p className="text-[11px] text-emerald-700 font-semibold">
                      Generated successfully · Report saved to History
                    </p>
                  </div>
                  <span className="text-xs font-bold uppercase px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-full font-mono">
                    APPROVAL NOTE READY
                  </span>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-emerald-50/50 border border-emerald-200 rounded-lg">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📄</span>
                      <span className="text-xs font-bold text-slate-900 font-mono">
                        {approvalNote?.filename || 'Approval_Note.docx'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Executive deliverable compiled with validated observations, operating limits, risk assessment, and recommendation.
                    </p>
                  </div>

                  <Button
                    variant="primary"
                    onClick={handleDownload}
                    disabled={isDownloading || (!downloadUrl && !approvalNote?.downloadUrl && !approvalNote?.filename)}
                    className="shrink-0 !py-2.5 !px-5 text-xs font-bold justify-center shadow-sm"
                  >
                    {isDownloading ? 'Downloading…' : 'Download Approval Note (.docx)'}
                  </Button>
                </div>

                {downloadError && (
                  <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                    {downloadError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InspectionAgentWorkspace;
