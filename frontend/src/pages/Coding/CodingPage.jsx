/**
 * PAGE — CodingPage.jsx
 *
 * Route: /coding
 * Secure Coding Sandbox with local Model Router Python code generation
 * and isolated, network-disabled Docker sandbox execution.
 */

import React, { useState, useRef } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { generateCode, executeCode } from '../../api/coding.api.js';

const DEMO_PRESETS = [
  {
    label: 'Python: List Average',
    prompt: 'Write Python code to calculate the average of [10, 20, 30, 40, 50].',
  },
  {
    label: 'Python: Bearing Temp Trend',
    prompt: 'Write Python code to calculate bearing temperature statistics and detect if maximum exceeds 80C from readings = [72.5, 76.1, 79.8, 83.2, 81.0].',
  },
  {
    label: 'Python: Pump Efficiency',
    prompt: 'Write Python code to calculate pump efficiency given output power 85kW and input power 100kW using the formula: Efficiency (%) = (Output / Input) * 100. Print the result.',
  },
  {
    label: 'Security: Python Egress Probe',
    prompt: 'import urllib.request\ntry:\n    urllib.request.urlopen("https://example.com", timeout=2)\n    print("NET_SUCCESS")\nexcept Exception as e:\n    print(f"NET_BLOCKED: {type(e).__name__}")',
    isDirectCode: true,
  },
  {
    label: 'Security: Loop Timeout',
    prompt: 'while True:\n    pass',
    isDirectCode: true,
  },
  {
    label: 'Python: CSV Analysis',
    prompt: 'Analyze this industrial pump sensor CSV. Calculate pump efficiency for each reading using:\nEfficiency (%) = (Pressure * Flow Rate) / (Power Consumption * 600) * 100\nIdentify readings where efficiency is below 70% and temperature is above 85C. Print a summary and provide a maintenance recommendation.',
    sampleCsv: {
      filename: 'pump_readings.csv',
      content: 'timestamp,temperature,pressure,flow_rate,power_consumption\n2026-09-11T10:00:00Z,72.5,450,120,95\n2026-09-11T10:15:00Z,78.0,440,115,98\n2026-09-11T10:30:00Z,88.5,380,85,110\n2026-09-11T10:45:00Z,92.0,360,75,115\n2026-09-11T11:00:00Z,76.2,445,118,96',
      columns: ['timestamp', 'temperature', 'pressure', 'flow_rate', 'power_consumption'],
      rowCount: 5,
    },
  },
];

