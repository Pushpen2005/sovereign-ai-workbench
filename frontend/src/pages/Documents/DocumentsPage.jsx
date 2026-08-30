/**
 * PAGE — DocumentsPage.jsx
 *
 * Route: /documents
 * Enterprise document management with real backend upload integration (PR #19).
 *
 * Upload flow:
 *   File picker / drag-drop
 *     → useDocuments().uploadDocument(file)
 *     → documents.api.uploadDocument(file)
 *     → POST /api/v1/inspection/ingest (multipart, field: "document")
 *     → Backend: extract → chunk → embed → Qdrant
 *     → { documentId, filename, chunksStored }
 *     → State updated → table refreshes
 */

import React, { useRef, useState, useCallback } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { EmptyState } from '../../components/ui/FeedbackStates.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function truncateId(id) {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// ─── Upload Panel ─────────────────────────────────────────────────────────────

function UploadPanel({ uploadState, uploadError, pendingFile, lastUploaded, onUpload, onClear }) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';           // allow re-selecting the same file
  }, [onUpload]);

  const handlePickFile = () => fileInputRef.current?.click();

  // ── State: idle / drop target ─────────────────────────────────────────────
  if (uploadState === 'idle') {
    return (
      <div
        role="region"
        aria-label="Upload a PDF document"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'flex flex-col items-center justify-center gap-3 p-8',
          'border-2 border-dashed rounded-xl text-center transition-colors',
          dragOver
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300',
        ].join(' ')}
      >
        <div className="text-3xl" aria-hidden="true">📄</div>
        <div>
          <p className="text-sm font-medium text-slate-700">
            Drag a PDF here, or{' '}
            <button
              onClick={handlePickFile}
              className="text-blue-600 underline underline-offset-2 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              browse to select
            </button>
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF files only · max 50 MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Choose a PDF file to upload and index"
        />
      </div>
    );
  }

  // ── State: uploading ──────────────────────────────────────────────────────
  if (uploadState === 'uploading') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3 p-6 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-blue-800">Uploading document…</p>
            {pendingFile && (
              <p className="text-xs text-blue-600">{pendingFile.name} · {pendingFile.sizeMb} MB</p>
            )}
          </div>
        </div>
        <ul className="text-xs text-blue-700 space-y-1 ml-8 list-disc" aria-label="Upload steps">
          <li>Sending to backend</li>
          <li className="text-blue-400">Extracting text…</li>
          <li className="text-blue-400">Creating embeddings…</li>
          <li className="text-blue-400">Indexing into knowledge base…</li>
        </ul>
      </div>
    );
  }

  // ── State: indexing (if used in future) ───────────────────────────────────
  if (uploadState === 'indexing') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3 p-6 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-blue-500 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm font-semibold text-blue-800">Processing document…</p>
        </div>
        <ul className="text-xs text-blue-700 space-y-1 ml-8 list-disc">
          <li className="line-through text-blue-400">Sending to backend</li>
          <li>Creating embeddings…</li>
          <li className="text-blue-400">Indexing into knowledge base…</li>
        </ul>
      </div>
    );
  }

  // ── State: success ────────────────────────────────────────────────────────
  if (uploadState === 'success' && lastUploaded) {
    return (
      <div role="status" aria-live="polite" className="p-5 bg-green-50 border border-green-200 rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl text-green-600" aria-hidden="true">✓</span>
            <div>
              <p className="text-sm font-semibold text-green-800">Document indexed successfully</p>
              <p className="text-xs text-green-600 mt-0.5">{lastUploaded.filename}</p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="text-green-400 hover:text-green-600 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 rounded"
          >
            Upload another
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-white rounded-lg border border-green-200 px-3 py-2.5">
            <dt className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Document ID</dt>
            <dd
              className="mt-0.5 text-xs font-mono text-slate-800 break-all"
              title={lastUploaded.documentId}
            >
              {lastUploaded.documentId}
            </dd>
          </div>
          <div className="bg-white rounded-lg border border-green-200 px-3 py-2.5">
            <dt className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Chunks Stored</dt>
            <dd className="mt-0.5 text-2xl font-semibold text-slate-900">{lastUploaded.chunksStored}</dd>
          </div>
        </dl>
      </div>
    );
  }

  // ── State: error ──────────────────────────────────────────────────────────
  if (uploadState === 'error') {
    return (
      <div role="alert" className="p-5 bg-red-50 border border-red-200 rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xl text-red-500" aria-hidden="true">✕</span>
            <div>
              <p className="text-sm font-semibold text-red-800">Upload failed</p>
              <p className="text-xs text-red-600 mt-0.5">{uploadError || 'An unexpected error occurred.'}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={onClear} aria-label="Try uploading again">
            Try Again
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Documents Table ──────────────────────────────────────────────────────────

function DocumentsTable({ documents }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Documents table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Filename</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Chunks</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden xl:table-cell">Document ID</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Uploaded</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.length === 0 ? (
              <tr>
                <td colSpan="7">
                  <EmptyState
                    title="No documents yet"
                    description="Upload your first inspection report or SOP document to get started."
                  />
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 flex-shrink-0" aria-hidden="true">📄</span>
                      <span className="truncate max-w-[160px]" title={doc.filename}>{doc.filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{doc.type || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">
                    {doc.chunksStored != null ? doc.chunksStored.toLocaleString() : doc.pages != null ? `~${doc.pages}p` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs hidden xl:table-cell">
                    <span title={doc.documentId || doc.id}>{truncateId(doc.documentId || doc.id)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{formatDate(doc.uploadedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" aria-label={`View ${doc.filename}`}>
                      View
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
        <p className="text-xs text-slate-400">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
          {documents.some((d) => d.chunksStored) ? '' : ' · Mock entries include demo data'}
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DocumentsPage() {
  const {
    documents,
    uploadState,
    uploadError,
    pendingFile,
    lastUploaded,
    isUploading,
    uploadDocument,
    clearError,
  } = useDocuments();

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Documents"
        subtitle="Upload inspection reports and SOP documents for AI analysis"
      />

      {/* Upload panel */}
      <section aria-labelledby="upload-section-heading">
        <h2 id="upload-section-heading" className="text-sm font-semibold text-slate-700 mb-3">
          Upload Document
        </h2>
        <UploadPanel
          uploadState={uploadState}
          uploadError={uploadError}
          pendingFile={pendingFile}
          lastUploaded={lastUploaded}
          onUpload={uploadDocument}
          onClear={clearError}
        />
      </section>

      {/* Documents table */}
      <section aria-labelledby="documents-table-heading">
        <h2 id="documents-table-heading" className="text-sm font-semibold text-slate-700 mb-3">
          Document Library
        </h2>
        <DocumentsTable documents={documents} />
      </section>
    </div>
  );
}
