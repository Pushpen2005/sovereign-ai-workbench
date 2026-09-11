/**
 * Document Authorization Service
 * Enforces strict isolation of document types across SovereignAI components.
 * 
 * Matrix:
 * AI_SEARCH: 'other' (Technical Documents)
 * KNOWLEDGE_BASE: 'sop' (Standard Operating Procedures)
 * INSPECTION_INPUT: 'inspection' (Inspection Reports)
 * INSPECTION_EVIDENCE: 'sop' (Standard Operating Procedures)
 */

export const DOCUMENT_TYPES = {
  SOP: "sop",
  INSPECTION: "inspection",
  TECHNICAL: "other", // technical documents are stored as 'other' for backwards compatibility
};

export const USE_CASES = {
  AI_SEARCH: "AI_SEARCH",
  KNOWLEDGE_BASE: "KNOWLEDGE_BASE",
  INSPECTION_INPUT: "INSPECTION_INPUT",
  INSPECTION_EVIDENCE: "INSPECTION_EVIDENCE",
};

/**
 * Validates if the given documentType is allowed for the specific use case.
 * @param {object} params
 * @param {string} params.useCase
 * @param {string} params.documentType
 * @returns {boolean}
 */
export function canAccessDocumentType({ useCase, documentType }) {
  if (!documentType || typeof documentType !== "string") return false;
  
  const type = documentType.trim().toLowerCase();

  switch (useCase) {
    case USE_CASES.AI_SEARCH:
      return type === DOCUMENT_TYPES.TECHNICAL;
    case USE_CASES.KNOWLEDGE_BASE:
    case USE_CASES.INSPECTION_EVIDENCE:
      return type === DOCUMENT_TYPES.SOP;
    case USE_CASES.INSPECTION_INPUT:
      return type === DOCUMENT_TYPES.INSPECTION;
    default:
      return false;
  }
}

/**
 * Returns the exact allowed document type for a specific use case.
 * Helpful for strict SQL or vector database filtering.
 * @param {string} useCase 
 * @returns {string} The canonical document type string.
 */
export function getAllowedDocumentTypeForUseCase(useCase) {
  switch (useCase) {
    case USE_CASES.AI_SEARCH:
      return DOCUMENT_TYPES.TECHNICAL;
    case USE_CASES.KNOWLEDGE_BASE:
    case USE_CASES.INSPECTION_EVIDENCE:
      return DOCUMENT_TYPES.SOP;
    case USE_CASES.INSPECTION_INPUT:
      return DOCUMENT_TYPES.INSPECTION;
    default:
      throw new Error(`Unknown use case: ${useCase}`);
  }
}
