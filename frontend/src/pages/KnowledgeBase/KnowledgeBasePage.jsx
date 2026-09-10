/**
 * PAGE — KnowledgeBasePage.jsx
 *
 * Route: /knowledge-base
 * Dedicated Company Knowledge Base Workspace for reference SOPs, procedures,
 * safety manuals, and engineering guidelines.
 *
 * Strictly scoped to canonical backend documentType="sop" and authenticated organizationId.
 * Includes Phase 3 Interactive Knowledge Base Semantic Search Simulator.
 */

import React, { useRef, useState, useCallback, useMemo } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';
import { searchKnowledgeBase, askKnowledgeBaseChat } from '../../api/knowledge.api.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Upload Pipeline Progress ────────────────────────────────────────────────

function KnowledgeUploadProgress({ state, pendingFile, onReset }) {
  const steps = [
    { label: 'Uploading', desc: 'Securely received in organization workspace' },
    { label: 'Extraction', desc: 'PDF text and tabular procedures parsed' },
    { label: 'OCR Fallback', desc: 'Tesseract OCR applied where required' },
    { label: 'Chunking', desc: 'Page-aware reference chunks generated' },
    { label: 'Embedding', desc: '384D local ONNX embeddings computed' },
    { label: 'Indexing', desc: 'Stored into tenant-isolated Qdrant collection' },
  ];

  const isComplete = state === 'success';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {isComplete ? 'Knowledge Document Indexed' : 'Processing Reference Document…'}
          </h3>
          <p className="text-xs text-slate-500 font-mono">
            {pendingFile?.name || 'knowledge_document.pdf'}
          </p>
        </div>
        {isComplete && (
          <Button variant="primary" size="sm" onClick={onReset}>
            Done
          </Button>
        )}
      </div>

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
        <span>🛡 100% on-premise execution · Zero external AI API calls</span>
        <span className="font-mono text-[10px] text-slate-400">PostgreSQL + Qdrant (SOP)</span>
      </div>
    </div>
  );
}

// ─── Delete Confirmation Modal ───────────────────────────────────────────────

