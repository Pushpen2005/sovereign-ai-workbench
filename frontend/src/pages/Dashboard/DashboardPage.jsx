/**
 * PAGE — DashboardPage.jsx
 *
 * Route: /dashboard
 * Overview metrics, system status, and quick navigation.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { MetricCard } from '../../components/ui/Card.jsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { mockMetrics, mockSystemStatus } from '../../data/mockData.js';

const QUICK_ACTIONS = [
  { label: 'Upload Document',    to: '/documents', icon: '📤' },
  { label: 'Start AI Chat',      to: '/chat',      icon: '💬' },
  { label: 'Run Agent Workflow', to: '/agent',     icon: '⚙' },
  { label: 'View Reports',       to: '/reports',   icon: '📋' },
];

export function DashboardPage() {
  const navigate = useNavigate();

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
            value={mockMetrics.documents}
            sublabel="indexed in Qdrant"
          />
          <MetricCard
            label="Queries"
            value={mockMetrics.queries}
            sublabel="this session"
          />
          <MetricCard
            label="Reports"
            value={mockMetrics.reports}
            sublabel="approval notes"
          />
          <MetricCard
            label="Inspections"
            value={mockMetrics.inspectionAnalyses}
            sublabel="analysed"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Status */}
        <section
          aria-labelledby="system-status-heading"
          className="bg-white rounded-lg border border-slate-200 shadow-sm p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 id="system-status-heading" className="text-sm font-semibold text-slate-900">
              System Status
            </h2>
            <span className="text-xs text-slate-400">Mock data</span>
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
                className="flex flex-col items-start gap-2 p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
                aria-label={action.label}
              >
                <span className="text-xl" aria-hidden="true">{action.icon}</span>
                <span className="text-xs font-medium text-slate-700">{action.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Info banner */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs text-blue-700">
          <strong>PR #18 — Frontend Foundation:</strong> All metrics and system status are mock data.
          Real backend integration begins in PR #19.
        </p>
      </div>
    </div>
  );
}
