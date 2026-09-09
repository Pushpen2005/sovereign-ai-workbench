/**
 * PAGE — DashboardPage.jsx
 *
 * Route: /dashboard
 * Clean morning briefing with core metrics, system status, quick actions, and recent activity.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocuments } from '../../hooks/useDocuments.js';
import { fetchReports } from '../../api/reports.api.js';
import { fetchChatStats } from '../../api/chat.api.js';
import { getSecurityStatus } from '../../api/sovereignty.api.js';

const QUICK_ACTIONS = [
  { label: 'Upload Document',    to: '/documents', icon: '📄', desc: 'Ingest internal PDF or SOP' },
  { label: 'Ask AI',             to: '/chat',      icon: '💬', desc: 'Query sovereign knowledge base' },
  { label: 'Analyze Inspection', to: '/agent',     icon: '⚙', desc: 'Run automated inspection agent' },
  { label: 'View Reports',       to: '/reports',   icon: '📋', desc: 'Browse generated approval notes' },
];

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { documents } = useDocuments();
  const [reports, setReports] = useState([]);
  const [chatStats, setChatStats] = useState({ queries: 0, conversations: 0 });
  const [secStatus, setSecStatus] = useState(null);

  useEffect(() => {
    fetchReports({ limit: 5 })
      .then((res) => {
        if (res && res.success && Array.isArray(res.data)) {
          setReports(res.data);
        }
      })
      .catch(() => {});

    fetchChatStats()
      .then((res) => {
        if (res && res.success && res.data) {
          setChatStats(res.data);
        }
      })
      .catch(() => {});

    getSecurityStatus()
      .then((res) => {
        if (res && res.sovereignty) {
          setSecStatus(res.sovereignty);
        }
      })
      .catch(() => {});
  }, []);

  const isLlmLocal = secStatus?.llm?.status === 'LOCAL';
  const isQdrantLocal = secStatus?.vectorStore?.status === 'SELF_HOSTED';
  const isOcrLocal = secStatus?.ocr?.status === 'LOCAL';

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      {/* Morning Greeting & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">System Dashboard</h2>
          <p className="text-xs text-slate-500">
            SovereignAI · Private On-Premise Industrial AI Workbench
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            100% On-Premise
          </span>
        </div>
      </div>

      {/* Verified System Status (Section 6 Requirement) */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm border border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Verified Runtime Stack
          </span>
          <button
            type="button"
            onClick={() => navigate('/security')}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium"
          >
            Audit Sovereignty →
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isLlmLocal !== false ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Local LLM</p>
              <p className="text-xs font-bold text-slate-200 truncate">{secStatus?.llm?.model || 'llama3.2:3b'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Embeddings</p>
              <p className="text-xs font-bold text-slate-200 truncate">384D ONNX</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isQdrantLocal !== false ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Vector Store</p>
              <p className="text-xs font-bold text-slate-200 truncate">Qdrant Self-Hosted</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className={`w-2 h-2 rounded-full ${isOcrLocal !== false ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Local OCR</p>
              <p className="text-xs font-bold text-slate-200 truncate">Tesseract 5.x</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Local Vision</p>
              <p className="text-xs font-bold text-slate-200 truncate">moondream:latest</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700/50">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400 font-medium truncate">Coding Sandbox</p>
              <p className="text-xs font-bold text-slate-200 truncate">Docker Isolated</p>
            </div>
          </div>
        </div>
      </div>

      {/* 4 Core Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Documents</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{documents.length}</span>
            <span className="text-[11px] text-blue-600 font-semibold">Indexed</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Queries</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{chatStats.queries || 0}</span>
            <span className="text-[11px] text-emerald-600 font-semibold">Grounded</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Inspection Reports</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{reports.length || 0}</span>
            <span className="text-[11px] text-purple-600 font-semibold">Completed</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Generated Reports</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{reports.length || 0}</span>
            <span className="text-[11px] text-emerald-600 font-semibold">Audit Ready</span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.to}
              type="button"
              onClick={() => navigate(action.to)}
              className="p-3.5 bg-slate-50 hover:bg-blue-50/60 border border-slate-200 hover:border-blue-200 rounded-lg text-left transition-all group flex flex-col justify-between gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xl">{action.icon}</span>
                <span className="text-slate-400 group-hover:text-blue-600 text-xs font-bold">→</span>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-800 group-hover:text-blue-700 transition-colors">
                  {action.label}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">{action.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Two columns: Recent Documents & Recent AI Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Documents */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent Documents</h3>
            <button
              type="button"
              onClick={() => navigate('/documents')}
              className="text-xs text-blue-600 font-semibold hover:underline"
            >
              View all
            </button>
          </div>
          <div className="flex flex-col divide-y divide-slate-100">
            {documents.length === 0 ? (
              <p className="py-4 text-xs text-slate-400 text-center">No documents uploaded yet.</p>
            ) : (
              documents.slice(0, 4).map((doc) => {
                const name = doc.originalFilename || doc.filename;
                const type = (doc.documentType || 'Technical Document').toUpperCase();
                const status = doc.status || 'Indexed';
                const date = formatDate(doc.createdAt || doc.created_at);

                return (
                  <div key={doc.id || doc.documentId} className="py-2.5 flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>📄</span>
                      <div className="min-w-0">
                        <span className="font-semibold text-slate-800 truncate block max-w-[180px]" title={name}>
                          {name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {type} · {date}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      {status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent AI Activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent AI Activity</h3>
            <button
              type="button"
              onClick={() => navigate('/reports')}
              className="text-xs text-blue-600 font-semibold hover:underline"
            >
              View reports
            </button>
          </div>
          <div className="flex flex-col divide-y divide-slate-100">
            {/* Real verified reports or empty fallback */}
            {reports.length > 0 ? (
              reports.slice(0, 4).map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-purple-600 font-bold text-sm">📋</span>
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800 truncate block max-w-[180px]" title={r.title || r.filename}>
                        {r.title || 'Approval Note Generated'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Report generation · {formatDate(r.createdAt || r.created_at)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
                    Completed
                  </span>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-slate-400">
                No recent agent activity recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
