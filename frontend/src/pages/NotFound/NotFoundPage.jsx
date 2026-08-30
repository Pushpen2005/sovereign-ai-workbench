/**
 * PAGE — NotFoundPage.jsx
 *
 * Route: *
 * 404 Not Found page.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <p className="text-6xl font-bold text-slate-200" aria-hidden="true">404</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-800">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        The page you are looking for does not exist.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={() => navigate(-1)} variant="outline">Go back</Button>
        <Button onClick={() => navigate('/dashboard')}>Dashboard</Button>
      </div>
    </div>
  );
}
