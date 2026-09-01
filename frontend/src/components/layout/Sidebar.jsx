/**
 * LAYOUT COMPONENT — Sidebar.jsx
 *
 * Navigation sidebar with active route highlighting.
 * Collapses to an icon-only drawer on mobile.
 */

import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppState, useAppActions } from '../../state/appState.jsx';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard',        icon: '⊞' },
  { to: '/documents', label: 'Documents',         icon: '📄' },
  { to: '/chat',      label: 'AI Chat',           icon: '💬' },
  { to: '/coding',    label: 'Coding Sandbox',    icon: '💻' },
  { to: '/vision',    label: 'Vision Analysis',   icon: '👁' },
  { to: '/agent',     label: 'Agent Workspace',   icon: '⚙' },
  { to: '/reports',   label: 'Reports',           icon: '📋' },
  { to: '/security',  label: 'Security',          icon: '🔒' },
];

export function Sidebar() {
  const { sidebarOpen } = useAppState();
  const { toggleSidebar } = useAppActions();

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          aria-hidden="true"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar panel */}
      <aside
        id="sidebar"
        aria-label="Main navigation"
        className={[
          'fixed top-0 left-0 h-full z-30',
          'flex flex-col',
          'bg-slate-900 text-slate-100',
          'transition-[width] duration-200 ease-in-out overflow-hidden',
          sidebarOpen ? 'w-56' : 'w-0 lg:w-16',
        ].join(' ')}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700 min-h-[64px]">
          <div className="flex-shrink-0 w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center text-white font-bold text-sm select-none">
            S
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">SovereignAI</p>
              <p className="text-[10px] text-slate-400 truncate">Private AI</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 overflow-y-auto" aria-label="Primary navigation">
          <ul className="flex flex-col gap-1" role="list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium',
                      'transition-colors duration-150 whitespace-nowrap overflow-hidden',
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                    ].join(' ')
                  }
                  aria-current={({ isActive }) => (isActive ? 'page' : undefined)}
                >
                  <span className="text-base flex-shrink-0" aria-hidden="true">{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom items */}
        <div className="border-t border-slate-700 px-2 py-4 flex flex-col gap-1">
          <button
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="Settings"
          >
            <span aria-hidden="true">⚙</span>
            {sidebarOpen && <span>Settings</span>}
          </button>
          <button
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            aria-label="User profile"
          >
            <span aria-hidden="true">👤</span>
            {sidebarOpen && <span>User</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
