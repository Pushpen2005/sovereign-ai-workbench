/**
 * UI COMPONENT — Badge.jsx
 *
 * Variants: success | warning | danger | neutral | info
 */

import React from 'react';

const variantClasses = {
  success: 'bg-green-100 text-green-800 ring-green-200',
  warning: 'bg-amber-100 text-amber-800 ring-amber-200',
  danger:  'bg-red-100 text-red-700 ring-red-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  info:    'bg-blue-100 text-blue-700 ring-blue-200',
};

export function Badge({ children, variant = 'neutral', className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5',
        'text-xs font-medium rounded-full',
        'ring-1',
        variantClasses[variant] || variantClasses.neutral,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  );
}

// Convenience: map document status to badge variant
export function StatusBadge({ status }) {
  const map = {
    Indexed:    { variant: 'success', label: 'Indexed' },
    Processing: { variant: 'warning', label: 'Processing' },
    Failed:     { variant: 'danger',  label: 'Failed' },
    Generated:  { variant: 'success', label: 'Generated' },
    HIGH:       { variant: 'danger',  label: 'HIGH' },
    MEDIUM:     { variant: 'warning', label: 'MEDIUM' },
    LOW:        { variant: 'success', label: 'LOW' },
  };
  const config = map[status] || { variant: 'neutral', label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
