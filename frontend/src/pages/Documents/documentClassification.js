/**
 * Document Classification Utilities
 * Authoritative canonical document types: 'sop' | 'inspection' | 'other'
 */

export function inferDocumentType(filename = '') {
  const lower = filename.toLowerCase();
  if (lower.includes('sop') || lower.includes('procedure') || lower.includes('manual') || lower.includes('guideline')) {
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
  if (doc?.document_type && typeof doc.document_type === 'string' && doc.document_type.trim()) {
    return doc.document_type.trim().toLowerCase();
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
      return 'Other';
  }
}

export function resolveUploadDocumentType(activeFilter, explicitChoice = null) {
  if (activeFilter === 'Inspection Reports' || activeFilter === 'Inspection') return 'inspection';
  if (activeFilter === 'SOPs' || activeFilter === 'SOPs / Knowledge Base' || activeFilter === 'Knowledge Base / SOPs' || activeFilter === 'SOP') return 'sop';
  if (activeFilter === 'Other') return 'other';
  return explicitChoice || 'inspection';
}

export function matchesFilter(doc, activeFilter) {
  if (activeFilter === 'All') return true;
  const canonical = getCanonicalDocumentType(doc);
  if (activeFilter === 'Inspection Reports' || activeFilter === 'Inspection') return canonical === 'inspection';
  if (activeFilter === 'SOPs' || activeFilter === 'SOPs / Knowledge Base' || activeFilter === 'Knowledge Base / SOPs' || activeFilter === 'SOP') return canonical === 'sop';
  if (activeFilter === 'Other') return canonical === 'other';
  return true;
}
