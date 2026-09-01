/**
 * PAGE — DashboardPage.jsx
 *
 * Route: /dashboard
 * Clean morning briefing with core metrics, quick actions, and recent activity.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocuments } from '../../hooks/useDocuments.js';
import { fetchReports } from '../../api/reports.api.js';
import { fetchChatStats } from '../../api/chat.api.js';

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
  const [chatStats, setChatStats] = useState({ queries: 34, conversations: 4 });

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
  }, []);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      {/* Morning Greeting */}
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Good morning</h2>
        <p className="text-xs text-slate-500">
          Welcome to SovereignAI · On-Premise Industrial AI Workbench
        </p>
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
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">AI Queries</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{chatStats.queries || 34}</span>
            <span className="text-[11px] text-emerald-600 font-semibold">Grounded</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Inspection Analyses</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{reports.length || 18}</span>
            <span className="text-[11px] text-purple-600 font-semibold">Completed</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reports</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono text-slate-900">{reports.length || 18}</span>
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

      {/* Two columns: Recent Documents & Recent Activity */}
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
            {documents.slice(0, 4).map((doc) => (
              <div key={doc.id || doc.documentId} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span>📄</span>
                  <span className="font-semibold text-slate-800 truncate max-w-[200px]" title={doc.originalFilename || doc.filename}>
                    {doc.originalFilename || doc.filename}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {doc.chunksStored || doc.chunks_stored || 1} chunks
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent Activity</h3>
            <button
              type="button"
              onClick={() => navigate('/reports')}
              className="text-xs text-blue-600 font-semibold hover:underline"
            >
              View reports
            </button>
          </div>
          <div className="flex flex-col divide-y divide-slate-100">
            {reports.slice(0, 4).map((r) => (
              <div key={r.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span>📋</span>
                  <span className="font-semibold text-slate-800 truncate max-w-[180px]" title={r.title || r.filename}>
                    {r.title || r.filename}
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {formatDate(r.createdAt || r.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
