/**
 * PAGE — LandingPage.jsx
 *
 * Route: /
 * Public landing page: brand, tagline, feature cards, CTA buttons.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button.jsx';

const FEATURES = [
  {
    icon: '🔒',
    title: 'Local AI',
    description: 'Inference runs entirely on your own infrastructure. No data leaves your network.',
  },
  {
    icon: '📚',
    title: 'RAG',
    description: 'Retrieval-Augmented Generation over your proprietary document corpus.',
  },
  {
    icon: '🔍',
    title: 'OCR',
    description: 'Automated text extraction from scanned PDFs and industrial report images.',
  },
  {
    icon: '⚙',
    title: 'Agentic Workflows',
    description: 'End-to-end automated inspection analysis, risk evaluation, and approval note generation.',
  },
  {
    icon: '🏭',
    title: 'Private Infrastructure',
    description: 'Self-hosted Qdrant, Ollama, and embeddings. Zero external AI API dependency.',
  },
];

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
            S
          </div>
          <span className="text-sm font-semibold text-white">SovereignAI</span>
        </div>
        <nav aria-label="Top navigation">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="text-slate-300 hover:text-white hover:bg-slate-800"
          >
            Login
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 bg-slate-800 border border-slate-700 rounded-full text-xs text-slate-300">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
          Fully local · No external AI APIs
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight max-w-3xl">
          Private AI for Confidential{' '}
          <span className="text-blue-400">Industrial Work</span>
        </h1>

        {/* Sub-headline */}
        <p className="mt-6 text-lg text-slate-400 max-w-xl">
          SovereignAI delivers intelligent document analysis, risk assessment, and automated approval notes — all running on your own servers.
        </p>

        {/* Capability tags */}
        <div className="flex flex-wrap justify-center gap-2 mt-6">
          {['Local AI', 'RAG', 'OCR', 'Agents', 'Sovereign Infrastructure'].map((tag) => (
            <span
              key={tag}
              className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-full text-xs text-slate-300"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 mt-10">
          <Button
            size="lg"
            onClick={() => navigate('/dashboard')}
            aria-label="Get started — go to dashboard"
          >
            Get Started
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate('/dashboard')}
            className="border-slate-600 text-slate-200 hover:bg-slate-800 hover:border-slate-500"
          >
            Login
          </Button>
        </div>
      </section>

      {/* Feature cards */}
      <section aria-labelledby="features-heading" className="px-6 pb-20">
        <h2 id="features-heading" className="sr-only">Platform capabilities</h2>
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="bg-slate-900 border border-slate-800 rounded-lg p-5 hover:border-slate-600 transition-colors"
            >
              <div className="text-2xl mb-3" aria-hidden="true">{f.icon}</div>
              <h3 className="text-sm font-semibold text-white">{f.title}</h3>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">{f.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-4 text-center">
        <p className="text-xs text-slate-600">
          SovereignAI &mdash; Private AI for Confidential Industrial Work
        </p>
      </footer>
    </div>
  );
}
