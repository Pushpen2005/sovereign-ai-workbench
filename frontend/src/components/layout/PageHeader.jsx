/**
 * LAYOUT COMPONENT — PageHeader.jsx
 *
 * Consistent page-level heading with optional subtitle and actions.
 */

import React from 'react';

export function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={['flex items-start justify-between gap-4 mb-6', className].join(' ')}>
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
