/**
 * ROUTES — routes.jsx
 *
 * Centralized route configuration.
 */

import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { AppLayout } from '../components/layout/AppLayout.jsx';
import { LandingPage }    from '../pages/Landing/LandingPage.jsx';
import { DashboardPage }  from '../pages/Dashboard/DashboardPage.jsx';
import { DocumentsPage }  from '../pages/Documents/DocumentsPage.jsx';
import { ChatPage }       from '../pages/Chat/ChatPage.jsx';
import { AgentPage }      from '../pages/Agent/AgentPage.jsx';
import { ReportsPage }    from '../pages/Reports/ReportsPage.jsx';
import { SecurityPage }   from '../pages/Security/SecurityPage.jsx';
import { NotFoundPage }   from '../pages/NotFound/NotFoundPage.jsx';

export function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />

      {/* Authenticated shell */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/chat"      element={<ChatPage />} />
        <Route path="/agent"     element={<AgentPage />} />
        <Route path="/reports"   element={<ReportsPage />} />
        <Route path="/security"  element={<SecurityPage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
