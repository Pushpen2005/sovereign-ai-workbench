/**
 * PAGE — AgentPage.jsx
 *
 * Route: /agent
 * Flagship UI: Approval Note Agent workspace.
 * Connected directly to backend inspection workflow and DOCX download APIs.
 */

import React, { useRef, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { LoadingState } from '../../components/ui/FeedbackStates.jsx';
import { useWorkflow } from '../../hooks/useWorkflow.js';
import { useDocuments } from '../../hooks/useDocuments.js';

// Workflow step row
function WorkflowStep({ step }) {
  const statusIcon =
    step.status === 'complete' ? '✓' :
    step.status === 'running'  ? '…' :
    step.status === 'error'    ? '✗' : '○';

  const statusColor =
    step.status === 'complete' ? 'text-green-700 bg-green-50 border-green-200' :
    step.status === 'running'  ? 'text-blue-700 bg-blue-50 border-blue-200 font-medium' :
    step.status === 'error'    ? 'text-red-700 bg-red-50 border-red-200' :
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
          <p className="text-sm font-medium text-slate-900">{finding.finding}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-600">
            {finding.equipment && <span><strong>Equipment:</strong> {finding.equipment}</span>}
            {finding.observedValue && <span><strong>Observed:</strong> {finding.observedValue}</span>}
            {finding.limit && <span><strong>Limit:</strong> {finding.limit}</span>}
          </div>
          {finding.evidence && (
            <div className="mt-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700">
              <strong className="text-slate-800">Verbatim Evidence:</strong> &ldquo;{finding.evidence}&rdquo;
            </div>
          )}
          {finding.source && (
            <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
              <span>Source Page: {finding.source.page ?? '—'}</span>
              {finding.source.chunkIndex != null && <span>· Chunk {finding.source.chunkIndex}</span>}
              {finding.source.score != null && (
                <span>· Relevance: {(finding.source.score * 100).toFixed(0)}%</span>
              )}
            </div>
          )}
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
      <div className="flex items-center justify-between text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">📄</span>
          <span className="font-medium text-slate-800">{citation.filename || citation.documentId || 'SOP Document'}</span>
          {citation.page != null && <span className="text-slate-400">— Page {citation.page}</span>}
          {citation.chunkIndex != null && <span className="text-slate-400">(Chunk {citation.chunkIndex})</span>}
        </div>
        {citation.score != null && (
          <span className="text-slate-500 font-mono">
            Score: {typeof citation.score === 'number' ? citation.score.toFixed(2) : citation.score}
          </span>
        )}
      </div>
    </Card>
  );
}

