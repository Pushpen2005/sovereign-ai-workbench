/**
 * PAGE — ChatPage.jsx
 *
 * Route: /chat
 * RAG Chat — real integration via useChat() → chat.api.js → POST /api/v1/chat/ask
 *
 * Source shape from backend:
 *   { documentId, page, chunkIndex, score }
 */

import React, { useRef, useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { useChat } from '../../hooks/useChat.js';
import { useDocuments } from '../../hooks/useDocuments.js';

// ─── Source chip ──────────────────────────────────────────────────────────────

function SourceChip({ source, documents }) {
  // Look up filename from the documents list using documentId
  const doc = documents.find((d) => d.id === source.documentId || d.documentId === source.documentId);
  const filename = doc?.filename || source.documentId;
  const score = typeof source.score === 'number' ? source.score.toFixed(4) : null;

  return (
    <div className="inline-flex flex-col gap-0.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
      <span className="font-medium text-slate-800 truncate max-w-[200px]" title={filename}>{filename}</span>
      <span className="text-slate-500">
        Page {source.page} · Chunk {source.chunkIndex}
        {score && <> · Relevance {score}</>}
      </span>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, documents }) {
  const isUser = message.role === 'user';

  return (
    <article className={['flex gap-3', isUser ? 'justify-end' : 'justify-start'].join(' ')}>
      {!isUser && (
        <div
          className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold"
          aria-hidden="true"
        >
          S
        </div>
      )}
      <div className={['flex flex-col gap-2', isUser ? 'items-end' : 'items-start', 'max-w-xl'].join(' ')}>
        {/* Text */}
        <div
          className={[
            'px-4 py-3 rounded-xl text-sm leading-relaxed',
            isUser
              ? 'bg-blue-600 text-white rounded-tr-sm'
              : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm',
          ].join(' ')}
        >
          {message.content}
        </div>

        {/* Sources — only on assistant messages */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="flex flex-col gap-1 w-full">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide ml-1">
              Sources
            </p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((src, i) => (
                <SourceChip key={i} source={src} documents={documents} />
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Thinking indicator ───────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex gap-3 justify-start" role="status" aria-live="polite" aria-label="Searching documents">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold" aria-hidden="true">
        S
      </div>
      <div className="px-4 py-3 bg-white border border-slate-200 rounded-xl rounded-tl-sm shadow-sm flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm text-slate-500">Searching documents…</span>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyChatState({ hasDocuments }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-3xl" aria-hidden="true">💬</div>
      {hasDocuments ? (
        <>
          <p className="text-sm font-medium text-slate-600">Ask a question about your documents</p>
          <p className="text-xs text-slate-400 max-w-xs">
            Select a document above or ask across all indexed documents.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-600">No documents indexed yet</p>
          <p className="text-xs text-slate-400 max-w-xs">
            Upload a PDF on the Documents page first, then return here to ask questions.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { documents } = useDocuments();
  const { messages, loading, error, documentId, setDocumentId, askQuestion, clearMessages } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    askQuestion(q);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <PageHeader
        title="AI Chat"
        subtitle="Ask questions against your indexed document corpus"
        actions={
          messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearMessages} aria-label="Clear conversation">
              Clear
            </Button>
          )
        }
      />

      <div className="flex flex-col flex-1 min-h-0 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">

        {/* Document selector */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
          <label htmlFor="doc-select" className="text-xs font-medium text-slate-600 whitespace-nowrap">
            Document:
          </label>
          <select
            id="doc-select"
            value={documentId || ''}
            onChange={(e) => setDocumentId(e.target.value || null)}
            className="flex-1 max-w-xs text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">All indexed documents</option>
            {documents.map((doc) => (
              <option key={doc.id || doc.documentId} value={doc.documentId || doc.id}>
                {doc.filename}
              </option>
            ))}
          </select>
          {documentId && (
            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[160px]" title={documentId}>
              {documentId}
            </span>
          )}
        </div>

        {/* Message thread */}
        <div
          className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4"
          role="log"
          aria-live="polite"
          aria-label="Chat conversation"
        >
          {messages.length === 0 && !loading && (
            <EmptyChatState hasDocuments={documents.length > 0} />
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} documents={documents} />
          ))}

          {loading && <ThinkingIndicator />}

          {error && (
            <div role="alert" className="flex justify-start gap-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 flex items-center justify-center text-red-500 text-xs" aria-hidden="true">
                ✕
              </div>
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl rounded-tl-sm text-sm text-red-700">
                Unable to get an answer. Please try again.
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-slate-200 bg-slate-50">
          <div className="flex gap-3 items-end">
            <label htmlFor="chat-input" className="sr-only">Your question</label>
            <textarea
              id="chat-input"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your documents…"
              disabled={loading}
              className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
            />
            <Button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="Send question"
              className="mb-0.5"
            >
              {loading ? 'Sending…' : 'Send'}
            </Button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}