function DeleteConfirmModal({ document, onConfirm, onCancel, deleting }) {
  if (!document) return null;
  const name = document.originalFilename || document.filename || document.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full shadow-lg flex flex-col gap-4">
        <div className="flex items-center gap-3 text-amber-600">
          <span className="text-2xl">⚠️</span>
          <h3 className="text-base font-bold text-slate-900">Delete this knowledge document?</h3>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          Are you sure you want to delete <span className="font-semibold text-slate-900">"{name}"</span>?
          This will remove the file, database records, and vector embeddings from Qdrant.
        </p>
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete Document'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Knowledge Base Page ────────────────────────────────────────────────

export function KnowledgeBasePage() {
  const {
    documents,
    loading,
    uploadState,
    uploadError,
    actionError,
    pendingFile,
    uploadDocument,
    deleteDocument,
    resetUpload,
    clearError,
  } = useDocuments({ documentType: 'sop' });

  const [showUploadZone, setShowUploadZone] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [docToDelete, setDocToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [uiError, setUiError] = useState(null);
  const fileInputRef = useRef(null);

  // ─── Semantic Search Simulator State (Phase 3) ───────────────────────────
  const [simQuery, setSimQuery] = useState('');
  const [simTopK, setSimTopK] = useState(5);
  const [searching, setSearching] = useState(false);
  const [searchExecuted, setSearchExecuted] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchReason, setSearchReason] = useState(null);
  const [searchError, setSearchError] = useState(null);

  // ─── Knowledge Base Chat State (Phase F) ─────────────────────────────────
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatting, setChatting] = useState(false);
  const [chatError, setChatError] = useState(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      setUiError(null);
      const file = e.dataTransfer.files?.[0];
      if (file) {
        setShowUploadZone(true);
        // Canonical Knowledge Base documentType is always 'sop'
        uploadDocument(file, 'sop');
      }
    },
    [uploadDocument],
  );

  const handleFileChange = useCallback(
    (e) => {
      setUiError(null);
      const file = e.target.files?.[0];
      if (file) {
        setShowUploadZone(true);
        // Canonical Knowledge Base documentType is always 'sop'
        uploadDocument(file, 'sop');
      }
      e.target.value = '';
    },
    [uploadDocument],
  );

  const handleConfirmDelete = async () => {
    if (!docToDelete) return;
    setDeleting(true);
    setUiError(null);
    try {
      const docId = docToDelete.id || docToDelete.documentId;
      await deleteDocument(docId);
      setDocToDelete(null);
    } catch {
      setUiError('Unable to delete knowledge document.');
    } finally {
      setDeleting(false);
    }
  };

  // ─── Semantic Search Trigger ─────────────────────────────────────────────
  const handleExecuteSearch = async (e) => {
    if (e) e.preventDefault();
    if (!simQuery.trim() || searching) return;

    setSearching(true);
    setSearchError(null);
    setSearchExecuted(true);

    try {
      const response = await searchKnowledgeBase({
        query: simQuery.trim(),
        topK: Number(simTopK) || 5,
        scoreThreshold: 0.0,
      });

      if (response && response.success && Array.isArray(response.results)) {
        setSearchResults(response.results);
        setSearchReason(response.reason || null);
      } else {
        setSearchResults([]);
        setSearchReason(null);
      }
    } catch (err) {
      console.error('Semantic search error:', err);
      setSearchError('Unable to search the knowledge base.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ─── Knowledge Base Chat Trigger ─────────────────────────────────────────
  const handleExecuteChat = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatting) return;

    const userMessage = { role: 'user', text: chatInput.trim() };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatting(true);
    setChatError(null);

    try {
      const response = await askKnowledgeBaseChat(userMessage.text);
      if (response && response.success) {
        setChatHistory((prev) => [
          ...prev,
          { role: 'assistant', text: response.answer, citations: response.citations || [] },
        ]);
      } else {
        throw new Error(response.message || "Failed to generate answer");
      }
    } catch (err) {
      console.error('KB Chat error:', err);
      setChatError('Unable to reach the Knowledge Base Assistant.');
    } finally {
      setChatting(false);
    }
  };

  // Filtered Knowledge Documents (SOPs only)
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      const docType = (doc.documentType || doc.document_type || '').toLowerCase();
      if (docType && docType !== 'sop') return false;

      const name = (doc.originalFilename || doc.filename || '').toLowerCase();
      if (searchQuery.trim() && !name.includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [documents, searchQuery]);

  const totalChunks = useMemo(() => {
    return filteredDocuments.reduce((acc, d) => acc + (d.chunksStored || 0), 0);
  }, [filteredDocuments]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-8 pb-12">
      {/* Page Header */}
      <PageHeader
        title="Company Knowledge Base"
        subtitle="Manage the SOPs, procedures, manuals, and reference documents used by SovereignAI for grounded analysis."
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowUploadZone(!showUploadZone)}
          >
            {showUploadZone ? 'Close Upload' : '+ Upload Knowledge Document'}
          </Button>
        }
      />

      {/* Error Banner */}
      {(uploadError || actionError || uiError) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between text-xs text-red-800">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{uploadError || actionError || uiError || 'Unable to index this knowledge document.'}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearError();
              setUiError(null);
            }}
            className="text-red-600 hover:text-red-800 font-semibold ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upload Experience */}
      {showUploadZone && (
        <div className="flex flex-col gap-3">
          {uploadState === 'uploading' || uploadState === 'success' ? (
            <KnowledgeUploadProgress
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
                📚
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  Upload Reference SOP or Manual (PDF)
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Drag & drop your file here or{' '}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-blue-600 font-semibold underline underline-offset-2 hover:text-blue-700"
                  >
                    Browse Files
                  </button>
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2 text-[11px] text-slate-600 flex items-center gap-2 mt-1">
                <span className="font-semibold text-slate-700">Target Category:</span>
                <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                  SOP / Knowledge Base
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">Auto-Indexed for Inspection Grounding</span>
              </div>

              <p className="text-[11px] text-slate-400 max-w-md">
                Supported format: <span className="font-semibold text-slate-600">PDF</span>.
                Uploaded procedures will be indexed into Qdrant vector store and made available for automatic finding-driven SOP retrieval.
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

      {/* ─── SECTION 1: KNOWLEDGE DOCUMENTS TABLE ───────────────────────────── */}
      <div className="flex flex-col gap-4">
        {/* Section Header & Search */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="font-bold text-slate-900 text-sm">
              Knowledge Documents
            </span>
            <span className="text-slate-300">|</span>
            <span className="font-semibold text-slate-700">
              {filteredDocuments.length} Document{filteredDocuments.length === 1 ? '' : 's'}
            </span>
            <span className="text-slate-300">·</span>
            <span>{totalChunks.toLocaleString()} Indexed Vector Chunks</span>
          </div>

          {/* Table search filter */}
          <div className="relative max-w-xs w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter listed documents…"
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
            <div className="p-12 text-center text-xs text-slate-500">
              Loading knowledge base…
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
              <span className="text-4xl">📚</span>
              <p className="text-sm font-bold text-slate-800">Knowledge Base is empty.</p>
              <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                Upload your first SOP, maintenance procedure, safety document, or reference manual to begin building your organization's knowledge base.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowUploadZone(true);
                  fileInputRef.current?.click();
                }}
                className="mt-2"
              >
                Upload Knowledge Document
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Document</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Chunks Stored</th>
                    <th className="py-3 px-4">Extraction Method</th>
                    <th className="py-3 px-4">Uploaded</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredDocuments.map((doc) => {
                    const id = doc.id || doc.documentId;
                    const name = doc.originalFilename || doc.filename || id;
                    const chunks = doc.chunksStored || doc.chunks_stored || 0;
                    const status = doc.status || 'Indexed';
                    const method = (doc.extractionMethod || doc.extraction_method || 'pdf-text') === 'ocr' ? 'OCR' : 'PDF Text';

                    return (
                      <tr key={id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                          <span className="text-slate-400">📄</span>
                          <span className="truncate max-w-[260px]" title={name}>
                            {name}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono text-[10px] font-medium">
                            SOP
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={status} />
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-mono font-medium">
                          {chunks.toLocaleString()} chunks
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <span className="text-[11px] text-slate-500 font-medium">
                            {method}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono">
                          {formatDate(doc.uploadedAt || doc.createdAt || doc.created_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setDocToDelete(doc)}
                            className="px-2.5 py-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded text-xs font-semibold transition-colors"
                            title="Delete knowledge document"
                          >
                            Delete
                          </button>
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

      {/* ─── SECTION 2: KNOWLEDGE SEARCH SIMULATOR (Phase 3) ─────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-5">
        <div className="border-b border-slate-100 pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🔍</span> Knowledge Search
            </h2>
            <span className="text-[11px] bg-blue-50 text-blue-700 font-mono font-semibold px-2.5 py-1 rounded-md border border-blue-200/60">
              Deterministic Qdrant Retrieval
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Interactive semantic retrieval simulator. Enter an engineering finding or question to retrieve grounded reference SOP evidence directly from Qdrant.
          </p>
        </div>

        {/* Search Query Form */}
        <form onSubmit={handleExecuteSearch} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="knowledge-search-input" className="text-xs font-bold text-slate-700">
              Finding / Query Input
            </label>
            <textarea
              id="knowledge-search-input"
              rows={3}
              value={simQuery}
              onChange={(e) => setSimQuery(e.target.value)}
              placeholder="Enter an engineering finding or question (e.g., Pump-03 bearing temperature reached 92°C. What does the maintenance SOP say?)"
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none leading-relaxed"
              disabled={searching}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Retrieve Top Chunks:</span>
              <select
                value={simTopK}
                onChange={(e) => setSimTopK(Number(e.target.value))}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-800 focus:ring-1 focus:ring-blue-500"
                disabled={searching}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5 (Default)</option>
                <option value={10}>Top 10</option>
              </select>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={searching || !simQuery.trim()}
              className="min-w-[170px]"
            >
              {searching ? 'Searching knowledge base...' : 'Search Knowledge Base'}
            </Button>
          </div>
        </form>

        {/* Search Results Area */}
        <div className="mt-2 border-t border-slate-100 pt-4 flex flex-col gap-3">
          {searchError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 flex items-center justify-between">
              <span>⚠️ {searchError}</span>
              <button
                type="button"
                onClick={() => setSearchError(null)}
                className="text-red-600 hover:text-red-800 font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {searching ? (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-semibold text-slate-700">Searching knowledge base...</p>
              <p className="text-[11px] text-slate-400">Computing 384D ONNX query embedding & searching Qdrant</p>
            </div>
          ) : !searchExecuted ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              Search your uploaded SOPs and reference documents.
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <span className="text-2xl">📋</span>
              <p className="text-sm font-semibold text-slate-700">
                {searchReason === 'knowledge_base_empty' ? 'Knowledge Base is empty.' : 'No relevant knowledge-base evidence found.'}
              </p>
              <p className="text-xs text-slate-400 max-w-sm">
                {searchReason === 'knowledge_base_empty'
                  ? 'No approved Knowledge Base documents exist for this organization. Upload your SOP documents to enable semantic retrieval.'
                  : 'No matching SOP passages were found in Qdrant for this query. Try adjusting your query or upload the corresponding SOP PDF.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold text-slate-900">
                  Retrieved {searchResults.length} Evidence Passage{searchResults.length === 1 ? '' : 's'}
                </span>
                <span className="text-slate-400 text-[11px]">
                  Ranked by Cosine Similarity Score
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {searchResults.map((result, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col gap-2.5 transition-all hover:border-slate-300"
                  >
                    {/* Header Row: Document, Page, Score, Method */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>📄</span> {result.filename || 'SOP_Document.pdf'}
                        </span>
                        <span className="bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold">
                          SOP
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-600 font-medium">
                          Page {result.page || 1}
                        </span>
                        {result.chunkIndex !== undefined && result.chunkIndex !== null && (
                          <>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500 font-mono text-[11px]">
                              Chunk #{result.chunkIndex}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-medium">
                          {result.extractionMethod === 'ocr' ? 'OCR' : 'PDF Text'}
                        </span>
                        <span className="bg-blue-100 text-blue-900 font-mono text-[11px] font-bold px-2 py-0.5 rounded-md">
                          Score: {typeof result.score === 'number' ? result.score.toFixed(4) : result.score}
                        </span>
                      </div>
                    </div>

                    {/* Content Text Block */}
                    <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap">
                      {result.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── SECTION 3: KNOWLEDGE BASE CHAT (Phase F) ──────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col gap-5">
        <div className="border-b border-slate-100 pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🤖</span> Knowledge Base Assistant
            </h2>
            <span className="text-[11px] bg-emerald-50 text-emerald-700 font-mono font-semibold px-2.5 py-1 rounded-md border border-emerald-200/60">
              Isolated SOP AI Chat
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Ask questions directly against your organization's approved SOPs. The assistant will only use validated Knowledge Base documents.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Chat History */}
          <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-4 min-h-[250px] max-h-[400px] overflow-y-auto flex flex-col gap-4">
            {chatHistory.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs">
                <span className="text-2xl mb-2">💬</span>
                Ask a question like "What is the maximum permitted bearing temperature?"
              </div>
            ) : (
              chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex flex-col max-w-[85%] gap-1.5 ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}>
                  <div className={`px-4 py-2.5 rounded-2xl text-xs leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-xs'}`}>
                    {msg.text}
                  </div>
                  {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1 w-full">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sources:</span>
                      {msg.citations.map((c, cIdx) => (
                        <div key={cIdx} className="text-[11px] text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-md inline-flex items-center gap-1.5">
                          <span>📄</span> <span className="font-semibold text-slate-800 truncate max-w-[150px]">{c.filename || 'Unknown SOP'}</span>
                          <span className="text-slate-400">·</span> Page {c.page} <span className="text-slate-400">·</span> Chunk {c.chunkIndex}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
            {chatting && (
              <div className="self-start flex items-center gap-2 bg-white border border-slate-200 px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-xs">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-[10px] text-slate-500 font-semibold ml-1">Analyzing SOPs...</span>
              </div>
            )}
            {chatError && (
              <div className="self-start bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-2xl rounded-bl-sm">
                ⚠️ {chatError}
              </div>
            )}
          </div>

          {/* Chat Input Form */}
          <form onSubmit={handleExecuteChat} className="flex gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask a question about your SOPs..."
              className="flex-1 text-xs bg-white border border-slate-300 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              disabled={chatting}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={chatting || !chatInput.trim()}
              className="px-6"
            >
              Send
            </Button>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        document={docToDelete}
        deleting={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDocToDelete(null)}
      />
    </div>
  );
}

export default KnowledgeBasePage;
