/**
 * LAYOUT COMPONENT — Topbar.jsx
 *
 * Top navigation bar with sidebar toggle, breadcrumb, and sovereignty status.
 */

import React from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { useAppActions } from '../../state/appState.jsx';
import { useAuth } from '../../state/authState.jsx';

const ROUTE_LABELS = {
  '/dashboard': 'Dashboard',
  '/documents': 'Documents',
  '/chat':      'AI Search & Workspace',
  '/agent':     'Inspection Agent',
  '/reports':   'Reports',
  '/security':  'Security & Sovereignty',
  '/coding':    'Coding Sandbox',
  '/vision':    'Vision Analysis',
};

export function Topbar() {
  const { toggleSidebar } = useAppActions();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentLabel = ROUTE_LABELS[location.pathname] || 'SovereignAI';

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-slate-200 bg-white/90 backdrop-blur-sm z-10 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Sidebar toggle */}
        <button
          onClick={toggleSidebar}
          aria-label="Toggle navigation"
          className="flex-shrink-0 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Page title */}
        <h1 className="text-sm font-semibold text-slate-800 truncate">{currentLabel}</h1>
      </div>

      {/* Right Section: Sovereignty & Air-Gap status + User Info */}
      <div className="flex items-center gap-3">
        <Link
          to="/security"
          className="hidden sm:flex items-center gap-2 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full transition-colors"
          title="Click to view data sovereignty audit"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          <span className="text-xs font-semibold text-emerald-800">
            Local Self-Hosted · 0 Cloud Calls
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
            <div className="text-right hidden md:block">
              <p className="text-xs font-semibold text-slate-800 leading-tight">{user.name}</p>
              <p className="text-[10px] font-mono text-slate-500 uppercase">{user.role || 'Engineer'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign Out"
              aria-label="Sign Out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
