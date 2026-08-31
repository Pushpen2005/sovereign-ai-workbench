/**
 * PAGE — CodingPage.jsx
 *
 * Route: /coding
 * Secure Coding Sandbox with local Model Router code generation & Docker sandbox execution.
 */

import React, { useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { generateCode, executeCode } from '../../api/coding.api.js';

const DEMO_PRESETS = [
  {
    label: 'MRPL Benchmark: Calculate List Average',
    prompt: 'Write Python code to calculate the average of [10, 20, 30, 40, 50].',
  },
  {
    label: 'Industrial: Bearing Temperature Trend',
    prompt: 'Write Python code to calculate bearing temperature statistics and detect if maximum exceeds 80C from readings = [72.5, 76.1, 79.8, 83.2, 81.0].',
  },
  {
    label: 'Security Test: Infinite Loop (Timeout)',
    prompt: 'while True:\n    pass',
    isDirectCode: true,
  },
  {
    label: 'Security Test: Outbound Network Exfiltration',
    prompt: 'import urllib.request\ntry:\n    urllib.request.urlopen("https://example.com", timeout=2)\n    print("NET_SUCCESS")\nexcept Exception as e:\n    print(f"NET_BLOCKED: {type(e).__name__}")',
    isDirectCode: true,
  },
];

export function CodingPage() {
  const [prompt, setPrompt] = useState('Write Python code to calculate the average of [10, 20, 30, 40, 50].');
  const [code, setCode] = useState('');
  const [generationMeta, setGenerationMeta] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setExecutionResult(null);

    try {
      const res = await generateCode(prompt.trim());
      if (res && res.success) {
        setCode(res.code || '');
        setGenerationMeta({
          taskType: res.taskType,
          model: res.model,
          routingReason: res.routingReason,
          isFallback: res.isFallback,
        });
      } else {
        setError(res?.message || 'Failed to generate code.');
      }
    } catch (err) {
      setError(err?.message || 'Code generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecute = async () => {
    if (!code.trim() || isExecuting) return;
    setIsExecuting(true);
    setError(null);

    try {
      const res = await executeCode(code.trim(), 'python', 5000);
      setExecutionResult(res);
    } catch (err) {
      setError(err?.message || 'Sandbox execution request failed.');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApplyPreset = (preset) => {
    if (preset.isDirectCode) {
      setCode(preset.prompt);
      setGenerationMeta({
        taskType: 'CODING',
        model: 'manual-test',
        routingReason: 'Direct security benchmark test',
        isFallback: false,
      });
      setExecutionResult(null);
    } else {
      setPrompt(preset.prompt);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Coding Sandbox"
        subtitle="Local model code generation and isolated, network-disabled Docker sandbox execution"
      />

      {/* Security Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-lg">
            🛡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Docker Isolation Boundary</h3>
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Code runs strictly in an ephemeral <code className="text-slate-300">python:3.11-alpine</code> container. No host access.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Network: <strong className="text-red-400">NONE</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            CPU: <strong className="text-blue-400">1 Core</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Memory: <strong className="text-blue-400">256 MB</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Timeout: <strong className="text-amber-400">5s</strong>
          </span>
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 font-medium mr-1">Benchmarks:</span>
        {DEMO_PRESETS.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleApplyPreset(p)}
            className="text-xs px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-xs"
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Prompt and Code Generator */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
          <div>
            <label htmlFor="coding-prompt" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              1. Coding Request (Model Router)
            </label>
            <textarea
              id="coding-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the Python task you want the local model to write..."
              disabled={isGenerating || isExecuting}
              className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100"
            />
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">
              Routed to configured local coding model via Ollama
            </span>
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating || isExecuting}
            >
              {isGenerating ? 'Routing & Generating…' : 'Generate Code'}
            </Button>
          </div>

          {/* Generated Code Area */}
          <div className="mt-2 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="code-display" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                2. Generated Python Code (Editable)
              </label>
              {generationMeta && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Task: {generationMeta.taskType} · Model: {generationMeta.model}
                </span>
              )}
            </div>

            <textarea
              id="code-display"
              rows={10}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="# Generated Python code will appear here... You can edit or paste Python code directly."
              disabled={isExecuting}
              className="w-full flex-1 font-mono text-xs leading-relaxed bg-slate-900 text-emerald-400 rounded-lg p-3 border border-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none resize-y"
            />

            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                onClick={handleExecute}
                disabled={!code.trim() || isExecuting || isGenerating}
                className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
              >
                {isExecuting ? 'Running in Docker Sandbox…' : '▶ Run in Sandbox'}
              </Button>
            </div>
          </div>
        </div>

        {/* Right Column: Sandbox Execution Results */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                3. Sandbox Execution Verification
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Ephemeral container output with stdout, stderr, and exit code capture
              </p>
            </div>

            {executionResult && (
              <span
                className={[
                  'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide',
                  executionResult.success
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : executionResult.timedOut
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-red-100 text-red-800 border border-red-300',
                ].join(' ')}
              >
                {executionResult.success
                  ? 'VERIFIED ✓'
                  : executionResult.timedOut
                  ? 'TIMED OUT'
                  : 'EXECUTION FAILED'}
              </span>
            )}
          </div>

          {/* Execution Telemetry Card */}
          {executionResult?.sandbox && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Exit Code</span>
                <span className="font-mono font-medium text-slate-800">
                  {executionResult.exitCode !== null ? executionResult.exitCode : 'N/A (killed)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Duration</span>
                <span className="font-mono font-medium text-slate-800">{executionResult.durationMs} ms</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Network</span>
                <span className="font-mono font-bold text-red-600 uppercase">{executionResult.sandbox.network}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Sandbox</span>
                <span className="font-mono font-bold text-emerald-600 uppercase">ISOLATED</span>
              </div>
            </div>
          )}

          {/* Terminal Output */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
              <span>Standard Output (stdout):</span>
              {executionResult?.stdoutTruncated && (
                <span className="text-amber-600 text-[11px] font-mono">Truncated (max 64KB)</span>
              )}
            </div>

            <pre className="flex-1 min-h-[140px] max-h-[220px] overflow-y-auto font-mono text-xs bg-slate-950 text-slate-100 rounded-lg p-3 border border-slate-800 whitespace-pre-wrap select-text">
              {executionResult ? (
                executionResult.stdout || <span className="text-slate-600 italic">No output produced on stdout.</span>
              ) : (
                <span className="text-slate-600 italic">Click "Run in Sandbox" to execute the code and view stdout.</span>
              )}
            </pre>

            {executionResult?.stderr && (
              <>
                <div className="flex items-center justify-between text-xs text-red-600 font-medium mt-2">
                  <span>Standard Error (stderr):</span>
                  {executionResult.stderrTruncated && (
                    <span className="text-amber-600 text-[11px] font-mono">Truncated (max 64KB)</span>
                  )}
                </div>
                <pre className="min-h-[60px] max-h-[120px] overflow-y-auto font-mono text-xs bg-red-950/40 text-red-300 rounded-lg p-3 border border-red-900/50 whitespace-pre-wrap select-text">
                  {executionResult.stderr}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
