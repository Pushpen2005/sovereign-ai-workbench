/**
 * ROUTES — routes.jsx
 *
 * Centralized route configuration.
 */

import React from 'react';
import { Routes, Route } from 'react-router-dom';

import { AppLayout } from '../components/layout/AppLayout.jsx';
import { ProtectedRoute } from '../components/auth/ProtectedRoute.jsx';
import { LandingPage }    from '../pages/Landing/LandingPage.jsx';
import { LoginPage }      from '../pages/Auth/LoginPage.jsx';
import { RegisterPage }   from '../pages/Auth/RegisterPage.jsx';
import { DashboardPage }  from '../pages/Dashboard/DashboardPage.jsx';
import { DocumentsPage }  from '../pages/Documents/DocumentsPage.jsx';
import { ChatPage }       from '../pages/Chat/ChatPage.jsx';
import { AgentPage }      from '../pages/Agent/AgentPage.jsx';
import { InspectionPage } from '../pages/Inspection/InspectionPage.jsx';
import { ReportsPage }    from '../pages/Reports/ReportsPage.jsx';
import { SecurityPage }   from '../pages/Security/SecurityPage.jsx';
import { CodingPage }     from '../pages/Coding/CodingPage.jsx';
import { VisionPage }     from '../pages/Vision/VisionPage.jsx';
import { NotFoundPage }   from '../pages/NotFound/NotFoundPage.jsx';

export function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Authenticated protected workbench shell */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard"  element={<DashboardPage />} />
          <Route path="/documents"  element={<DocumentsPage />} />
          <Route path="/chat"       element={<ChatPage />} />
          <Route path="/coding"     element={<CodingPage />} />
          <Route path="/vision"     element={<VisionPage />} />
          <Route path="/agent"      element={<AgentPage />} />
          <Route path="/inspection" element={<InspectionPage />} />
          <Route path="/reports"    element={<ReportsPage />} />
          <Route path="/security"   element={<SecurityPage />} />
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
