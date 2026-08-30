/**
 * LAYOUT COMPONENT — Topbar.jsx
 *
 * Top navigation bar with sidebar toggle and breadcrumb.
 */

import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAppActions } from '../../state/appState.jsx';

const ROUTE_LABELS = {
  '/dashboard': 'Dashboard',
  '/documents': 'Documents',
  '/chat':      'AI Chat',
  '/agent':     'Agent Workspace',
  '/reports':   'Reports',
  '/security':  'Security',
};

export function Topbar() {
  const { toggleSidebar } = useAppActions();
  const location = useLocation();
  const currentLabel = ROUTE_LABELS[location.pathname] || 'SovereignAI';

  return (
    <header className="flex items-center gap-4 h-16 px-4 border-b border-slate-200 bg-white">
      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        aria-label="Toggle navigation"
        aria-expanded="true"
        className="flex-shrink-0 p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Page title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-slate-900 truncate">{currentLabel}</h1>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-3">
        {/* System status pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 border border-green-200 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" aria-hidden="true" />
          <span className="text-xs font-medium text-green-700">All systems operational</span>
        </div>
      </div>
    </header>
  );
}
