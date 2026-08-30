/**
 * App.jsx — Root application component.
 *
 * Composes all state providers and mounts the router.
 */

import React from 'react';
import { AppStateProvider } from '../state/appState.jsx';
import { DocumentStateProvider } from '../state/documentState.jsx';
import { InspectionStateProvider } from '../state/inspectionState.jsx';
import { AppRoutes } from '../routes/routes.jsx';

export default function App() {
  return (
    <AppStateProvider>
      <DocumentStateProvider>
        <InspectionStateProvider>
          <AppRoutes />
        </InspectionStateProvider>
      </DocumentStateProvider>
    </AppStateProvider>
  );
}
