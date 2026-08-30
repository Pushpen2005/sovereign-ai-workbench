/**
 * PAGE — AgentPage.jsx
 *
 * Route: /agent
 * Flagship UI: Approval Note Agent workspace.
 * Shows workflow timeline, findings, risk assessment, recommendation, and sources.
 */

import React, { useRef } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { LoadingState } from '../../components/ui/FeedbackStates.jsx';
import { useWorkflow } from '../../hooks/useWorkflow.js';
import { useDocuments } from '../../hooks/useDocuments.js';

// Workflow step row
function WorkflowStep({ step, index }) {
  const statusIcon = step.status === 'complete' ? '✓' : step.status === 'running' ? '…' : '○';
  const statusColor =
    step.status === 'complete' ? 'text-green-600 bg-green-50 border-green-200' :
    step.status === 'running'  ? 'text-blue-600 bg-blue-50 border-blue-200' :
    'text-slate-400 bg-slate-50 border-slate-200';

  return (
    <div className={['flex items-center gap-3 px-3 py-2 rounded-md border text-sm', statusColor].join(' ')}>
      <span className="font-bold w-4 text-center" aria-hidden="true">{statusIcon}</span>
      <span>{step.label}</span>
    </div>
  );
}

// Finding row
function FindingRow({ finding }) {
  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm text-slate-800">{finding.finding}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
            {finding.equipment && <span><strong>Equipment:</strong> {finding.equipment}</span>}
            {finding.observedValue && <span><strong>Observed:</strong> {finding.observedValue}</span>}
            {finding.limit && <span><strong>Limit:</strong> {finding.limit}</span>}
          </div>
        </div>
        {finding.severity && <StatusBadge status={finding.severity} />}
      </div>
    </Card>
  );
}

// Source card
function SourceCard({ citation }) {
  return (
    <Card variant="source" className="!p-3">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span aria-hidden="true">📄</span>
        <span className="font-medium">{citation.filename}</span>
        <span className="text-slate-400">— Page {citation.page}</span>
      </div>
    </Card>
  );
}

export function AgentPage() {
  const { documents } = useDocuments();
  const {
    status, steps, findings, riskAssessment, recommendation,
    citations, approvalNote, error, isRunning, isComplete,
    runWorkflow, reset,
  } = useWorkflow();

  const fileInputRef = useRef(null);

  const handleStart = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await runWorkflow(file);
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Approval Note Agent"
        subtitle="Automated Operational Assessment & Executive Review"
        actions={
          <div className="flex gap-2">
            {(isComplete || status === 'error') && (
              <Button variant="outline" size="sm" onClick={reset} aria-label="Reset workflow">
                Reset
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
              aria-label="Choose inspection PDF to run workflow"
            />
            <Button
              onClick={handleStart}
              disabled={isRunning}
              aria-label="Generate approval note from inspection document"
            >
              {isRunning ? 'Processing…' : 'Run Workflow'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — workflow timeline */}
        <div className="lg:col-span-1">
          <section aria-labelledby="workflow-timeline-heading">
            <h2 id="workflow-timeline-heading" className="text-sm font-semibold text-slate-700 mb-3">
              Workflow Steps
            </h2>
            <div className="flex flex-col gap-2">
              {steps.length === 0 && status === 'idle' && (
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-center text-xs text-slate-400">
                  Click <strong>Run Workflow</strong> to begin
                </div>
              )}
              {steps.map((step, i) => (
                <WorkflowStep key={step.id} step={step} index={i} />
              ))}
              {isRunning && steps.length < 6 && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-md border text-sm text-blue-600 bg-blue-50 border-blue-200">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Running…</span>
                </div>
              )}
            </div>

            {/* Document context */}
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Inspection Report
              </h3>
              <select
                aria-label="Select inspection document"
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">Select a document…</option>
                {documents
                  .filter((d) => d.type === 'Inspection')
                  .map((d) => (
                    <option key={d.id} value={d.id}>{d.filename}</option>
                  ))}
              </select>
            </div>
          </section>
        </div>

        {/* Right — results */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Placeholder if idle */}
          {status === 'idle' && (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3" aria-hidden="true">⚙</div>
              <p className="text-sm font-medium text-slate-600">Approval Note Agent</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Select an inspection document and click <strong>Run Workflow</strong> to begin automated analysis.
              </p>
            </Card>
          )}

          {/* Error */}
          {status === 'error' && (
            <Card className="border-red-200 bg-red-50">
              <p className="text-sm text-red-700 font-medium">Workflow failed</p>
              <p className="text-xs text-red-500 mt-1">{error}</p>
            </Card>
          )}

          {/* Running */}
          {isRunning && (
            <Card>
              <LoadingState message="Agent is analysing the inspection report…" />
            </Card>
          )}

          {/* Results */}
          {isComplete && (
            <>
              {/* Findings */}
              {findings.length > 0 && (
                <section aria-labelledby="findings-heading">
                  <h2 id="findings-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    Findings ({findings.length})
                  </h2>
                  <div className="flex flex-col gap-3">
                    {findings.map((f) => <FindingRow key={f.id} finding={f} />)}
                  </div>
                </section>
              )}

              {/* Risk Assessment */}
              {riskAssessment && (
                <section aria-labelledby="risk-heading">
                  <h2 id="risk-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    Risk Assessment
                  </h2>
                  <Card className={
                    riskAssessment.level === 'HIGH'   ? '!border-red-200 !bg-red-50' :
                    riskAssessment.level === 'MEDIUM' ? '!border-amber-200 !bg-amber-50' :
                    '!border-green-200 !bg-green-50'
                  }>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase">Risk Level</span>
                      <StatusBadge status={riskAssessment.level} />
                    </div>
                    <p className="text-sm text-slate-700">{riskAssessment.reason}</p>
                  </Card>
                </section>
              )}

              {/* Recommendation */}
              {recommendation && (
                <section aria-labelledby="recommendation-heading">
                  <h2 id="recommendation-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    Recommendation
                  </h2>
                  <Card>
                    <p className="text-sm text-slate-800 leading-relaxed">{recommendation}</p>
                  </Card>
                </section>
              )}

              {/* Sources */}
              {citations.length > 0 && (
                <section aria-labelledby="sources-heading">
                  <h2 id="sources-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    SOP Sources
                  </h2>
                  <div className="flex flex-col gap-2">
                    {citations.map((c, i) => <SourceCard key={i} citation={c} />)}
                  </div>
                </section>
              )}

              {/* Approval Note */}
              {approvalNote && (
                <section
                  aria-labelledby="approval-note-heading"
                  className="p-5 bg-slate-900 rounded-lg text-white"
                >
                  <h2 id="approval-note-heading" className="text-sm font-semibold mb-1">
                    Approval Note
                  </h2>
                  <p className="text-xs text-slate-400 mb-4">{approvalNote.filename}</p>
                  <div className="flex gap-3">
                    <Button
                      disabled
                      variant="secondary"
                      size="sm"
                      aria-label="Generate Approval Note — available in PR #23"
                    >
                      Generate Approval Note
                    </Button>
                    <Button
                      disabled
                      variant="outline"
                      size="sm"
                      className="border-slate-600 text-slate-300"
                      aria-label="Download DOCX — available in PR #23"
                    >
                      Download DOCX
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Download available in PR #23</p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
