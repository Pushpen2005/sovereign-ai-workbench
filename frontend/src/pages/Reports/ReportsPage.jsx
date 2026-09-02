/**
 * PAGE — ReportsPage.jsx
 *
 * Route: /reports
 * Archive of certified business-ready Approval Notes backed by PostgreSQL.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { fetchReports } from '../../api/reports.api.js';
import { downloadApprovalNote } from '../../api/inspection.api.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchReports();
      if (res && res.success && Array.isArray(res.data)) {
        setReports(res.data);
      } else {
        setReports([]);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load reports archive.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDownload = async (report) => {
    if (!report.filename) return;
    setDownloadingId(report.id);
    try {
      await downloadApprovalNote(report.filename);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Reports"
        subtitle="Generated Reports"
        actions={
          <Button variant="outline" size="sm" onClick={loadReports} disabled={loading}>
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </Button>
        }
      />

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Reports Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">Loading generated reports…</div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
            <span className="text-3xl">📋</span>
            <p className="text-sm font-semibold text-slate-700">No approval notes generated yet.</p>
            <p className="text-xs text-slate-400 max-w-sm">
              Use the Inspection Agent to analyze an inspection report and generate your first official Approval Note.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Report</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Risk</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                      <span className="text-slate-400">📄</span>
                      <div>
                        <span className="block truncate max-w-[200px]" title={r.title || r.filename}>
                          {r.title || 'Approval Note'}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-mono">
                          {r.filename}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">Approval Note</td>
                    <td className="py-3 px-4 text-slate-600 truncate max-w-[160px]" title={r.documentName || r.documentId}>
                      {r.documentName || r.documentId || 'Inspection Report'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={r.riskLevel || 'MEDIUM'} />
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono">
                      {formatDate(r.createdAt || r.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Ready
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleDownload(r)}
                        disabled={downloadingId === r.id}
                        className="!py-1 !px-2.5 text-[11px]"
                      >
                        {downloadingId === r.id ? 'Downloading…' : 'Download DOCX'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
