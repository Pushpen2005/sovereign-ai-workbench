/**
 * PAGE — AgentPage.jsx
 *
 * Route: /agent
 * FLAGSHIP SCREEN of SovereignAI:
 *   Inspection Agent — Analyze inspection reports and prepare evidence-grounded approval recommendations.
 */

import React, { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { useWorkflow } from '../../hooks/useWorkflow.js';
import { useDocuments } from '../../hooks/useDocuments.js';
import { runAgent } from '../../api/agent.api.js';

// ─── Agent Activity Step ───────────────────────────────────────────────────────

function WorkflowActivityStep({ step }) {
  const isComplete = step.status === 'complete';
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';

  return (
    <div
      className={[
        'flex items-center gap-3 px-3.5 py-2.5 rounded-lg border text-xs transition-all',
        isComplete
          ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900 font-medium'
          : isRunning
          ? 'bg-blue-50 border-blue-200 text-blue-900 font-semibold shadow-sm'
          : isError
          ? 'bg-red-50 border-red-200 text-red-900'
          : 'bg-slate-50 border-slate-200 text-slate-400',
      ].join(' ')}
    >
      <span className="w-5 text-center font-bold text-sm" aria-hidden="true">
        {isComplete ? '✓' : isRunning ? '⚡' : isError ? '✗' : '○'}
      </span>
      <span className="flex-1">{step.label}</span>
      {isRunning && (
        <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
      )}
    </div>
  );
}

// ─── Structured Finding Card (Evidence-First) ─────────────────────────────────

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

      {/* Grid of Equipment, Observed Value, Limit */}
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

// ─── Main Flagship Page Component ─────────────────────────────────────────────

export function AgentPage() {
  const [activeMode, setActiveMode] = useState('inspection'); // 'inspection' | 'autonomous'

  // Inspection Workflow state (PR #18)
  const { documents, selectedDocument, selectDocument } = useDocuments();
  const {
    steps,
    findings,
    riskAssessment,
    recommendation,
    approvalNote,
    error,
    isDownloading,
    isRunning,
    runWorkflow,
    downloadNote,
  } = useWorkflow();

  const [selectedDocId, setSelectedDocId] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('Analyze this inspection report');
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);

  // Autonomous Agent state (PR #26)
  const [agentGoal, setAgentGoal] = useState('Analyze the inspection report, search internal SOPs, assess risk, and prepare a recommendation note.');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const [agentError, setAgentError] = useState(null);

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
      setValidationError('Please select an inspection report first.');
      return;
    }
    setValidationError('');
    await runWorkflow(targetDocId);
  };

  const handleUploadNew = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setValidationError('');
    await runWorkflow(file);
  };

  const handleRunAutonomousAgent = async () => {
    if (!agentGoal.trim() || agentLoading) return;
    setAgentLoading(true);
    setAgentError(null);
    setAgentResult(null);
    try {
      const res = await runAgent(agentGoal);
      if (res && res.success) {
        setAgentResult(res);
      } else {
        setAgentError(res?.message || 'Agent error');
      }
    } catch (err) {
      setAgentError(err.message || 'Execution error');
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      {/* Flagship Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Inspection Agent</h2>
          <p className="text-xs text-slate-500 mt-1">
            Analyze inspection reports and prepare evidence-grounded approval recommendations.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center bg-slate-200/80 p-1 rounded-lg text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveMode('inspection')}
            className={[
              'px-3 py-1.5 rounded-md transition-all',
              activeMode === 'inspection' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            ].join(' ')}
          >
            Inspection Pipeline
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('autonomous')}
            className={[
              'px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5',
              activeMode === 'autonomous' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
            ].join(' ')}
          >
            <span>Autonomous Tool Orchestrator</span>
            <span className="text-[9px] bg-blue-100 text-blue-800 px-1 py-0.2 rounded font-mono">
              PR #26
            </span>
          </button>
        </div>
      </div>

      {/* ─── MODE 1: FLAGSHIP INSPECTION PIPELINE ─── */}
      {activeMode === 'inspection' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── LEFT COLUMN: DOCUMENT & TASK SELECTION (4 cols) ── */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label htmlFor="doc-picker" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Inspection Report
                </label>
                <button
                  type="button"
                  onClick={handleUploadNew}
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

              {/* Document select dropdown */}
              <select
                id="doc-picker"
                value={effectiveDocId}
                onChange={handleSelectChange}
                disabled={isRunning}
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {documents.map((d) => (
                  <option key={d.id || d.documentId} value={d.id || d.documentId}>
                    {d.originalFilename || d.filename}
                  </option>
                ))}
              </select>

              {/* Task input */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="task-prompt" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Task
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
                disabled={isRunning || documents.length === 0}
                className="w-full justify-center !py-2.5 font-semibold text-xs"
              >
                {isRunning ? 'Running Inspection Analysis…' : '⚡ Run Inspection Analysis'}
              </Button>

              {validationError && (
                <p className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                  {validationError}
                </p>
              )}
            </div>

            {/* Live Agent Activity UI */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Inspection Analysis Activity
              </h3>
              <div className="flex flex-col gap-2">
                {steps.map((step) => (
                  <WorkflowActivityStep key={step.id} step={step} />
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: AGENT WORKSPACE DELIVERABLES (8 cols) ── */}
          <div className="lg:col-span-8 flex flex-col gap-5">
            {error && (
              <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                <strong>Pipeline Notice:</strong> {error}
              </div>
            )}

            {/* Findings Section */}
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
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-2 shadow-sm">
                <span className="text-3xl">⚙</span>
                <p className="text-sm font-semibold text-slate-800">
                  {isRunning ? 'Analyzing inspection report & searching SOPs…' : 'Select an inspection report and click "Run Inspection Analysis"'}
                </p>
                <p className="text-xs text-slate-400 max-w-sm">
                  The agent will extract findings, match against internal maintenance SOPs, evaluate operational risk, and prepare an Approval Note.
                </p>
              </div>
            )}

            {/* SOP Evidence Section */}
            {findings && findings.length > 0 && findings[0]?.source && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Relevant SOP Evidence
                </h3>
                <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3.5 text-xs text-blue-950 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-blue-800">
                    <span>📄 {findings[0].source.filename || 'Maintenance_SOP.pdf'}</span>
                    <span>Page {findings[0].source.page ?? 12}</span>
                  </div>
                  <p className="italic leading-relaxed">
                    &ldquo;Normal bearing temperature should remain below the specified operating threshold (80°C). Operating above limit requires immediate lubrication inspection.&rdquo;
                  </p>
                </div>
              </div>
            )}

            {/* Risk Assessment Section (Subtle, Evidence-First) */}
            {riskAssessment && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Risk Assessment
                  </h3>
                  <StatusBadge status={riskAssessment.level || 'INSUFFICIENT EVIDENCE'} />
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-800 leading-relaxed">
                  <p>
                    <strong>Evaluation:</strong> {riskAssessment.reason || 'Insufficient SOP evidence to determine a reliable risk classification.'}
                  </p>
                </div>
              </div>
            )}

            {/* Recommendation Section */}
            {recommendation && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Corrective Recommendation
                </h3>
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-3.5 text-xs text-emerald-950 leading-relaxed">
                  {recommendation}
                </div>
              </div>
            )}

            {/* Approval Note Section (Centerpiece Business Deliverable) */}
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
                        READY
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      {approvalNote.filename} · Audit Ready
                    </p>
                  </div>
                </div>

                <Button
                  variant="primary"
                  onClick={downloadNote}
                  disabled={isDownloading}
                  className="!py-2 !px-4 text-xs font-bold shrink-0 shadow-lg"
                >
                  {isDownloading ? 'Downloading…' : '📥 Download DOCX'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── MODE 2: AUTONOMOUS TOOL ORCHESTRATOR (PR #26) ─── */}
      {activeMode === 'autonomous' && (
        <div className="flex flex-col gap-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <label htmlFor="agent-goal-input" className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Autonomous Agent Goal
            </label>
            <textarea
              id="agent-goal-input"
              rows={3}
              value={agentGoal}
              onChange={(e) => setAgentGoal(e.target.value)}
              disabled={agentLoading}
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={handleRunAutonomousAgent}
                disabled={!agentGoal.trim() || agentLoading}
                className="text-xs"
              >
                {agentLoading ? 'Agent Executing Multi-Step Plan…' : '🚀 Run Autonomous Agent'}
              </Button>
            </div>
          </div>

          {agentError && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {agentError}
            </div>
          )}

          {agentResult && (
            <div className="flex flex-col gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Execution Trace ({agentResult.totalSteps} steps)
                </h3>
                <div className="flex flex-col gap-2">
                  {agentResult.steps.map((s, i) => (
                    <div key={i} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">Step {s.step}:</span>
                        <span className="font-mono bg-slate-200 px-1.5 py-0.5 rounded text-[11px]">{s.tool || 'final'}</span>
                        <span className="text-slate-600">{s.reason || s.resultSummary}</span>
                      </div>
                      <span className="font-mono text-slate-400">{s.durationMs} ms</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Deliverable & Synthesis
                </h3>
                <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {agentResult.answer}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
