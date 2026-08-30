/**
 * MOCK DATA — centralized data for PR #18 UI demonstration.
 *
 * All mock data lives here. Components never define inline mock objects.
 * In PR #19+ these are replaced by real API responses.
 */

// ─── Documents ──────────────────────────────────────────────────────────────
// Real documents come from POST /api/v1/inspection/ingest (PR #19).
// No seeded mock documents — the documents list starts empty.
export const mockDocuments = [];



// ─── Inspection Findings ─────────────────────────────────────────────────────

export const mockFindings = [
  {
    id: 'finding-001',
    finding: 'Pump-03 bearing temperature observed at 92 °C, exceeding documented continuous operating limit of 80 °C.',
    equipment: 'Pump-03',
    observedValue: '92 °C',
    limit: '80 °C',
    severity: 'HIGH',
    evidence: 'Contact probe measurement recorded during routine thermal inspection of rotating equipment on 2025-06-14.',
    source: { documentId: 'doc-001', filename: 'Inspection_Report_RIL_2025.pdf', page: 4 },
  },
];

// ─── Risk Assessment ─────────────────────────────────────────────────────────

export const mockRiskAssessment = {
  level: 'MEDIUM',
  reason:
    'Bearing temperature exceedance of 15% above continuous operating limit indicates elevated risk of bearing failure. Equipment should not be returned to service without a comprehensive bearing inspection. SOP-MAINT-001 mandates immediate corrective action.',
};

export const mockRecommendation =
  'Immediately remove Pump-03 from service. Perform full bearing assembly inspection. Inspect lubrication condition and check for abnormal vibration. Return to service only upon satisfactory inspection outcome as per SOP-MAINT-001.';

export const mockCitations = [
  {
    documentId: 'doc-002',
    filename: 'Demo_Maintenance_SOP.pdf',
    page: 1,
    chunkIndex: 0,
  },
];

// ─── Workflow Steps ──────────────────────────────────────────────────────────

export const mockWorkflowSteps = [
  { id: 'step-1', label: 'Reading inspection report', status: 'complete' },
  { id: 'step-2', label: 'Extracting findings', status: 'complete' },
  { id: 'step-3', label: 'Searching SOP knowledge base', status: 'complete' },
  { id: 'step-4', label: 'Analysing risks', status: 'complete' },
  { id: 'step-5', label: 'Preparing recommendation', status: 'complete' },
  { id: 'step-6', label: 'Generating approval note', status: 'complete' },
];

// ─── Reports ─────────────────────────────────────────────────────────────────

export const mockReports = [
  {
    id: 'report-001',
    filename: 'Approval_Note_Pump03_2025.docx',
    document: 'Inspection_Report_RIL_2025.pdf',
    createdAt: '2025-06-15T11:00:00Z',
    status: 'Generated',
    sizeMb: 0.04,
  },
  {
    id: 'report-002',
    filename: 'Approval_Note_Boiler_2025.docx',
    document: 'Boiler_Safety_SOP_v3.pdf',
    createdAt: '2025-06-13T17:00:00Z',
    status: 'Generated',
    sizeMb: 0.04,
  },
];

// ─── Dashboard Metrics ────────────────────────────────────────────────────────

export const mockMetrics = {
  documents: 5,
  queries: 34,
  reports: 2,
  inspectionAnalyses: 3,
};

export const mockSystemStatus = [
  { label: 'Local LLM', status: 'operational', note: 'llama3.2:3b · Ollama' },
  { label: 'Embeddings', status: 'operational', note: 'all-MiniLM-L6-v2 · 384-d' },
  { label: 'Qdrant Vector DB', status: 'operational', note: 'localhost:6333' },
  { label: 'OCR Engine', status: 'operational', note: 'Tesseract 5' },
  { label: 'External AI APIs', status: 'neutral', note: '0 external calls' },
];
