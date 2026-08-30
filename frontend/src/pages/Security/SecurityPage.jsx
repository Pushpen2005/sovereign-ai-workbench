/**
 * PAGE — SecurityPage.jsx
 *
 * Route: /security
 * Sovereign infrastructure status and data governance principles.
 */

import React from 'react';
import { PageHeader } from '../../components/layout/PageHeader.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.jsx';
import { mockSystemStatus } from '../../data/mockData.js';

const PRINCIPLES = [
  {
    icon: '🔒',
    title: 'Data remains within controlled infrastructure',
    description:
      'All document ingestion, chunking, embedding, and LLM inference happens on your own servers. No document content is transmitted to external services.',
  },
  {
    icon: '🤖',
    title: 'Local inference only',
    description:
      'Ollama runs the LLM entirely on-premise. Queries never leave your network boundary.',
  },
  {
    icon: '🗄',
    title: 'Self-hosted vector database',
    description:
      'Qdrant runs locally. All embeddings and indexed document chunks are stored on your own disk.',
  },
  {
    icon: '🖨',
    title: 'Local OCR',
    description:
      'Tesseract OCR processes scanned documents without sending files to cloud OCR services.',
  },
  {
    icon: '🚫',
    title: 'Zero unnecessary external AI API calls',
    description:
      'SovereignAI is designed with a zero-external-API-call policy for core AI operations.',
  },
];

export function SecurityPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Sovereign Infrastructure"
        subtitle="Data governance and security principles"
      />

      {/* System Status */}
      <section aria-labelledby="system-status-heading" className="mb-8">
        <h2 id="system-status-heading" className="text-sm font-semibold text-slate-700 mb-3">
          System Status
        </h2>
        <Card>
          <ul className="flex flex-col divide-y divide-slate-100" role="list">
            {mockSystemStatus.map((item) => (
              <li
                key={item.label}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <StatusIndicator status={item.status} label={item.label} />
                <span className="text-xs font-mono text-slate-400">{item.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-400 border-t border-slate-100 pt-3">
            System status shown is placeholder data. Live verification is implemented in PR #25.
          </p>
        </Card>
      </section>

      {/* Security Principles */}
      <section aria-labelledby="principles-heading">
        <h2 id="principles-heading" className="text-sm font-semibold text-slate-700 mb-3">
          Security Principles
        </h2>
        <div className="flex flex-col gap-3">
          {PRINCIPLES.map((p) => (
            <article
              key={p.title}
              className="flex gap-4 p-4 bg-white border border-slate-200 rounded-lg shadow-sm"
            >
              <div className="flex-shrink-0 text-2xl" aria-hidden="true">{p.icon}</div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">{p.title}</h3>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">{p.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
