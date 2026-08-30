/**
 * UI COMPONENT — Input.jsx
 *
 * Accessible input with label and error support.
 */

import React from 'react';

export function Input({
  id,
  label,
  error,
  hint,
  className = '',
  wrapperClassName = '',
  ...props
}) {
  return (
    <div className={['flex flex-col gap-1', wrapperClassName].join(' ')}>
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-slate-700"
        >
          {label}
        </label>
      )}
      <input
        id={id}
        className={[
          'block w-full rounded-md border px-3 py-2 text-sm',
          'placeholder-slate-400 text-slate-900',
          'focus:outline-none focus:ring-2 focus:ring-offset-1',
          error
            ? 'border-red-400 focus:ring-red-400'
            : 'border-slate-300 focus:ring-blue-500',
          'disabled:bg-slate-50 disabled:text-slate-500',
          className,
        ].join(' ')}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={!!error}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-400">{hint}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
