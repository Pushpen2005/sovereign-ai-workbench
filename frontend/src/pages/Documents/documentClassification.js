/**
 * Document Classification Utilities
 * Authoritative canonical document types: 'sop' | 'inspection' | 'other'
 */

export function inferDocumentType(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.includes('sop') || lower.includes('procedure') || lower.includes('manual')) {
    return 'SOP';
  }
  if (lower.includes('inspection') || lower.includes('iar') || lower.includes('report') || lower.includes('audit')) {
    return 'Inspection Report';
  }
  return 'Technical Document';
}

export function getCanonicalDocumentType(doc) {
  if (doc?.documentType && typeof doc.documentType === 'string' && doc.documentType.trim()) {
    return doc.documentType.trim().toLowerCase();
  }
  // Legacy fallback: guess from filename only when documentType is missing/null
  const inferred = inferDocumentType(doc?.originalFilename || doc?.filename || '');
  if (inferred === 'SOP') return 'sop';
  if (inferred === 'Inspection Report') return 'inspection';
  return 'other';
}

export function getDisplayDocumentType(doc) {
  const canonical = getCanonicalDocumentType(doc);
  switch (canonical) {
    case 'sop':
      return 'SOP';
    case 'inspection':
      return 'Inspection Report';
    case 'other':
    default:
      return 'Technical Document';
  }
}

export function resolveUploadDocumentType(activeFilter, explicitChoice = null) {
  if (activeFilter === 'SOPs') return 'sop';
  if (activeFilter === 'Inspection Reports') return 'inspection';
  if (activeFilter === 'Other') return 'other';
  return explicitChoice || 'inspection';
}

export function matchesFilter(doc, activeFilter) {
  if (activeFilter === 'All') return true;
  const canonical = getCanonicalDocumentType(doc);
  if (activeFilter === 'Inspection Reports') return canonical === 'inspection';
  if (activeFilter === 'SOPs') return canonical === 'sop';
  if (activeFilter === 'Other') return canonical === 'other';
  return true;
}
