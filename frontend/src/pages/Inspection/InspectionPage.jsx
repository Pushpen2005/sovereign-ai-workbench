/**
 * PAGE — InspectionPage.jsx
 *
 * Route: /inspection
 * Dedicated workspace for confidential inspection report analysis and Approval Note generation.
 */

import React from 'react';
import { InspectionAgentWorkspace } from './InspectionAgentWorkspace.jsx';

export function InspectionPage() {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-4">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Inspection Agent Workspace</h2>
        <p className="text-xs text-slate-500">
          Upload industrial equipment inspection reports, extract grounded findings, match against maintenance SOPs, and compile audit-ready Approval Notes.
        </p>
      </div>

      <InspectionAgentWorkspace />
    </div>
  );
}
export default InspectionPage;
