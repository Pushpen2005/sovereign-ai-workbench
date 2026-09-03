/**
 * PAGE — AgentPage.jsx
 *
 * Route: /agent
 * SovereignAI Flagship Agent Workspaces:
 *   - Autonomous Tool Agent Workspace (LangGraph tool calling, real-time SSE, persistent history)
 *   - Inspection Agent Workspace (Confidential document analysis, SOP verification, Approval Note)
 */

import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AutonomousAgentWorkspace } from './AutonomousAgentWorkspace.jsx';
import { InspectionAgentWorkspace } from '../Inspection/InspectionAgentWorkspace.jsx';

export function AgentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'inspection' ? 'inspection' : 'autonomous';
  const [activeMode, setActiveMode] = useState(initialMode);

  const handleModeChange = (mode) => {
    setActiveMode(mode);
    setSearchParams(mode === 'inspection' ? { mode: 'inspection' } : {});
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      {/* Flagship Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {activeMode === 'autonomous' ? 'Autonomous Agent Workspace' : 'Inspection Agent Workspace'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {activeMode === 'autonomous'
              ? 'Multi-step LangGraph autonomous agent with live SSE execution trace and persistent PostgreSQL observability.'
              : 'End-to-end industrial inspection report analysis, SOP knowledge retrieval, and Approval Note generation.'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center bg-slate-200/80 p-1 rounded-lg text-xs font-semibold shrink-0">
          <button
            type="button"
            onClick={() => handleModeChange('autonomous')}
            className={[
              'px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5',
              activeMode === 'autonomous'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900',
            ].join(' ')}
          >
            <span>Autonomous Agent</span>
            <span className="text-[9px] bg-blue-100 text-blue-800 px-1 py-0.2 rounded font-mono">
              LangGraph
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('inspection')}
            className={[
              'px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5',
              activeMode === 'inspection'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900',
            ].join(' ')}
          >
            <span>Inspection Pipeline</span>
            <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-mono">
              SOP
            </span>
          </button>
        </div>
      </div>

      {/* Render Active Workspace */}
      {activeMode === 'autonomous' ? (
        <AutonomousAgentWorkspace />
      ) : (
        <InspectionAgentWorkspace />
      )}
    </div>
  );
}

export default AgentPage;
