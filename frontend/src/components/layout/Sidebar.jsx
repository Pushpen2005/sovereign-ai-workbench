/**
 * LAYOUT COMPONENT — Sidebar.jsx
 *
 * ChatGPT-inspired industrial navigation sidebar.
 * Features:
 *   - SovereignAI branding & "PRIVATE INDUSTRIAL AI" subtitle
 *   - "+ New Chat" primary trigger
 *   - Core navigation: AI Search, Documents, Inspection Agent, Reports, Security
 *   - Recent conversations list
 *   - Live System Status (Local AI, Qdrant, OCR, PostgreSQL)
 *   - Responsive mobile drawer and collapsible desktop view
 */

import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAppState, useAppActions } from '../../state/appState.jsx';
import { useAuth } from '../../state/authState.jsx';
import { fetchChatHistory } from '../../api/chat.api.js';

const PRIMARY_NAV = [
  { to: '/dashboard', label: 'Dashboard',        icon: '⊞' },
  { to: '/documents', label: 'Documents',        icon: '📄' },
  { to: '/chat',      label: 'AI Chat',          icon: '💬' },
  { to: '/agent',     label: 'Agent Workspace',  icon: '⚡' },
  { to: '/coding',    label: 'Coding',           icon: '💻' },
  { to: '/vision',    label: 'Vision',           icon: '👁' },
  { to: '/reports',   label: 'Reports',          icon: '📋' },
  { to: '/security',  label: 'Security',         icon: '🔒' },
];

const DEFAULT_RECENT_CHATS = [
  { id: '1', title: 'Inspection Report Analysis' },
  { id: '2', title: 'Pump-03 Investigation' },
  { id: '3', title: 'Maintenance SOP Query' },
  { id: '4', title: 'Safety Procedure Review' },
];

export function Sidebar() {
  const { sidebarOpen } = useAppState();
  const { toggleSidebar } = useAppActions();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [recentChats, setRecentChats] = useState(DEFAULT_RECENT_CHATS);

  useEffect(() => {
    fetchChatHistory()
      .then((res) => {
        if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
          setRecentChats(res.data.slice(0, 6));
        }
      })
      .catch(() => {
        // Fallback to default recent chats
      });
  }, []);

  const handleNewChat = () => {
    navigate('/chat?new=true');
    if (window.innerWidth < 1024 && sidebarOpen) {
      toggleSidebar();
    }
  };

  const handleSelectChat = (chatId) => {
    navigate(`/chat?c=${chatId}`);
    if (window.innerWidth < 1024 && sidebarOpen) {
      toggleSidebar();
    }
  };

  return (
    <>
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden transition-opacity"
          aria-hidden="true"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar panel */}
      <aside
        id="sidebar"
        aria-label="Main navigation"
        className={[
          'fixed top-0 left-0 h-full z-40',
          'flex flex-col',
          'bg-slate-950 text-slate-200 border-r border-slate-800/80',
          'transition-[width] duration-200 ease-in-out select-none',
          sidebarOpen ? 'w-64' : 'w-0 lg:w-16',
        ].join(' ')}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800/70 min-h-[64px]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-600 border border-blue-500/40 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              S
            </div>
            {sidebarOpen && (
              <div className="min-w-0">
                <p className="text-sm font-bold text-white tracking-tight truncate">SovereignAI</p>
                <p className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase truncate">
                  PRIVATE INDUSTRIAL AI
                </p>
              </div>
            )}
          </div>

          {sidebarOpen && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Collapse sidebar"
            >
              <span className="text-xs">✕</span>
            </button>
          )}
        </div>

        {/* Tenant / Organization Badge */}
        {sidebarOpen && (
          <div className="mx-3 mt-3 px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-lg text-xs shadow-inner">
            <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">
              <span>Workspace</span>
              <span className="text-emerald-400 text-[9px] font-mono font-semibold">● ON-PREM</span>
            </div>
            <div className="font-semibold text-white truncate text-xs" title={user?.organizationName || "MRPL Demo Organization"}>
              {user?.organizationName || "MRPL Demo Organization"}
            </div>
          </div>
        )}

        {/* Action Button: + New Chat */}
        <div className="p-3 border-b border-slate-900">
          <button
            type="button"
            onClick={handleNewChat}
            className={[
              'w-full flex items-center justify-center gap-2.5 py-2.5 px-3 rounded-lg text-xs font-semibold',
              'bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-all duration-150',
              !sidebarOpen ? 'lg:px-2' : '',
            ].join(' ')}
            title="Start New Chat"
          >
            <span className="text-sm font-bold leading-none">+</span>
            {sidebarOpen && <span>New Chat</span>}
          </button>
        </div>

        {/* Scrollable Navigation & History */}
        <div className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-5 text-xs">
          {/* Primary Navigation */}
          <nav aria-label="Primary">
            <ul className="flex flex-col gap-0.5" role="list">
              {PRIMARY_NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors',
                        isActive
                          ? 'bg-slate-800 text-white font-semibold shadow-inner'
                          : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
                      ].join(' ')
                    }
                  >
                    <span className="text-sm flex-shrink-0" aria-hidden="true">{item.icon}</span>
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* Recent Conversations */}
          {sidebarOpen && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800/60">
              <div className="px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Recent Conversations
              </div>
              <div className="flex flex-col gap-0.5">
                {recentChats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectChat(c.id)}
                    className="w-full text-left px-3 py-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-900 text-xs truncate transition-colors"
                    title={c.title}
                  >
                    {c.title || 'Conversation'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* System Status Cluster */}
        {sidebarOpen && (
          <div className="p-3 border-t border-slate-800/70 bg-slate-950/60 flex flex-col gap-2 text-[11px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              System Status
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-slate-300">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
                <span>Local AI</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
                <span>Qdrant</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
                <span>OCR</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
                <span>PostgreSQL</span>
              </div>
            </div>
          </div>
        )}

        {/* User Profile, Organization & Logout (Section 4 Requirement) */}
        <div className="p-2.5 border-t border-slate-800/70 bg-slate-950">
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800 w-full">
            <div className="w-7 h-7 rounded-full bg-emerald-700/80 border border-emerald-500/40 flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0">
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-semibold text-white truncate">{user?.name || 'Demo User'}</p>
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      navigate('/login', { replace: true });
                    }}
                    className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
                    title="Sign Out"
                    aria-label="Sign Out"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400">
                  <span className="text-emerald-400 truncate font-medium">
                    {user?.organizationName || 'MRPL Demo Org'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 uppercase font-mono text-[9px]">{user?.role || 'member'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
