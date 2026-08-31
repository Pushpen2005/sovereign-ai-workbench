/**
 * PAGE — ReportsPage.jsx
 *
 * Route: /reports
 * Generated reports table with live PostgreSQL backend persistence and download actions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { StatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState, LoadingState } from '../../components/ui/FeedbackStates.jsx';
import { fetchReports } from '../../api/reports.api.js';
import { downloadApprovalNote } from '../../api/inspection.api.js';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
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
  const [downloadError, setDownloadError] = useState('');

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
      setError(err?.message || 'Failed to load reports archive from backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchReports()
      .then((res) => {
        if (isMounted && res && res.success && Array.isArray(res.data)) {
          setReports(res.data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err?.message || 'Failed to load reports archive from backend.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleDownload = async (filename, id) => {
    setDownloadingId(id);
    setDownloadError('');
    try {
      await downloadApprovalNote(filename);
    } catch (err) {
      setDownloadError(`Failed to download ${filename}: ${err?.message || 'File not found'}`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Reports"
        subtitle="Generated approval notes and inspection documents"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={loadReports}
            disabled={loading}
            aria-label="Refresh reports list"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {downloadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
          {downloadError}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8">
            <LoadingState message="Loading inspection reports from database…" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Reports table">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Report
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">
                      Source Document
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Risk
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">
                      Created
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reports.length === 0 ? (
                    <tr>
                      <td colSpan="6">
                        <EmptyState
                          title="No inspection reports generated yet"
                          description="Run the Approval Note Agent to generate your first audit-ready report."
                        />
                      </td>
                    </tr>
                  ) : (
                    reports.map((report) => (
                      <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400" aria-hidden="true">📋</span>
                            <div>
                              <span className="truncate max-w-[180px] block" title={report.title || report.filename}>
                                {report.title || report.filename}
                              </span>
                              <span className="text-xs text-slate-400 font-mono block">
                                {report.filename}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                          <span className="truncate max-w-[160px] block" title={report.documentName || report.documentId}>
                            {report.documentName || report.documentId || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={report.riskLevel || 'Insufficient Evidence'} />
                        </td>
                        <td className="px-4 py-3 text-slate-500 hidden md:table-cell text-xs">
                          {formatDate(report.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={report.status || 'GENERATED'} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Download ${report.filename}`}
                            onClick={() => handleDownload(report.filename, report.id)}
                            disabled={downloadingId === report.id}
                            title={`Download ${report.filename}`}
                          >
                            {downloadingId === report.id ? 'Downloading…' : 'Download'}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
              <p className="text-xs text-slate-500">
                {reports.length} report{reports.length !== 1 ? 's' : ''} · Synced live from PostgreSQL
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
