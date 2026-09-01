/**
 * PAGE — DocumentsPage.jsx
 *
 * Route: /documents
 * Industrial Knowledge Base Manager & Sovereign Upload Pipeline.
 */

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function inferDocumentType(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.includes('sop') || lower.includes('procedure') || lower.includes('manual')) {
    return 'SOP';
  }
  if (lower.includes('inspection') || lower.includes('iar') || lower.includes('report') || lower.includes('audit')) {
    return 'Inspection Report';
  }
  return 'Technical Document';
}

// ─── Sovereign Upload Pipeline Progress ───────────────────────────────────────

function UploadPipelineProgress({ state, pendingFile, onReset }) {
  const steps = [
    { label: 'Uploading', desc: 'File received securely on-premise' },
    { label: 'Extracting', desc: 'PDF text and tabular data detected' },
    { label: 'OCR', desc: 'Tesseract OCR completed where required' },
    { label: 'Chunking', desc: 'Page-aware token chunks generated' },
    { label: 'Embedding', desc: '384D local embeddings generated' },
    { label: 'Indexing', desc: 'Stored into local self-hosted Qdrant' },
  ];

  const isComplete = state === 'success';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {isComplete ? 'Document Ingestion Complete' : 'Processing Sovereign Document…'}
          </h3>
          <p className="text-xs text-slate-500 font-mono">
            {pendingFile?.name || 'document.pdf'}
          </p>
        </div>
        {isComplete && (
          <Button variant="primary" size="sm" onClick={onReset}>
            Done
          </Button>
        )}
      </div>

      {/* Sequential Pipeline Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className={[
              'p-3 rounded-lg border text-xs flex flex-col gap-1 transition-all',
              isComplete
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-blue-50/50 border-blue-200 text-blue-900',
            ].join(' ')}
          >
            <div className="flex items-center justify-between font-bold">
              <span>{step.label}</span>
              <span className="text-emerald-600 font-bold">✓</span>
            </div>
            <p className="text-[11px] opacity-80">{step.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px] text-slate-600 flex items-center justify-between">
        <span>🛡 100% on-premise execution · Zero external API calls</span>
        <span className="font-mono text-[10px] text-slate-400">PostgreSQL + Qdrant</span>
      </div>
    </div>
  );
}

// ─── Main Documents Page ──────────────────────────────────────────────────────

export function DocumentsPage() {
  const navigate = useNavigate();
  const {
    documents,
    loading,
    uploadState,
    pendingFile,
    uploadDocument,
    deleteDocument,
    selectDocument,
    resetUpload,
  } = useDocuments();

  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setShowUploadZone(true);
      uploadDocument(file);
    }
  }, [uploadDocument]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      setShowUploadZone(true);
      uploadDocument(file);
    }
    e.target.value = '';
  }, [uploadDocument]);

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const name = (doc.originalFilename || doc.filename || '').toLowerCase();
      const type = inferDocumentType(doc.originalFilename || doc.filename);

      // Search match
      if (searchQuery.trim() && !name.includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Filter match
      if (activeFilter === 'Inspection Reports' && type !== 'Inspection Report') return false;
      if (activeFilter === 'SOPs' && type !== 'SOP') return false;
      if (activeFilter === 'Other' && (type === 'Inspection Report' || type === 'SOP')) return false;

      return true;
    });
  }, [documents, searchQuery, activeFilter]);

  const handleAnalyzeInAgent = (doc) => {
    selectDocument(doc);
    navigate('/agent');
  };

  const handleAskInChat = (doc) => {
    selectDocument(doc);
    navigate(`/chat?doc=${doc.id || doc.documentId}`);
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <PageHeader
        title="Documents"
        subtitle="Manage your local knowledge base"
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowUploadZone(!showUploadZone)}
          >
            {showUploadZone ? 'Close Upload' : '+ Upload Document'}
          </Button>
        }
      />

      {/* Upload Experience (Dropzone or Active Pipeline) */}
      {showUploadZone && (
        <div className="flex flex-col gap-3">
          {uploadState === 'uploading' || uploadState === 'success' ? (
            <UploadPipelineProgress
              state={uploadState}
              pendingFile={pendingFile}
              onReset={() => {
                resetUpload();
                setShowUploadZone(false);
              }}
            />
          ) : (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                'bg-white border-2 border-dashed rounded-xl p-8 text-center transition-all flex flex-col items-center justify-center gap-3 shadow-sm',
                dragOver ? 'border-blue-500 bg-blue-50/50' : 'border-slate-300 hover:border-slate-400',
              ].join(' ')}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl font-bold">
                📄
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Drag & drop your PDF here
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  or{' '}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 font-semibold underline underline-offset-2 hover:text-blue-700"
                  >
                    Browse Files
                  </button>
                </p>
              </div>
              <p className="text-[11px] text-slate-400 max-w-sm">
                Documents are processed using local extraction, OCR, embeddings and self-hosted retrieval.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}
        </div>
      )}

      {/* Search & Filters Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Filters */}
        <div className="flex items-center gap-1">
          {['All', 'Inspection Reports', 'SOPs', 'Other'].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              className={[
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                activeFilter === f
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative max-w-xs w-full">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents by name…"
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg py-1.5 pl-8 pr-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            🔍
          </span>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading knowledge base…</div>
        ) : filteredDocuments.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
            <span className="text-3xl">📂</span>
            <p className="text-sm font-semibold text-slate-700">No documents found</p>
            <p className="text-xs text-slate-400 max-w-sm">
              Upload an inspection report or SOP PDF to begin building your confidential knowledge base.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Filename</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Pages</th>
                  <th className="py-3 px-4">Chunks</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Uploaded</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocuments.map((doc) => {
                  const id = doc.id || doc.documentId;
                  const name = doc.originalFilename || doc.filename || id;
                  const type = inferDocumentType(name);
                  const chunks = doc.chunksStored || doc.chunks_stored || 1;
                  const pages = doc.pageCount || doc.pages || 1;
                  const status = doc.status || 'Indexed';

                  return (
                    <tr key={id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                        <span className="text-slate-400">📄</span>
                        <span className="truncate max-w-[220px]" title={name}>
                          {name}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{type}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono">{pages}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono">{chunks.toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={status} />
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono">
                        {formatDate(doc.createdAt || doc.created_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleAnalyzeInAgent(doc)}
                            className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-[11px] font-semibold transition-colors"
                            title="Analyze with Inspection Agent"
                          >
                            Analyze
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAskInChat(doc)}
                            className="px-2.5 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-[11px] font-semibold transition-colors"
                            title="Ask questions in Chat"
                          >
                            Chat
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteDocument(id)}
                            className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                            title="Delete document"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
