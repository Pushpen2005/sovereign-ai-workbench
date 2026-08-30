/**
 * STATE LAYER — appState.js
 *
 * Global application state context:
 * - sidebar open/closed
 * - notification state
 */

import React, { createContext, useContext, useReducer, useCallback } from 'react';

const initialState = {
  sidebarOpen: true,
  notifications: [],
};

function appReducer(state, action) {
  switch (action.type) {
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    case 'SET_SIDEBAR':
      return { ...state, sidebarOpen: action.payload };
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications, { id: Date.now(), ...action.payload }],
      };
    case 'DISMISS_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.payload),
      };
    default:
      return state;
  }
}

const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppStateProvider');
  return ctx;
}

// Convenience action creators
export function useAppActions() {
  const dispatch = useAppDispatch();
  return {
    toggleSidebar: useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR' }), [dispatch]),
    setSidebar: useCallback((open) => dispatch({ type: 'SET_SIDEBAR', payload: open }), [dispatch]),
    notify: useCallback(
      (message, level = 'info') =>
        dispatch({ type: 'ADD_NOTIFICATION', payload: { message, level } }),
      [dispatch],
    ),
    dismiss: useCallback((id) => dispatch({ type: 'DISMISS_NOTIFICATION', payload: id }), [dispatch]),
  };
}
