/**
 * HOOK LAYER — useInspection.js
 *
 * Manages inspection analysis state and exposes analyze().
 * Connects directly to backend API: POST /api/v1/inspection/analyze
 * and POST /api/v1/inspection/risk
 */

import { useState, useCallback } from 'react';
import { analyzeInspection, assessRisk } from '../api/inspection.api.js';

export function useInspection() {
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [findings, setFindings] = useState([]);
  const [riskAssessment, setRiskAssessment] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [citations, setCitations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Execute real inspection analysis and risk evaluation on backend.
   */
  const analyze = useCallback(async (documentId, task = '') => {
    if (!documentId) {
      setError('Document ID is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const analysisResult = await analyzeInspection(documentId, task);
      const extractedFindings = analysisResult?.findings || [];
      setFindings(extractedFindings);

      if (extractedFindings.length > 0) {
        const firstFinding = extractedFindings[0];
        const riskResult = await assessRisk(firstFinding);
        setRiskAssessment(riskResult?.riskAssessment || null);
        setRecommendation(riskResult?.recommendation || null);
        setCitations(riskResult?.citations || []);
      } else {
        setRiskAssessment({
          level: null,
          reason: 'No abnormal findings detected in document.',
        });
        setRecommendation('Continue regular maintenance schedule.');
        setCitations([]);
      }
    } catch (err) {
      setError(err?.message || 'Analysis failed. Please try again.');
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