export function AgentPage() {
  const { documents, selectedDocument, selectDocument } = useDocuments();
  const {
    status,
    steps,
    findings,
    riskAssessment,
    recommendation,
    citations,
    approvalNote,
    error,
    isDownloading,
    downloadError,
    isRunning,
    isComplete,
    runWorkflow,
    downloadNote,
    reset,
  } = useWorkflow();

  const [selectedDocId, setSelectedDocId] = useState('');
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);

  // Derive effective document ID from explicit selection, global selection, or first document
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
    if (matched) {
      selectDocument(matched);
    }
  };

  const handleRunClick = async () => {
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

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Approval Note Agent"
        subtitle="Automated Operational Assessment & Executive Review"
        actions={
          <div className="flex items-center gap-2">
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
              aria-label="Upload inspection PDF to run workflow"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleUploadNew}
              disabled={isRunning}
              aria-label="Upload new inspection report PDF"
            >
              Upload New PDF
            </Button>
            <Button
              onClick={handleRunClick}
              disabled={isRunning}
              aria-label="Generate approval note from inspection document"
            >
              {isRunning ? 'Running Analysis…' : 'Run Workflow'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — workflow timeline & document picker */}
        <div className="lg:col-span-1">
          <section aria-labelledby="workflow-timeline-heading">
            <h2 id="workflow-timeline-heading" className="text-sm font-semibold text-slate-700 mb-3">
              Workflow Timeline
            </h2>
            <div className="flex flex-col gap-2">
              {steps.length === 0 && status === 'idle' && (
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-center text-xs text-slate-400">
                  Select a document and click <strong>Run Workflow</strong> to begin.
                </div>
              )}
              {steps.map((step) => (
                <WorkflowStep key={step.id} step={step} />
              ))}
              {isRunning && (
                <div className="flex items-center gap-3 px-3 py-2 rounded-md border text-sm text-blue-600 bg-blue-50 border-blue-200">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Processing pipeline…</span>
                </div>
              )}
            </div>

            {/* Document selector */}
            <div className="mt-6">
              <label
                htmlFor="inspection-doc-select"
                className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2"
              >
                Inspection Report
              </label>
              <select
                id="inspection-doc-select"
                aria-label="Select inspection document"
                value={effectiveDocId}
                onChange={handleSelectChange}
                disabled={isRunning}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100"
              >
                <option value="">Select a document…</option>
                {documents.map((d) => (
                  <option key={d.documentId || d.id} value={d.documentId || d.id}>
                    {d.originalFilename || d.filename || d.id}
                  </option>
                ))}
              </select>
              {validationError && (
                <p className="mt-1.5 text-xs text-red-600">{validationError}</p>
              )}
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
                Select an inspection document and click <strong>Run Workflow</strong> to execute findings extraction, SOP matching, risk assessment, and DOCX generation.
              </p>
            </Card>
          )}

          {/* Error */}
          {status === 'error' && (
            <Card className="border-red-200 bg-red-50">
              <p className="text-sm text-red-700 font-medium">Workflow Failed</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </Card>
          )}

          {/* Running */}
          {isRunning && (
            <Card>
              <LoadingState message="Agent is running inspection analysis, SOP retrieval, and executive note generation…" />
            </Card>
          )}

          {/* Results */}
          {isComplete && (
            <>
              {/* Findings */}
              {findings.length > 0 ? (
                <section aria-labelledby="findings-heading">
                  <h2 id="findings-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    Inspection Findings ({findings.length})
                  </h2>
                  <div className="flex flex-col gap-3">
                    {findings.map((f, i) => (
                      <FindingRow key={f.id || i} finding={f} />
                    ))}
                  </div>
                </section>
              ) : (
                <Card className="!p-4 text-xs text-slate-500">
                  No abnormal inspection findings were detected in the analyzed document.
                </Card>
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
                    riskAssessment.level === 'LOW'    ? '!border-green-200 !bg-green-50' :
                    '!border-slate-200 !bg-slate-50'
                  }>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase">Risk Level</span>
                      <StatusBadge status={riskAssessment.level || 'Insufficient Evidence'} />
                    </div>
                    <p className="text-sm text-slate-700">{riskAssessment.reason || 'No risk assessment rationale provided.'}</p>
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

              {/* SOP Sources / Citations */}
              {citations.length > 0 && (
                <section aria-labelledby="sources-heading">
                  <h2 id="sources-heading" className="text-sm font-semibold text-slate-700 mb-3">
                    Authoritative SOP Citations ({citations.length})
                  </h2>
                  <div className="flex flex-col gap-2">
                    {citations.map((c, i) => (
                      <SourceCard key={i} citation={c} />
                    ))}
                  </div>
                </section>
              )}

              {/* Approval Note DOCX */}
              {approvalNote && (
                <section
                  aria-labelledby="approval-note-heading"
                  className="p-5 bg-slate-900 rounded-lg text-white shadow-md"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h2 id="approval-note-heading" className="text-sm font-semibold">
                      Generated Approval Note
                    </h2>
                    <span className="text-xs text-green-400 font-medium">Ready for Review</span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4 font-mono">{approvalNote.filename}</p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => downloadNote()}
                      disabled={isDownloading}
                      aria-label="Download Approval Note DOCX"
                    >
                      {isDownloading ? 'Downloading…' : 'Download DOCX'}
                    </Button>
                  </div>
                  {downloadError && (
                    <p className="mt-2 text-xs text-red-400">{downloadError}</p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
