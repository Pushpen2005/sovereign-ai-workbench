/**
 * App.jsx — Root application component.
 *
 * Composes all state providers and mounts the router.
 */

import React from 'react';
import { AuthProvider } from '../state/authState.jsx';
import { AppStateProvider } from '../state/appState.jsx';
import { DocumentStateProvider } from '../state/documentState.jsx';
import { InspectionStateProvider } from '../state/inspectionState.jsx';
import { AppRoutes } from '../routes/routes.jsx';

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <DocumentStateProvider>
          <InspectionStateProvider>
            <AppRoutes />
          </InspectionStateProvider>
        </DocumentStateProvider>
      </AppStateProvider>
    </AuthProvider>
  );
}