export function CodingPage() {
  const [prompt, setPrompt] = useState('Write Python code to calculate the average of [10, 20, 30, 40, 50].');
  const [code, setCode] = useState('');
  const [generationMeta, setGenerationMeta] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // CSV dataset state
  const [csvFile, setCsvFile] = useState(null);
  const fileInputRef = useRef(null);

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError({
        title: 'CSV UPLOAD FAILED',
        stage: 'CSV Validation',
        message: 'Only .csv files are supported.',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError({
        title: 'CSV UPLOAD FAILED',
        stage: 'CSV Validation',
        message: 'CSV file size exceeds the 5 MB limit.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result || '';
      const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
      const columns = lines[0] ? lines[0].split(',').map((c) => c.trim().replace(/^"|"$/g, '')) : [];
      const rowCount = Math.max(0, lines.length - 1);

      setCsvFile({
        rawFile: file,
        filename: file.name,
        sizeBytes: file.size,
        content: text,
        columns,
        rowCount,
      });
      setError(null);
    };
    reader.onerror = () => {
      setError({
        title: 'CSV UPLOAD FAILED',
        stage: 'CSV Read',
        message: 'Failed to read uploaded CSV file.',
      });
    };
    reader.readAsText(file);
  };

  const handleRemoveCsv = () => {
    setCsvFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setExecutionResult(null);

    try {
      const res = await generateCode(prompt.trim(), 'python', csvFile?.rawFile || csvFile);
      if (res && res.success) {
        setCode(res.code || '');
        setGenerationMeta({
          taskType: res.taskType,
          model: res.model,
          language: 'python',
          routingReason: res.routingReason,
          isFallback: res.isFallback,
          csv: res.csv || null,
        });
      } else {
        setError({
          title: 'CODE GENERATION FAILED',
          stage: res?.stage || 'Model Router',
          message: res?.error || res?.message || 'Failed to generate code.',
        });
      }
    } catch (err) {
      setError({
        title: 'CODE GENERATION FAILED',
        stage: err?.data?.stage || 'Model Runtime',
        message: err?.data?.error || err?.message || 'Code generation failed.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecute = async () => {
    if (!code.trim() || isExecuting) return;
    setIsExecuting(true);
    setError(null);

    try {
      const res = await executeCode(code.trim(), 'python', 5000, csvFile?.rawFile || csvFile);
      setExecutionResult(res);
      if (!res.success) {
        setError({
          title: res.timedOut ? 'EXECUTION TIMED OUT' : 'EXECUTION FAILED',
          stage: 'Python Sandbox',
          exitCode: res.exitCode,
          stderr: res.stderr,
          message: res.error || (res.timedOut ? 'Execution timed out after 5 seconds.' : 'Execution failed.'),
        });
      }
    } catch (err) {
      setError({
        title: 'SANDBOX EXECUTION ERROR',
        stage: err?.data?.stage || 'Docker Sandbox',
        message: err?.data?.error || err?.message || 'Sandbox execution request failed.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleApplyPreset = (preset) => {
    if (preset.sampleCsv) {
      setCsvFile({
        filename: preset.sampleCsv.filename,
        sizeBytes: preset.sampleCsv.content.length,
        content: preset.sampleCsv.content,
        columns: preset.sampleCsv.columns,
        rowCount: preset.sampleCsv.rowCount,
      });
    } else {
      setCsvFile(null);
    }

    if (preset.isDirectCode) {
      setCode(preset.prompt);
      setGenerationMeta({
        taskType: 'CODING',
        model: 'manual-test',
        language: 'python',
        routingReason: 'Direct security benchmark test',
        isFallback: false,
      });
      setExecutionResult(null);
      setError(null);
    } else {
      setPrompt(preset.prompt);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Coding"
        subtitle="Local model code generation and isolated, network-disabled Docker sandbox execution"
      />

      {/* Docker Isolation Boundary Banner */}
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

      {/* Benchmarks Section */}
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

      {/* Structured Error Alert Card */}
      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-300 rounded-xl text-red-900 shadow-xs flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs uppercase tracking-wide text-red-700">
              {error.title || 'ERROR'}
            </span>
            {error.stage && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                Stage: {error.stage}
              </span>
            )}
          </div>
          {error.exitCode !== undefined && error.exitCode !== null && (
            <div className="text-xs font-mono text-red-800">
              Exit Code: <strong>{error.exitCode}</strong>
            </div>
          )}
          <p className="text-xs text-red-800 leading-relaxed font-medium">
            {error.message}
          </p>
          {error.stderr && (
            <pre className="mt-1 p-2.5 bg-red-950 text-red-200 rounded-lg text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-36">
              {error.stderr}
            </pre>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Prompt, CSV Upload & Code Generator */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="coding-prompt" className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                1. Coding Request (Model Router)
              </label>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-blue-600 text-white shadow-xs font-mono">
                Python
              </span>
            </div>
            <textarea
              id="coding-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the Python task or data analysis you want the local model to write..."
              disabled={isGenerating || isExecuting}
              className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100"
            />
          </div>

          {/* CSV Upload Section */}
          <div className="border border-dashed border-slate-200 rounded-lg p-3 bg-slate-50/60 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">Input Dataset (Optional CSV)</span>
                <span className="text-[10px] text-slate-400 font-mono">→ /workspace/input/data.csv</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="csv-file-input"
              />
              <label
                htmlFor="csv-file-input"
                className="cursor-pointer text-xs px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors shadow-2xs font-medium"
              >
                {csvFile ? 'Change CSV' : 'Upload CSV'}
              </label>
            </div>

            {csvFile ? (
              <div className="bg-white rounded border border-emerald-300 p-2.5 flex items-center justify-between text-xs">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 font-mono">{csvFile.filename}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {csvFile.rowCount} rows · {(csvFile.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono truncate max-w-sm">
                    Columns: {csvFile.columns.join(', ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveCsv}
                  className="text-slate-400 hover:text-red-600 text-sm font-bold px-2 py-1"
                  title="Remove CSV"
                >
                  ✕
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 italic">
                No CSV uploaded. Python code will execute without mounted data.
              </p>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">
              Routed to local Qwen 2.5 Coder via MLX (:8081)
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
                2. Generated Code (PYTHON)
              </label>
              {generationMeta && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Model: {generationMeta.model} · {generationMeta.language}
                  {generationMeta.csv && ' · CSV Aware'}
                </span>
              )}
            </div>

            <textarea
              id="code-display"
              rows={11}
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
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Model</span>
                <span className="font-mono font-bold text-slate-800">
                  {generationMeta?.model || 'qwen2.5-coder:3b-4bit'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Runtime</span>
                <span className="font-mono font-semibold text-emerald-700">Local MLX</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Sandbox</span>
                <span className="font-mono font-bold text-emerald-700 uppercase">Docker Isolated</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Network</span>
                <span className="font-mono font-bold text-red-600 uppercase">Disabled</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Exit Code</span>
                <span className="font-mono font-medium text-slate-800">
                  {executionResult.exitCode !== null ? executionResult.exitCode : 'N/A (timeout)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Duration</span>
                <span className="font-mono font-medium text-slate-800">{executionResult.durationMs} ms</span>
              </div>
            </div>
          )}

          {/* CSV Input Notification in Execution Panel */}
          {executionResult?.sandbox?.csvInput && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5 flex items-center justify-between text-xs text-emerald-800">
              <span>Isolated Dataset Mounted: <strong className="font-mono">{executionResult.sandbox.csvInput}</strong></span>
              <span className="text-[10px] font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-700">READ ONLY</span>
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

            <pre className="flex-1 min-h-[140px] max-h-[240px] overflow-y-auto font-mono text-xs bg-slate-950 text-slate-100 rounded-lg p-3 border border-slate-800 whitespace-pre-wrap select-text">
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
                <pre className="min-h-[60px] max-h-[140px] overflow-y-auto font-mono text-xs bg-red-950/40 text-red-300 rounded-lg p-3 border border-red-900/50 whitespace-pre-wrap select-text">
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
