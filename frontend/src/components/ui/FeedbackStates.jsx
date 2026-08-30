/**
 * UI COMPONENT — LoadingState, EmptyState, ErrorState
 *
 * Reusable feedback components for async states.
 */

import React from 'react';

export function LoadingState({ message = 'Loading…', className = '' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={['flex flex-col items-center justify-center gap-3 py-12 text-slate-400', className].join(' ')}
    >
      <svg
        className="w-6 h-6 animate-spin text-blue-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function EmptyState({ title = 'No data available', description, action, className = '' }) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-3 py-16 text-center',
        className,
      ].join(' ')}
    >
      <div className="text-4xl text-slate-200" aria-hidden="true">📄</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {description && <p className="text-xs text-slate-400 max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className = '' }) {
  return (
    <div
      role="alert"
      className={[
        'flex flex-col items-center justify-center gap-3 py-12 text-center',
        className,
      ].join(' ')}
    >
      <div className="text-4xl text-red-200" aria-hidden="true">⚠</div>
      <p className="text-sm font-semibold text-red-600">{title}</p>
      {message && <p className="text-xs text-slate-500 max-w-xs">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          Try again
        </button>
      )}
    </div>
  );
}
