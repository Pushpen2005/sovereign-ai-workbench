/**
 * PAGE — ChatPage.jsx
 *
 * Route: /chat
 * ChatGPT-inspired Sovereign AI Workspace for industrial document intelligence.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';
import { useChat } from '../../hooks/useChat.js';
import { useDocuments } from '../../hooks/useDocuments.js';

const PROMPT_SUGGESTIONS = [
  {
    title: 'Analyze this inspection report',
    desc: 'Extract critical equipment findings, observed anomalies, and operational limits.',
  },
  {
    title: 'What does the maintenance SOP say about bearing temperature?',
    desc: 'Retrieve verified technical limits and safety thresholds from internal manuals.',
  },
  {
    title: 'Find the applicable safety procedure',
    desc: 'Locate lockout/tagout and high-pressure isolation instructions.',
  },
  {
    title: 'Summarize this inspection report',
    desc: 'Create an executive summary of equipment health and inspection findings.',
  },
  {
    title: 'Generate an approval note',
    desc: 'Prepare a compliant recommendation note ready for formal plant sign-off.',
  },
];

// ─── Subtle Source Card ────────────────────────────────────────────────────────

function SourceCard({ source, documents, onPreview }) {
  const doc = documents.find((d) => d.id === source.documentId || d.documentId === source.documentId);
  const filename = doc?.originalFilename || doc?.filename || source.documentId || 'Internal Document';
  const scorePercent = typeof source.score === 'number' ? Math.round(source.score * 100) : null;

  return (
    <button
      type="button"
      onClick={() => onPreview({ filename, ...source })}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200 rounded-lg text-xs text-slate-700 transition-colors text-left group"
      title="Click to view verbatim excerpt"
    >
      <span className="text-slate-400 group-hover:text-blue-600 transition-colors">📄</span>
      <span className="font-semibold text-slate-900 truncate max-w-[180px]">{filename}</span>
      <span className="text-slate-500">· Page {source.page ?? 1}</span>
      {scorePercent && (
        <span className="text-[10px] font-mono font-bold px-1 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
          {scorePercent}% match
        </span>
      )}
      <span className="text-[11px] text-blue-600 underline underline-offset-2 ml-1">View</span>
    </button>
  );
}

// ─── Message Row ──────────────────────────────────────────────────────────────

function MessageRow({ message, documents, onPreviewSource }) {
  const isUser = message.role === 'user';

  return (
    <div className={['w-full py-4 flex', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
      <div className={['flex gap-3 max-w-3xl w-full', isUser ? 'flex-row-reverse' : 'flex-row'].join(' ')}>
        {/* Avatar */}
        <div
          className={[
            'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 select-none shadow-sm',
            isUser ? 'bg-slate-800 text-white' : 'bg-blue-600 text-white border border-blue-500/40',
          ].join(' ')}
        >
          {isUser ? 'You' : 'S'}
        </div>

        {/* Message content container */}
        <div className={['flex flex-col gap-2 min-w-0 flex-1', isUser ? 'items-end' : 'items-start'].join(' ')}>
          {/* Model routing badge on assistant messages */}
          {!isUser && (message.taskType || message.selectedModel) && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 bg-slate-100/90 border border-slate-200 px-2.5 py-0.5 rounded-full font-mono">
              <span className="font-semibold text-slate-700">
                {message.taskType === 'CODING' ? '💻 Coding' : message.taskType === 'DOCUMENT' ? '📄 Document RAG' : '⚡ Local AI'}
              </span>
              <span>·</span>
              <span>{message.selectedModel || 'llama3.2:3b'}</span>
              <span>·</span>
              <span className="text-emerald-700 font-semibold">100% Local</span>
            </div>
          )}

          {/* Body */}
          <div
            className={[
              'px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words',
              isUser
                ? 'bg-blue-600 text-white rounded-tr-sm shadow-sm'
                : 'bg-white border border-slate-200 text-slate-850 rounded-tl-sm shadow-sm',
            ].join(' ')}
          >
            {message.content}
          </div>

          {/* Sources section (subtle, clean, clickable) */}
          {!isUser && message.sources && message.sources.length > 0 && (
            <div className="mt-1 flex flex-col gap-1.5 w-full">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  Verified Sources ({message.sources.length})
                </span>
                <span className="text-[10px] text-slate-600">Grounding references from indexed corpus</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {message.sources.map((src, i) => (
                  <SourceCard
                    key={i}
                    source={src}
                    documents={documents}
                    onPreview={onPreviewSource}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Source Excerpt Modal ─────────────────────────────────────────────────────

function SourceExcerptModal({ source, onClose }) {
  if (!source) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-lg w-full p-5 shadow-xl border border-slate-200 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{source.filename}</h3>
            <p className="text-xs text-slate-500">
              Page {source.page ?? 1} · Chunk {source.chunkIndex ?? 0}
              {source.score && ` · Relevance Score: ${(source.score * 100).toFixed(1)}%`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-sm p-1 rounded-md"
          >
            ✕
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-800 font-mono leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
          {source.text || '(Verbatim excerpt indexed in local Qdrant)'}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Chat Page Component ─────────────────────────────────────────────────

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { documents } = useDocuments();
  const {
    activeConversationId,
    messages,
    loading,
    error,
    documentId,
    setDocumentId,
    askQuestion,
    selectConversation,
    startNewChat,
  } = useChat();

  const [input, setInput] = useState('');
  const [activeSourcePreview, setActiveSourcePreview] = useState(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Handle URL query parameters (?new=true or ?c=ID)
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      startNewChat();
      setSearchParams({});
    } else {
      const cId = searchParams.get('c');
      if (cId && cId !== activeConversationId) {
        selectConversation(cId);
      }
    }
  }, [searchParams, activeConversationId, selectConversation, startNewChat, setSearchParams]);

  // Auto-scroll to bottom on message updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = (textToSend = input) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading) return;
    setInput('');
    askQuestion(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectSuggestion = (suggestionText) => {
    setInput(suggestionText);
    textareaRef.current?.focus();
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-6rem)] flex flex-col justify-between">
      {/* ─── Scrollable Workspace ─── */}
      <div className="flex-1 overflow-y-auto px-2 py-4 flex flex-col">
        {messages.length === 0 ? (
          /* ─── Centered ChatGPT Hero Landing ─── */
          <div className="flex-1 flex flex-col items-center justify-center text-center max-w-2xl mx-auto py-8">
            {/* Logo & Headline */}
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl mb-4 shadow-sm">
              S
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">SovereignAI</h2>
            <p className="text-sm font-semibold text-blue-600 uppercase tracking-wider mt-1 mb-2">
              Private AI for Confidential Industrial Work
            </p>
            <p className="text-sm text-slate-600 max-w-md mb-8">
              Ask questions about your internal documents, analyze inspection reports, or generate
              business-ready approval notes — 100% on-premises.
            </p>

            {/* Example Prompts (Clickable Cards) */}
            <div className="w-full flex flex-col gap-2.5 mb-8">
              {PROMPT_SUGGESTIONS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectSuggestion(p.title)}
                  className="w-full p-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-left shadow-sm transition-all group flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                      &ldquo;{p.title}&rdquo;
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5">{p.desc}</p>
                  </div>
                  <span className="text-slate-400 group-hover:text-blue-600 text-xs font-bold">→</span>
                </button>
              ))}
            </div>

            {/* Compact Capabilities Row */}
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500 border-t border-slate-200/80 pt-4">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> RAG
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Local LLM
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> OCR
              </span>
              <span>·</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Inspection Agent
              </span>
            </div>
          </div>
        ) : (
          /* ─── Active Message Stream ─── */
          <div className="flex flex-col gap-1 w-full">
            {messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                documents={documents}
                onPreviewSource={setActiveSourcePreview}
              />
            ))}

            {/* Thinking / Searching RAG state */}
            {loading && (
              <div className="py-4 flex gap-3 items-center text-xs text-slate-500" role="status">
                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shrink-0">
                  S
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-2xl rounded-tl-sm flex items-center gap-2 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                  <span>Searching sovereign document vectors & generating answer…</span>
                </div>
              </div>
            )}

            {error && (
              <div role="alert" className="my-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ─── Bottom-Fixed ChatGPT-Style Input Composer ─── */}
      <div className="pt-2 pb-3 bg-gradient-to-t from-slate-100 via-slate-100 to-transparent">
        <div className="bg-white border border-slate-300 rounded-2xl shadow-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all p-3 flex flex-col gap-2">
          {/* Main textarea */}
          <textarea
            ref={textareaRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Ask SovereignAI anything about your documents..."
            className="w-full text-sm text-slate-900 placeholder:text-slate-400 resize-none focus:outline-none disabled:bg-transparent"
          />

          {/* Controls row */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            {/* Left: Document Picker & Model Indicator */}
            <div className="flex items-center gap-2">
              {/* Document filter picker */}
              <div className="flex items-center gap-1.5 text-slate-500">
                <span className="text-slate-400">📄</span>
                <select
                  value={documentId || ''}
                  onChange={(e) => setDocumentId(e.target.value || null)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-md py-1 px-2 text-slate-700 focus:outline-none max-w-[200px] truncate"
                >
                  <option value="">All Documents (Full RAG)</option>
                  {documents.map((d) => (
                    <option key={d.id || d.documentId} value={d.id || d.documentId}>
                      {d.originalFilename || d.filename}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model indicator */}
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-mono text-slate-600 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                llama3.2:3b · Local
              </span>
            </div>

            {/* Right: Send Button & Keyboard Hint */}
            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-[10px] text-slate-600">
                Enter to send · Shift+Enter newline
              </span>

              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className={[
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                  input.trim() && !loading
                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm'
                    : 'bg-slate-100 text-slate-350 cursor-not-allowed',
                ].join(' ')}
                title="Send message"
              >
                <span className="text-sm font-bold leading-none">↑</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Source Excerpt Modal */}
      {activeSourcePreview && (
        <SourceExcerptModal
          source={activeSourcePreview}
          onClose={() => setActiveSourcePreview(null)}
        />
      )}
    </div>
  );
}
