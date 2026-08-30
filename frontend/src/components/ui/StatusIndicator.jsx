/**
 * UI COMPONENT — StatusIndicator.jsx
 *
 * Small dot + label for system status rows.
 * Statuses: operational | warning | error | neutral
 */

import React from 'react';

const dotClass = {
  operational: 'bg-green-500',
  warning:     'bg-amber-500',
  error:       'bg-red-500',
  neutral:     'bg-slate-400',
};

const labelClass = {
  operational: 'text-green-700',
  warning:     'text-amber-700',
  error:       'text-red-700',
  neutral:     'text-slate-500',
};

export function StatusIndicator({ status = 'neutral', label, note }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={[
          'inline-block w-2 h-2 rounded-full flex-shrink-0',
          dotClass[status] || dotClass.neutral,
        ].join(' ')}
        aria-label={status}
      />
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {note && <span className="text-xs text-slate-400">{note}</span>}
    </div>
  );
}
