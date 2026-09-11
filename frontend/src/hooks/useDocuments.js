/**
 * HOOK LAYER — useDocuments.js
 *
 * Connects the Documents UI to the document state and API layer.
 * Components use this hook — they NEVER call fetch directly.
 *
 * Upload flow:
 *   Component → uploadDocument(file)
 *              → documents.api.uploadDocument(file)
 *              → POST /api/v1/inspection/ingest
 *              → state updated with real backend response
 */

import { useCallback, useEffect, useState } from 'react';
import { useDocumentState, useDocumentActions } from '../state/documentState.jsx';
import {
  uploadDocument as uploadDocumentApi,
  fetchDocuments as fetchDocumentsApi,
  deleteDocument as deleteDocumentApi,
} from '../api/documents.api.js';

// Max file size the UI will warn about (backend is authoritative)
const MAX_FILE_SIZE_MB = 50;

export function useDocuments(options = {}) {
  const documentTypeFilter = typeof options === 'string' ? options : options?.documentType;
  const state = useDocumentState();
  const actions = useDocumentActions();
  const {
    setDocuments,
    removeDocument,
    uploadStart,
    uploadSuccess,
    uploadError,
    uploadReset,
    selectDocument,
    clearSelection,
  } = actions;
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  /**
   * Fetch documents from PostgreSQL backend and update state.
   */
  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetchDocumentsApi(documentTypeFilter);
      if (res && res.success && Array.isArray(res.documents)) {
        setDocuments(res.documents);
      }
    } catch (err) {
      console.warn('Could not fetch persisted documents from backend:', err?.message);
      setActionError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [setDocuments, documentTypeFilter]);

  // Load documents on initial mount and when filter changes
  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  /**
   * Validate and upload a PDF file to the backend.
   * Calls POST /api/v1/documents.
   *
   * @param {File} file
   * @param {string} [documentType] - Optional document type ('sop' | 'inspection' | 'other')
   * @returns {Promise<void>}
   */
  const uploadDocument = useCallback(
    async (file, documentType) => {
      const targetType = documentType || documentTypeFilter || 'inspection';
      // ── Frontend validation ───────────────────────────────────────────────
      if (!file) {
        actions.uploadError('No file selected.');
        return;
      }
      if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        actions.uploadError('Only PDF files are supported. Please select a .pdf file.');
        return;
      }
      const sizeMb = file.size / 1024 / 1024;
      if (sizeMb > MAX_FILE_SIZE_MB) {
        uploadError(
          `File is too large (${sizeMb.toFixed(1)} MB). Maximum allowed size is ${MAX_FILE_SIZE_MB} MB.`,
        );
        return;
      }

      // ── Begin upload ──────────────────────────────────────────────────────
      uploadStart({ name: file.name, sizeMb: +sizeMb.toFixed(2), documentType: targetType });

      try {
        // Ingest into Qdrant + PostgreSQL
        const result = await uploadDocumentApi(file, targetType);

        // Backend returns: { success, documentId, filename, originalFilename, documentType, chunksStored }
        uploadSuccess(result);

        // Refetch to sync full database state
        await loadDocuments();
      } catch (err) {
        // Never expose raw stack traces; show human-readable message
        const message = err?.message || 'Upload failed. Please try again.';
        uploadError(message);
      }
    },
    [uploadError, uploadStart, uploadSuccess, loadDocuments, documentTypeFilter],
  );

  /**
   * Delete a document by ID and refresh state.
   */
  const deleteDocument = useCallback(
    async (documentId) => {
      if (!documentId) return;
      try {
        await deleteDocumentApi(documentId);
        // Immediately remove from local state for instant UI responsiveness
        removeDocument(documentId);
        // Refresh to guarantee PostgreSQL synchronization
        await loadDocuments();
      } catch (err) {
        setActionError(err?.message || 'Unable to delete document.');
        throw err;
      }
    },
    [removeDocument, loadDocuments],
  );

  const clearError = useCallback(() => {
    uploadReset();
    setActionError(null);
  }, [uploadReset]);

  return {
    // Document list (loaded from PostgreSQL backend)
    documents: state.documents,
    loading,
    actionError,

    // Selection
    selectedDocument: state.selectedDocument,
    selectDocument,
    clearSelection,

    // Upload state machine
    uploadState: state.uploadState,        // 'idle' | 'uploading' | 'indexing' | 'success' | 'error'
    isUploading: state.uploadState === 'uploading' || state.uploadState === 'indexing',
    isUploadSuccess: state.uploadState === 'success',
    uploadError: state.uploadError,
    pendingFile: state.pendingFile,        // { name, sizeMb } — captured before API call
    lastUploaded: state.lastUploaded,      // { documentId, filename, chunksStored } — from backend

    // Actions
    uploadDocument,
    deleteDocument,
    resetUpload: uploadReset,
    clearError,
    refreshDocuments: loadDocuments,
  };
}

