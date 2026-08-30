/**
 * UI COMPONENT — Card.jsx
 *
 * Variants: standard | metric | workflow | source
 */

import React from 'react';

export function Card({ children, className = '', variant = 'standard', ...props }) {
  const base = 'bg-white rounded-lg border border-slate-200 shadow-sm';
  const variantClass =
    variant === 'metric'   ? 'p-5' :
    variant === 'workflow' ? 'p-4 border-l-4 border-l-blue-500' :
    variant === 'source'   ? 'p-3 bg-slate-50 border-slate-200' :
    'p-5';

  return (
    <div className={[base, variantClass, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export function MetricCard({ label, value, icon, sublabel, className = '' }) {
  return (
    <Card variant="metric" className={className}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
          {sublabel && <p className="mt-1 text-xs text-slate-400">{sublabel}</p>}
        </div>
        {icon && (
          <div className="flex-shrink-0 text-2xl text-slate-300">{icon}</div>
        )}
      </div>
    </Card>
  );
}
