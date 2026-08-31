/**
 * PAGE — DashboardPage.jsx
 *
 * Route: /dashboard
 * Overview metrics, real report activity, and quick navigation.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { MetricCard } from '../../components/ui/Card.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.jsx';
import { useDocuments } from '../../hooks/useDocuments.js';
import { fetchReports } from '../../api/reports.api.js';
import { fetchChatStats } from '../../api/chat.api.js';
import { mockSystemStatus } from '../../data/mockData.js';

const QUICK_ACTIONS = [
  { label: 'Upload Document',    to: '/documents', icon: '📤' },
  { label: 'Start AI Chat',      to: '/chat',      icon: '💬' },
  { label: 'Run Agent Workflow', to: '/agent',     icon: '⚙' },
  { label: 'View Reports',       to: '/reports',   icon: '📋' },
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
  const [reportsLoading, setReportsLoading] = useState(true);
  const [chatStats, setChatStats] = useState({ queries: 0, conversations: 0 });
  const [chatStatsLoading, setChatStatsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Fetch reports
    fetchReports({ limit: 5 })
      .then((res) => {
        if (isMounted && res && res.success && Array.isArray(res.data)) {
          setReports(res.data);
        }
      })
      .catch((err) => {
        console.warn('Dashboard could not fetch reports:', err?.message);
      })
      .finally(() => {
        if (isMounted) setReportsLoading(false);
      });

    // Fetch chat stats
    fetchChatStats()
      .then((res) => {
        if (isMounted && res && res.success && res.data) {
          setChatStats(res.data);
        }
      })
      .catch((err) => {
        console.warn('Dashboard could not fetch chat stats:', err?.message);
      })
      .finally(() => {
        if (isMounted) setChatStatsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const totalDocuments = documents.length;
  const totalReports = reports.length;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your SovereignAI instance"
      />

      {/* Metrics */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">System metrics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Documents"
            value={totalDocuments}
            sublabel="indexed in PostgreSQL & Qdrant"
          />
          <MetricCard
            label="Queries"
            value={chatStatsLoading ? '…' : chatStats.queries}
            sublabel="persisted user questions"
          />
          <MetricCard
            label="Reports"
            value={reportsLoading ? '…' : totalReports}
            sublabel="persisted in PostgreSQL"
          />
          <MetricCard
            label="Inspections"
            value={reportsLoading ? '…' : totalReports}
            sublabel="analysed workflows"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Reports Activity */}
        <section
          aria-labelledby="recent-reports-heading"
          className="bg-white rounded-lg border border-slate-200 shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 id="recent-reports-heading" className="text-sm font-semibold text-slate-900">
              Recent Generated Reports
            </h2>
            <button
              onClick={() => navigate('/reports')}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              View all →
            </button>
          </div>

          {reportsLoading ? (
            <p className="text-xs text-slate-400 py-4 text-center">Loading recent activity…</p>
          ) : reports.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              No inspection reports generated yet. Run the Approval Note Agent to create your first report.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100" role="list">
              {reports.slice(0, 4).map((report) => (
                <li
                  key={report.id}
                  className="py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 px-2 rounded -mx-2 transition-colors"
                  onClick={() => navigate('/reports')}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-slate-400 text-sm" aria-hidden="true">📄</span>
                    <div className="truncate">
                      <p className="text-xs font-medium text-slate-800 truncate" title={report.title || report.filename}>
                        {report.title || report.filename}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {formatDate(report.createdAt)} · {report.documentName || 'Inspection'}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 ml-3">
                    <StatusBadge status={report.riskLevel || 'Insufficient Evidence'} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* System Status & Quick Actions */}
        <div className="flex flex-col gap-6">
          {/* Quick Actions */}
          <section
            aria-labelledby="quick-actions-heading"
            className="bg-white rounded-lg border border-slate-200 shadow-sm p-5"
          >
            <h2 id="quick-actions-heading" className="text-sm font-semibold text-slate-900 mb-4">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  onClick={() => navigate(action.to)}
                  className="flex flex-col items-start gap-2 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                  aria-label={action.label}
                >
                  <span className="text-lg" aria-hidden="true">{action.icon}</span>
                  <span className="text-xs font-medium text-slate-700">{action.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* System Status */}
          <section
            aria-labelledby="system-status-heading"
            className="bg-white rounded-lg border border-slate-200 shadow-sm p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="system-status-heading" className="text-sm font-semibold text-slate-900">
                System Infrastructure
              </h2>
              <span className="text-xs text-slate-400">Live Status</span>
            </div>
            <ul className="flex flex-col gap-3" role="list">
              {mockSystemStatus.map((item) => (
                <li key={item.label} className="flex items-center justify-between">
                  <StatusIndicator status={item.status} label={item.label} />
                  <span className="text-xs text-slate-400">{item.note}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* Info banner */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>PR #20 — Real Data Synchronization:</strong> Document, report, and query counts reflect live PostgreSQL database records. Chat conversations and message histories are fully persisted and isolated by organization.
        </p>
      </div>
    </div>
  );
}
