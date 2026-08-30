/**
 * HOOK LAYER — useInspection.js
 *
 * Manages inspection analysis state and exposes analyze().
 * Components use this hook — they never call fetch directly.
 */

import { useState, useCallback } from 'react';
import { mockFindings, mockRiskAssessment, mockRecommendation, mockCitations } from '../data/mockData.js';

export function useInspection() {
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [findings, setFindings] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * PR #21: Replace with inspection.api.js → analyzeInspection() + assessRisk()
   */
  const analyze = useCallback(async (documentId, _task = '') => {
    setLoading(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 1800));
      setFindings(mockFindings);
      setRiskAssessment(mockRiskAssessment);
      setRecommendation(mockRecommendation);
      setCitations(mockCitations);
    } catch (err) {
      setError(err.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setFindings([]);
    setRiskAssessment(null);
    setRecommendation(null);
    setCitations([]);
    setError(null);
  }, []);

  return {
    selectedDocument,
    setSelectedDocument,
    findings,
    riskAssessment,
    recommendation,
    citations,
    loading,
    error,
    analyze,
    reset,
  };
}
