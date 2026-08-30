/**
 * STATE LAYER — inspectionState.jsx
 *
 * Inspection workflow state:
 * - activeDocument
 * - findings
 * - riskAssessment
 * - recommendation
 * - workflowStatus
 */

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const initialState = {
  activeDocument: null,
  findings: [],
  riskAssessments: [],
  recommendations: [],
  citations: [],
  approvalNote: null,
  workflowStatus: 'idle', // 'idle' | 'running' | 'complete' | 'error'
  workflowError: null,
  workflowSteps: [],
};

function inspectionReducer(state, action) {
  switch (action.type) {
    case 'SET_ACTIVE_DOCUMENT':
      return { ...state, activeDocument: action.payload };
    case 'SET_FINDINGS':
      return { ...state, findings: action.payload };
    case 'SET_RISK_ASSESSMENTS':
      return { ...state, riskAssessments: action.payload };
    case 'SET_RECOMMENDATIONS':
      return { ...state, recommendations: action.payload };
    case 'SET_CITATIONS':
      return { ...state, citations: action.payload };
    case 'SET_APPROVAL_NOTE':
      return { ...state, approvalNote: action.payload };
    case 'WORKFLOW_START':
      return { ...state, workflowStatus: 'running', workflowError: null };
    case 'WORKFLOW_STEP':
      return {
        ...state,
        workflowSteps: [...state.workflowSteps, action.payload],
      };
    case 'WORKFLOW_COMPLETE':
      return { ...state, workflowStatus: 'complete', ...action.payload };
    case 'WORKFLOW_ERROR':
      return { ...state, workflowStatus: 'error', workflowError: action.payload };
    case 'WORKFLOW_RESET':
      return { ...initialState };
    default:
      return state;
  }
}

const InspectionStateContext = createContext(null);
const InspectionDispatchContext = createContext(null);

export function InspectionStateProvider({ children }) {
  const [state, dispatch] = useReducer(inspectionReducer, initialState);
  return (
    <InspectionStateContext.Provider value={state}>
      <InspectionDispatchContext.Provider value={dispatch}>
        {children}
      </InspectionDispatchContext.Provider>
    </InspectionStateContext.Provider>
  );
}

export function useInspectionState() {
  const ctx = useContext(InspectionStateContext);
  if (!ctx) throw new Error('useInspectionState must be used within InspectionStateProvider');
  return ctx;
}

export function useInspectionDispatch() {
  const ctx = useContext(InspectionDispatchContext);
  if (!ctx) throw new Error('useInspectionDispatch must be used within InspectionStateProvider');
  return ctx;
}

export function useInspectionActions() {
  const dispatch = useInspectionDispatch();
  return {
    setActiveDocument: useCallback(
      (doc) => dispatch({ type: 'SET_ACTIVE_DOCUMENT', payload: doc }),
      [dispatch],
    ),
    workflowStart: useCallback(() => dispatch({ type: 'WORKFLOW_START' }), [dispatch]),
    workflowComplete: useCallback(
      (result) => dispatch({ type: 'WORKFLOW_COMPLETE', payload: result }),
      [dispatch],
    ),
    workflowError: useCallback(
      (err) => dispatch({ type: 'WORKFLOW_ERROR', payload: err }),
      [dispatch],
    ),
    workflowReset: useCallback(() => dispatch({ type: 'WORKFLOW_RESET' }), [dispatch]),
  };
}
