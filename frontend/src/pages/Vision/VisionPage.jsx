/**
 * PAGE — VisionPage.jsx
 *
 * Route: /vision
 * Local Multimodal Vision Workspace for industrial equipment images & engineering drawings.
 */

import React, { useState, useRef } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { analyzeImage } from '../../api/vision.api.js';

const PROMPT_PRESETS = [
  {
    label: 'Equipment & Defect Inspection',
    text: 'Analyze this industrial image. Describe visible equipment, components, physical conditions, and identify any obvious abnormalities or defects. Only report observations supported by the image.',
  },
  {
    label: 'Engineering Drawing Review',
    text: 'Analyze the engineering drawing. Identify visible equipment, lines, labels, symbols, and notable relationships. Clearly distinguish what is visible from what is inferred.',
  },
  {
    label: 'Corrosion & Leak Detection',
    text: 'Identify visible signs of damage, corrosion, cracks, leakage, deformation, or other abnormal conditions. Only report observations supported by the image.',
  },
];

export function VisionPage() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].text);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Local client validation
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.mimetype) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setError('Please select a PNG, JPEG, or WebP image file.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image exceeds maximum allowed size of 10 MB.');
      return;
    }

    setError(null);
    setSelectedFile(file);
    setResult(null);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleClearImage = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Generates an instant synthetic demo canvas image for judges without requiring external downloads
  const handleGenerateSyntheticSample = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // Background (industrial blueprint / metallic theme)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 600, 400);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let x = 0; x < 600; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 400);
      ctx.stroke();
    }
    for (let y = 0; y < 400; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(600, y);
      ctx.stroke();
    }

    // Centrifugal Pump Housing
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(280, 200, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Impeller shaft
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(260, 185, 140, 30);

    // Flange
    ctx.fillStyle = '#475569';
    ctx.fillRect(150, 160, 40, 80);

    // Crack / Anomaly simulation (bright orange jagged line)
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(250, 240);
    ctx.lineTo(265, 260);
    ctx.lineTo(260, 275);
    ctx.lineTo(280, 290);
    ctx.stroke();

    // Text labels
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('EQUIPMENT ID: PUMP-P102', 40, 50);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('DISCHARGE CASING', 40, 75);

    // Defect label callout
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('⚠ OBSERVED CRACK (BEARING HOUSING)', 270, 320);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const syntheticFile = new File([blob], 'Synthetic_Pump_Inspection_P102.png', { type: 'image/png' });
      setError(null);
      setSelectedFile(syntheticFile);
      setResult(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(syntheticFile));
    }, 'image/png');
  };

  const handleAnalyze = async () => {
    if (!selectedFile || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await analyzeImage(selectedFile, prompt);
      if (res && res.success) {
        setResult(res);
      } else {
        setError(res?.message || 'Vision analysis failed.');
      }
    } catch (err) {
      setError(err?.message || 'Vision analysis request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Vision Analysis"
        subtitle="Local multimodal visual inspection for industrial equipment, engineering drawings, and scanned records"
      />

      {/* Security & Sovereignty Banner */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-bold text-lg">
            👁
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Local Vision Boundary</h3>
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                SELF-HOSTED
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Image bytes remain in-memory and route strictly to local Ollama. Zero cloud APIs used.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Task: <strong className="text-blue-400">VISION</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            In-Memory: <strong className="text-emerald-400">EPHEMERAL</strong>
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Cloud Vision: <strong className="text-red-400">NONE</strong>
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upload and Prompt */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              1. Industrial Image Input
            </h3>
            <button
              type="button"
              onClick={handleGenerateSyntheticSample}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
            >
              + Load Synthetic Pump Demo
            </button>
          </div>

          {/* Upload Area / Preview */}
          {!previewUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-slate-50 transition-colors flex flex-col items-center justify-center gap-2 min-h-[220px]"
            >
              <div className="text-3xl" aria-hidden="true">📷</div>
              <p className="text-sm font-medium text-slate-700">Click to upload inspection image</p>
              <p className="text-xs text-slate-400">Supports PNG, JPEG, WebP (up to 10 MB)</p>
            </div>
          ) : (
            <div className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-950 flex items-center justify-center min-h-[220px] max-h-[300px]">
              <img
                src={previewUrl}
                alt="Inspection Preview"
                className="max-h-[300px] w-auto object-contain"
              />
              <button
                type="button"
                onClick={handleClearImage}
                className="absolute top-2 right-2 px-2.5 py-1 text-xs bg-slate-900/80 text-white rounded-md hover:bg-red-600 transition-colors"
                aria-label="Remove image"
              >
                ✕ Change Image
              </button>
              {selectedFile && (
                <div className="absolute bottom-2 left-2 px-2 py-0.5 text-[11px] font-mono bg-slate-900/80 text-slate-200 rounded">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Prompt Section */}
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex items-center justify-between">
              <label htmlFor="vision-prompt" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                2. Inspection Inquiry & Prompt
              </label>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-1.5 mb-1">
              {PROMPT_PRESETS.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(p.text)}
                  className="text-[11px] px-2 py-1 bg-slate-100 text-slate-700 rounded border border-slate-200 hover:bg-slate-200 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <textarea
              id="vision-prompt"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter analysis instructions for the local vision model..."
              disabled={loading}
              className="w-full text-sm rounded-lg border border-slate-300 p-2.5 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100"
            />
          </div>

          <div className="flex justify-end mt-2">
            <Button
              variant="primary"
              onClick={handleAnalyze}
              disabled={!selectedFile || loading}
            >
              {loading ? 'Analyzing with Local Vision Model…' : '👁 Analyze Image'}
            </Button>
          </div>
        </div>

        {/* Right: Visual Analysis Results */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                3. Multimodal Analysis Verification
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Structured visual findings from on-premise vision inference
              </p>
            </div>

            {result && (
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                ANALYZED ✓
              </span>
            )}
          </div>

          {/* Telemetry bar */}
          {result?.processing && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Task</span>
                <span className="font-mono font-bold text-blue-600">{result.taskType}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Model</span>
                <span className="font-mono font-medium text-slate-800">{result.model}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Processing</span>
                <span className="font-mono font-bold text-emerald-600">LOCAL</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Latency</span>
                <span className="font-mono text-slate-800">{result.processing.durationMs} ms</span>
              </div>
            </div>
          )}

          {/* Analysis Content */}
          <div className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[500px]">
            {result?.structured ? (
              <>
                {/* Summary */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <h4 className="text-xs font-semibold uppercase text-slate-600 mb-1">Visual Summary</h4>
                  <p className="text-sm text-slate-800 leading-relaxed">{result.structured.summary}</p>
                </div>

                {/* Observations */}
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <h4 className="text-xs font-semibold uppercase text-slate-600 mb-2">Visible Components & Features</h4>
                  <ul className="list-disc pl-5 text-xs text-slate-700 space-y-1">
                    {result.structured.observations.map((obs, idx) => (
                      <li key={idx}>{obs}</li>
                    ))}
                  </ul>
                </div>

                {/* Abnormalities */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <h4 className="text-xs font-semibold uppercase text-amber-800 mb-2">Detected Abnormalities / Defects</h4>
                  <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                    {result.structured.abnormalities.map((abn, idx) => (
                      <li key={idx}>{abn}</li>
                    ))}
                  </ul>
                </div>

                {/* Limitations */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <h4 className="text-xs font-semibold uppercase text-slate-500 mb-1">Inspection Limitations</h4>
                  <ul className="list-disc pl-5 text-[11px] text-slate-500 space-y-0.5">
                    {result.structured.limitations.map((lim, idx) => (
                      <li key={idx}>{lim}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400 gap-2">
                <div className="text-3xl">🔍</div>
                <p className="text-sm font-medium text-slate-600">No Image Analyzed Yet</p>
                <p className="text-xs max-w-xs">
                  Upload an industrial image or click "Load Synthetic Pump Demo" on the left, then click "Analyze Image".
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
