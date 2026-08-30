/**
 * PAGE — ReportsPage.jsx
 *
 * Route: /reports
 * Generated reports table with download actions.
 */

import React from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/FeedbackStates.jsx';
import { mockReports } from '../../data/mockData.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function ReportsPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Generated approval notes and inspection documents"
      />

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Reports table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Report</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Document</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Created</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mockReports.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <EmptyState
                      title="No reports yet"
                      description="Run the Approval Note Agent to generate your first report."
                    />
                  </td>
                </tr>
              ) : (
                mockReports.map((report) => (
                  <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400" aria-hidden="true">📋</span>
                        <span className="truncate max-w-[180px]" title={report.filename}>{report.filename}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                      <span className="truncate max-w-[160px]" title={report.document}>{report.document}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{formatDate(report.createdAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Download ${report.filename} — available in PR #23`}
                        disabled
                        title="Download available in PR #23"
                      >
                        Download
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-400">{mockReports.length} report{mockReports.length !== 1 ? 's' : ''} · Mock data · Download integration in PR #23</p>
        </div>
      </div>
    </div>
  );
}
