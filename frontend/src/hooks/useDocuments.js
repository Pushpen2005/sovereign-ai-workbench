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

import { useCallback } from 'react';
import { useDocumentState, useDocumentActions } from '../state/documentState.jsx';
import { uploadDocument as uploadDocumentApi } from '../api/documents.api.js';

// Max file size the UI will warn about (backend is authoritative)
const MAX_FILE_SIZE_MB = 50;

export function useDocuments() {
  const state = useDocumentState();
  const actions = useDocumentActions();

  /**
   * Validate and upload a PDF file to the backend.
   * Calls the real POST /api/v1/inspection/ingest endpoint.
   *
   * @param {File} file
   * @returns {Promise<void>}
   */
  const uploadDocument = useCallback(
    async (file) => {
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
        actions.uploadError(
          `File is too large (${sizeMb.toFixed(1)} MB). Maximum allowed size is ${MAX_FILE_SIZE_MB} MB.`,
        );
        return;
      }

      // ── Begin upload ──────────────────────────────────────────────────────
      actions.uploadStart({ name: file.name, sizeMb: +sizeMb.toFixed(2) });

      try {
        // Single call: upload + extract + chunk + embed + upsert to Qdrant
        const result = await uploadDocumentApi(file);

        // Backend returns: { success, documentId, filename, chunksStored }
        actions.uploadSuccess(result);
      } catch (err) {
        // Never expose raw stack traces; show human-readable message
        const message = err?.message || 'Upload failed. Please try again.';
        actions.uploadError(message);
      }
    },
    [actions],
  );

  const clearError = useCallback(() => actions.uploadReset(), [actions]);

  return {
    // Document list (mock + newly indexed real documents)
    documents: state.documents,

    // Selection
    selectedDocument: state.selectedDocument,
    selectDocument: actions.selectDocument,
    clearSelection: actions.clearSelection,

    // Upload state machine
    uploadState: state.uploadState,        // 'idle' | 'uploading' | 'indexing' | 'success' | 'error'
    isUploading: state.uploadState === 'uploading' || state.uploadState === 'indexing',
    isUploadSuccess: state.uploadState === 'success',
    uploadError: state.uploadError,
    pendingFile: state.pendingFile,        // { name, sizeMb } — captured before API call
    lastUploaded: state.lastUploaded,      // { documentId, filename, chunksStored } — from backend

    // Actions
    uploadDocument,
    clearError,
  };
}
