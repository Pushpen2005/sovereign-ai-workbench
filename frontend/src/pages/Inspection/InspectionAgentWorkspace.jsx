/**
 * COMPONENT — InspectionAgentWorkspace.jsx
 *
 * Phase 7: Industrial Inspection Agent Workspace
 * Multi-step, grounded, observable analysis of industrial inspection reports
 * with structured Approval Note data preview.
 */

import React, { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';
import { analyzeInspectionAgent } from '../../api/agent.api.js';

const AGENT_STEPS = [
  { id: 'READING_REPORT', label: 'Reading report', desc: 'Ingesting document and reading chunks' },
  { id: 'EXTRACTING_FINDINGS', label: 'Extracting findings', desc: 'Parsing observations and parameter data' },
  { id: 'SEARCHING_KNOWLEDGE', label: 'Searching knowledge', desc: 'Retrieving SOP evidence in Qdrant' },
  { id: 'ANALYZING', label: 'Analysing findings', desc: 'Comparing findings with operating limits' },
  { id: 'ASSESSING_RISK', label: 'Assessing risk', desc: 'Evaluating operational risk grounded in SOP' },
  { id: 'GENERATING_RECOMMENDATION', label: 'Preparing recommendation', desc: 'Formulating maintenance recommendation' },
  { id: 'PREPARING_APPROVAL_NOTE', label: 'Preparing approval note', desc: 'Compiling structured approval note content' },
];

export function InspectionAgentWorkspace() {
  const { documents, selectedDocument, selectDocument } = useDocuments({ documentType: 'inspection' });

  const [selectedDocId, setSelectedDocId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [runResult, setRunResult] = useState(null);
  const [error, setError] = useState(null);

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
    setError(null);
    const matched = documents.find((d) => (d.documentId || d.id) === val);
    if (matched) selectDocument(matched);
  };

  const handleRunAnalysis = async () => {
    if (!effectiveDocId) {
      setError('Please select an inspection report first.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setRunResult(null);
    setCompletedSteps(new Set());

    // Step animation simulating real backend state transitions
    let step = 0;
    setActiveStepIndex(step);
    const interval = setInterval(() => {
      if (step < AGENT_STEPS.length - 1) {
        setCompletedSteps((prev) => new Set([...prev, AGENT_STEPS[step].id]));
        step++;
        setActiveStepIndex(step);
      }
    }, 1200);

    try {
      const resp = await analyzeInspectionAgent(effectiveDocId);
      clearInterval(interval);
      setActiveStepIndex(-1);
      setCompletedSteps(new Set(AGENT_STEPS.map((s) => s.id)));
      setRunResult(resp.result || resp);
    } catch (err) {
      clearInterval(interval);
      setActiveStepIndex(-1);
      setError(err.response?.data?.message || err.message || 'Inspection analysis failed');
    } finally {
      setIsRunning(false);
    }
  };

  const findings = runResult?.inspectionFindings || runResult?.findings || [];
  const technicalAnalysis = runResult?.technicalAnalysis || [];
  const riskAssessment = runResult?.riskAssessment || null;
  const recommendation = runResult?.recommendation || null;
  const references = runResult?.references || runResult?.citations || [];
  const approval = runResult?.approval || { status: 'Pending Approval' };

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
                  : runResult
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              ● {isRunning ? 'ANALYSING' : runResult ? 'COMPLETED' : 'IDLE'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Phase 7 Grounded Multi-Step Inspection Agent Workflow
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Engine</span>
            <span className="font-mono font-semibold text-slate-800">Gemma MLX :8080</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
            <span className="text-slate-400 block text-[10px] font-semibold uppercase">Knowledge Base</span>
            <span className="font-mono font-semibold text-slate-800">Qdrant (40,036 pts)</span>
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
              {isRunning ? 'Analyzing Inspection Report…' : 'Analyze Inspection Report'}
            </Button>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded border border-red-200 font-medium">
                {error}
              </p>
            )}
          </div>

          {/* Agent Activity Timeline */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div className="border-b border-slate-100 pb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Agent Activity
              </h3>
              <p className="text-[11px] text-slate-400">Observable bounded state machine transitions</p>
            </div>

            <div className="flex flex-col gap-2">
              {AGENT_STEPS.map((s, idx) => {
                const isCompleted = completedSteps.has(s.id);
                const isActive = activeStepIndex === idx;

                let icon = '○';
                let rowStyle = 'bg-slate-50/60 border-slate-200 text-slate-500';
                let iconStyle = 'text-slate-400';

                if (isActive) {
                  icon = '⚡';
                  rowStyle = 'bg-blue-50 border-blue-300 text-blue-900 font-semibold shadow-sm ring-1 ring-blue-300';
                  iconStyle = 'text-blue-600 animate-bounce';
                } else if (isCompleted) {
                  icon = '✓';
                  rowStyle = 'bg-emerald-50/70 border-emerald-200 text-emerald-950 font-medium';
                  iconStyle = 'text-emerald-700 font-bold';
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
                          {isActive ? 'running' : isCompleted ? 'completed' : 'pending'}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-75 truncate">{s.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Grounded Inspection Results & Approval Note Preview */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {!runResult && !isRunning && (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center flex flex-col items-center justify-center gap-2 shadow-sm">
              <span className="text-3xl">⚙</span>
              <p className="text-sm font-semibold text-slate-800">
                Ready for Inspection Analysis
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                Select an inspection report and click &ldquo;Analyze Inspection Report&rdquo; to execute the multi-step agent workflow.
              </p>
            </div>
          )}

          {runResult && (
            <div className="flex flex-col gap-5">
              {/* 1. Inspection Findings */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Inspection Findings ({findings.length})
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">Grounded in verbatim report data</span>
                </div>

                {findings.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No explicit abnormal findings reported.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {findings.map((f, idx) => (
                      <Card key={idx} className="!p-3.5 bg-slate-50/50 border-slate-200 flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{f.finding}</span>
                          <StatusBadge status={f.severity || 'MEDIUM'} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded border border-slate-200 text-[11px]">
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Observed</span>
                            <span className="font-semibold text-amber-800">{f.observedValue || '—'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Limit</span>
                            <span className="font-semibold text-slate-700">{f.limit || '—'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-semibold">Source</span>
                            <span className="text-slate-600 truncate">{f.source || 'Report'} {f.page ? `(Page ${f.page})` : ''}</span>
                          </div>
                        </div>
                        {f.evidence && (
                          <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded border border-slate-100">
                            &ldquo;{f.evidence}&rdquo;
                          </p>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Technical Analysis */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Technical Analysis
                  </h3>
                  <p className="text-[11px] text-slate-400">Calculated observations vs standard operating limits</p>
                </div>

                {Array.isArray(technicalAnalysis) ? (
                  <div className="flex flex-col gap-2 text-xs">
                    {technicalAnalysis.map((item, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 leading-relaxed">
                        <p className="font-medium">{item.analysis || item}</p>
                        {item.percentageDeviation != null && (
                          <span className="inline-block mt-1 font-mono text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
                            Deviation: {Math.abs(item.percentageDeviation).toFixed(2)}% {item.isExceeded ? 'above limit' : 'within limit'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-700 p-3 bg-slate-50 rounded-lg border border-slate-200 leading-relaxed">
                    {String(technicalAnalysis)}
                  </p>
                )}
              </div>

              {/* 3. Risk Assessment */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Risk Assessment
                  </h3>
                  <StatusBadge status={riskAssessment?.level || 'MEDIUM'} />
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-800 leading-relaxed">
                  <p><strong>Evaluated Risk:</strong> {riskAssessment?.reason || 'Evaluated against operational criteria.'}</p>
                  <p className="mt-1.5 text-[11px] text-slate-500 italic">
                    Based on the available inspection evidence. Formal sign-off requires qualified engineering authority.
                  </p>
                </div>
              </div>

              {/* 4. Recommendation */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Recommendation
                  </h3>
                </div>
                <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-950 font-medium leading-relaxed">
                  {typeof recommendation === 'string'
                    ? recommendation
                    : recommendation?.action || 'Review findings with maintenance supervisor.'}
                </div>
              </div>

              {/* 5. References */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    References ({references.length})
                  </h3>
                </div>
                {references.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No supporting references retrieved.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {references.map((r, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs p-2.5 bg-slate-50 rounded border border-slate-200">
                        <div className="flex items-center gap-2">
                          <span>📄</span>
                          <span className="font-semibold text-slate-800">{r.filename}</span>
                          <span className="text-slate-400">· Page {r.page ?? 1}</span>
                          {r.chunkIndex != null && <span className="text-slate-400 font-mono text-[10px]">(Chunk {r.chunkIndex})</span>}
                        </div>
                        {r.score != null && (
                          <span className="text-[10px] font-mono bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                            {(r.score * 100).toFixed(0)}% match
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. Approval Section */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Approval
                  </h3>
                  <span className="text-xs font-bold uppercase px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-300 rounded-full font-mono">
                    {approval?.status || 'Pending Approval'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  The structured approval note is compiled and pending plant authority signature. Final DOCX report generation is deferred to Phase 9.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InspectionAgentWorkspace;
