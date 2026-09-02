/**
 * LAYOUT COMPONENT — AppLayout.jsx
 *
 * Main authenticated shell: Sidebar + Topbar + scrollable main content.
 * Sidebar width is controlled by appState.sidebarOpen.
 */

import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.jsx';
import { Topbar } from './Topbar.jsx';
import { useAppState } from '../../state/appState.jsx';

export function AppLayout() {
  const { sidebarOpen } = useAppState();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100/60">
      <Sidebar />

      {/* Main workspace container shifts right based on sidebar width */}
      <div
        className={[
          'flex flex-col flex-1 min-w-0 h-full overflow-hidden transition-[margin] duration-200 ease-in-out',
          sidebarOpen ? 'lg:ml-64' : 'lg:ml-16',
          'ml-0',
        ].join(' ')}
      >
        <Topbar />
        <main
          id="main-content"
          className="flex-1 overflow-y-auto p-4 sm:p-6"
          role="main"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
