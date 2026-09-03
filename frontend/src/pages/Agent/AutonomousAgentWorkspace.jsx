/**
 * COMPONENT — AutonomousAgentWorkspace.jsx
 *
 * Flagship workspace for SovereignAI's autonomous tool agent.
 * Powered by LangGraph StateGraph, PostgreSQL persistence, and real-time SSE streaming.
 */

import React, { useState, useEffect } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { useAgentExecution } from '../../hooks/useAgentExecution.js';
import { fetchAgentRuns, fetchAgentRunSteps } from '../../api/agent.api.js';

const QUICK_PROMPTS = [
  'Calculate 45 * 2 using calculator',
  'Search internal documents for bearing temperature limits and safety SOPs',
  'Check SOP requirements for lockout/tagout procedures',
  'Inspect rotating equipment inspection frequency and reporting timelines',
];

export function AutonomousAgentWorkspace() {
  const {
    status,
    runId,
    model,
    currentStep,
    maxSteps,
    timeline,
    finalAnswer,
    sources,
    deliverable,
    durationMs,
    error,
    stoppedReason,
    isRunning,
    isCompleted,
    isFailed,
    isStopped,
    executeAgent,
    reset,
  } = useAgentExecution();

  const [inputGoal, setInputGoal] = useState('');
  const [historyRuns, setHistoryRuns] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistoryRun, setSelectedHistoryRun] = useState(null);
  const [historySteps, setHistorySteps] = useState([]);

  const loadRunHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetchAgentRuns({ limit: 10 });
      if (res && res.success && Array.isArray(res.data)) {
        setHistoryRuns(res.data);
      }
    } catch (err) {
      console.warn('[AutonomousAgentWorkspace] Failed to fetch run history:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Load past runs on mount
  useEffect(() => {
    loadRunHistory();
  }, []);

  const handleRun = async (promptToRun) => {
    const target = promptToRun || inputGoal;
    if (!target.trim() || isRunning) return;
    setSelectedHistoryRun(null);
    setHistorySteps([]);
    await executeAgent(target);
    loadRunHistory();
  };

  const handleSelectHistoryRun = async (pastRun) => {
    setSelectedHistoryRun(pastRun);
    try {
      const res = await fetchAgentRunSteps(pastRun.runId);
      if (res && res.success && Array.isArray(res.data)) {
        setHistorySteps(res.data);
      }
    } catch (err) {
      console.warn('Failed to load past steps:', err.message);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ─── WORKSPACE CONTROLS & STATUS BAR ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Agent Column (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {/* Prompt Input Box */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label htmlFor="agent-goal" className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Agent Objective / Goal
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400">Engine: LangGraph</span>
                <span className="text-[11px] font-mono text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                  {model}
                </span>
              </div>
            </div>

            <textarea
              id="agent-goal"
              rows={3}
              value={inputGoal}
              onChange={(e) => setInputGoal(e.target.value)}
              disabled={isRunning}
              placeholder="Ask the autonomous agent to perform an industrial task..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
            />

            {/* Quick Prompts */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-400">Suggestions:</span>
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setInputGoal(qp);
                    handleRun(qp);
                  }}
                  disabled={isRunning}
                  className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded transition-colors"
                >
                  {qp}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-400 font-mono">
                {runId ? `Run ID: ${runId}` : 'Ready for execution'}
              </span>
              <div className="flex items-center gap-2">
                {(isCompleted || isFailed || isStopped) && (
                  <Button variant="secondary" onClick={reset} className="!py-1.5 text-xs">
                    Reset
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => handleRun()}
                  disabled={!inputGoal.trim() || isRunning}
                  className="!py-2 !px-5 text-xs font-semibold"
                >
                  {isRunning ? 'Running LangGraph Agent…' : '⚡ Run Agent'}
                </Button>
              </div>
            </div>
          </div>

          {/* Execution Telemetry Header */}
          {(runId || isRunning) && (
            <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div>
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-400">Status</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {isRunning && <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />}
                    <span className="font-bold text-xs capitalize text-white">
                      {status === 'running' ? 'Executing Plan' : status}
                    </span>
                  </div>
                </div>

                <div className="h-7 w-px bg-slate-800" />

                <div>
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-400">Steps</span>
                  <span className="font-bold text-xs text-white">
                    {currentStep} / {maxSteps}
                  </span>
                </div>

                <div className="h-7 w-px bg-slate-800" />

                <div>
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-400">Duration</span>
                  <span className="font-mono text-xs text-slate-300">
                    {durationMs ? `${durationMs} ms` : '—'}
                  </span>
                </div>
              </div>

              {stoppedReason && stoppedReason !== 'completed' && (
                <div className="text-right">
                  <span className="text-[10px] uppercase font-mono text-amber-400">Exit Reason</span>
                  <p className="text-xs font-mono text-amber-300">{stoppedReason}</p>
                </div>
              )}
            </div>
          )}

          {/* ─── LIVE ACTIVITY TIMELINE (Real Backend SSE Events) ─── */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Live Activity Stream
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                {isRunning ? '● Real-time SSE active' : 'LangGraph Event History'}
              </span>
            </div>

            {timeline.length === 0 && !selectedHistoryRun ? (
              <div className="py-10 text-center text-slate-400 text-xs">
                No events recorded yet. Enter a task above and click &ldquo;Run Agent&rdquo;.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {(selectedHistoryRun ? historySteps : timeline).map((item, idx) => {
                  const statusType = item.status || 'complete';

                  return (
                    <div
                      key={item.id || idx}
                      className={[
                        'flex items-start gap-3 p-3 rounded-lg border text-xs transition-all',
                        statusType === 'running'
                          ? 'bg-blue-50 border-blue-200 text-blue-900 shadow-sm'
                          : statusType === 'complete' || statusType === 'success'
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                          : statusType === 'warning'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-red-50 border-red-200 text-red-900',
                      ].join(' ')}
                    >
                      <span className="w-5 text-center font-bold text-sm shrink-0">
                        {statusType === 'running' ? '⚡' : statusType === 'error' ? '✗' : statusType === 'warning' ? '⚠' : '✓'}
                      </span>
                      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">
                            {item.label || item.toolResultSummary || item.action || `Step ${item.stepNumber || idx + 1}`}
                          </span>
                          {(item.tool || item.toolName) && (
                            <span className="font-mono text-[10px] bg-white/80 border border-slate-300 px-1.5 py-0.5 rounded text-slate-700">
                              {item.tool || item.toolName}
                            </span>
                          )}
                        </div>
                        {item.details && (
                          <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                            {item.details}
                          </p>
                        )}
                        {item.toolArguments && (
                          <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                            Args: {JSON.stringify(item.toolArguments)}
                          </p>
                        )}
                      </div>
                      {(item.durationMs || item.duration_ms) && (
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          {item.durationMs || item.duration_ms}ms
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── RESULT & SYNTHESIS ─── */}
          {(finalAnswer || selectedHistoryRun?.finalAnswer) && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
                <span>Agent Synthesis & Final Answer</span>
                <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  VERIFIED OUTPUT
                </span>
              </h3>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                {finalAnswer || selectedHistoryRun?.finalAnswer}
              </div>

              {/* Deliverable Download CTA */}
              {deliverable && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between text-xs text-blue-900">
                  <div className="flex items-center gap-2">
                    <span>📄</span>
                    <span className="font-bold">{deliverable.filename || 'Generated Document'}</span>
                  </div>
                  {deliverable.downloadUrl && (
                    <a
                      href={deliverable.downloadUrl}
                      download
                      className="text-xs font-bold text-blue-600 hover:underline"
                    >
                      Download Deliverable
                    </a>
                  )}
                </div>
              )}

              {/* Grounded Sources */}
              {sources && sources.length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Grounded Document Sources ({sources.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sources.map((src, i) => (
                      <div key={i} className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-700 flex flex-col gap-0.5">
                        <span className="font-semibold text-slate-900 truncate">📄 {src.filename}</span>
                        <div className="text-slate-500 flex items-center gap-2">
                          <span>Page {src.page ?? '—'}</span>
                          {src.score != null && <span>· Score: {(src.score * 100).toFixed(0)}%</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error / Failure Banner */}
          {error && (
            <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex flex-col gap-1">
              <strong>Execution Notice:</strong>
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Right Column: Run History Sidebar (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Recent Agent Runs
              </h3>
              <button
                type="button"
                onClick={loadRunHistory}
                disabled={loadingHistory}
                className="text-[11px] text-blue-600 hover:underline font-semibold"
              >
                {loadingHistory ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {historyRuns.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No persistent runs recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto">
                {historyRuns.map((hr) => {
                  const isSelected = selectedHistoryRun?.runId === hr.runId;
                  return (
                    <button
                      key={hr.runId}
                      type="button"
                      onClick={() => handleSelectHistoryRun(hr)}
                      className={[
                        'text-left p-3 rounded-lg border transition-all flex flex-col gap-1.5',
                        isSelected
                          ? 'bg-blue-50/80 border-blue-300 shadow-sm ring-1 ring-blue-400'
                          : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-slate-400 truncate">
                          {hr.runId.slice(0, 18)}...
                        </span>
                        <span
                          className={[
                            'text-[10px] font-bold uppercase px-1.5 py-0.2 rounded',
                            hr.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : hr.status === 'in_progress'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-red-100 text-red-800',
                          ].join(' ')}
                        >
                          {hr.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-900 line-clamp-2">
                        {hr.goal}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1 border-t border-slate-200/60">
                        <span>Steps: {hr.totalSteps ?? '—'}</span>
                        <span>{hr.createdAt ? new Date(hr.createdAt).toLocaleTimeString() : ''}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
