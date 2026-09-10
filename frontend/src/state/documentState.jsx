/**
 * STATE LAYER — documentState.jsx
 *
 * Documents state:
 * - documents list
 * - selected document
 * - upload state
 */

import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';

const initialState = {
  documents: [],
  selectedDocument: null,
  // 'idle' | 'uploading' | 'indexing' | 'success' | 'error'
  uploadState: 'idle',
  uploadError: null,
  pendingFile: null,      // { name, sizeMb } captured before upload
  lastUploaded: null,     // { documentId, filename, chunksStored } from backend
};

function documentReducer(state, action) {
  switch (action.type) {
    case 'SET_DOCUMENTS': {
      const backendDocs = action.payload || [];
      const mapped = backendDocs.map((doc) => {
        const canonical = (doc.documentType || doc.document_type || 'inspection').toLowerCase();
        return {
          id: doc.documentId || doc.id,
          documentId: doc.documentId || doc.id,
          filename: doc.originalFilename || doc.filename,
          originalFilename: doc.originalFilename || doc.filename,
          documentType: canonical,
          type: canonical === 'sop' ? 'SOP' : (canonical === 'inspection' ? 'Inspection' : 'Other'),
          pages: doc.pages || doc.pageCount || null,
          status: doc.status || 'Indexed',
          extractionMethod: doc.extractionMethod || doc.extraction_method || 'pdf-text',
          uploadedAt: doc.createdAt || doc.created_at || doc.uploadedAt || new Date().toISOString(),
          chunksStored: doc.chunksStored !== undefined ? doc.chunksStored : (doc.chunks_stored !== undefined ? doc.chunks_stored : 0),
        };
      });
      return { ...state, documents: mapped };
    }
    case 'SELECT_DOCUMENT':
      return { ...state, selectedDocument: action.payload };
    case 'CLEAR_SELECTION':
      return { ...state, selectedDocument: null };
    case 'UPLOAD_START':
      return {
        ...state,
        uploadState: 'uploading',
        uploadError: null,
        lastUploaded: null,
        pendingFile: action.payload || null,
      };
    case 'UPLOAD_INDEXING':
      return { ...state, uploadState: 'indexing' };
    case 'UPLOAD_SUCCESS': {
      const newDoc = action.payload;
      const docId = newDoc.documentId || newDoc.id;
      const displayFilename = newDoc.originalFilename || newDoc.filename;
      const rawDocType = newDoc.documentType || newDoc.document_type || state.pendingFile?.documentType || 'inspection';
      const docType = (rawDocType || 'inspection').toLowerCase();
      // Prepend real document; remove any entry with same id or filename
      const filtered = (state.documents || []).filter(
        (d) => d.id !== docId && d.documentId !== docId && d.filename !== displayFilename
      );
      return {
        ...state,
        uploadState: 'success',
        lastUploaded: {
          documentId: docId,
          filename: displayFilename,
          chunksStored: newDoc.chunksStored,
          documentType: docType,
        },
        documents: [
          {
            id: docId,
            documentId: docId,
            filename: displayFilename,
            originalFilename: newDoc.originalFilename,
            documentType: docType,
            type: docType === 'sop' ? 'SOP' : (docType === 'inspection' ? 'Inspection' : 'Other'),
            pages: null,
            status: newDoc.status || 'Indexed',
            extractionMethod: newDoc.extractionMethod || 'pdf-text',
            uploadedAt: newDoc.createdAt || new Date().toISOString(),
            sizeMb: state.pendingFile?.sizeMb || null,
            chunksStored: newDoc.chunksStored || 0,
          },
          ...filtered,
        ],
      };
    }
    case 'UPLOAD_ERROR':
      return { ...state, uploadState: 'error', uploadError: action.payload };
    case 'UPLOAD_RESET':
      return {
        ...state,
        uploadState: 'idle',
        uploadError: null,
        pendingFile: null,
        lastUploaded: null,
      };
    default:
      return state;
  }
}

const DocumentStateContext = createContext(null);
const DocumentDispatchContext = createContext(null);

export function DocumentStateProvider({ children }) {
  const [state, dispatch] = useReducer(documentReducer, initialState);
  return (
    <DocumentStateContext.Provider value={state}>
      <DocumentDispatchContext.Provider value={dispatch}>
        {children}
      </DocumentDispatchContext.Provider>
    </DocumentStateContext.Provider>
  );
}

export function useDocumentState() {
  const ctx = useContext(DocumentStateContext);
  if (!ctx) throw new Error('useDocumentState must be used within DocumentStateProvider');
  return ctx;
}

export function useDocumentDispatch() {
  const ctx = useContext(DocumentDispatchContext);
  if (!ctx) throw new Error('useDocumentDispatch must be used within DocumentStateProvider');
  return ctx;
}

export function useDocumentActions() {
  const dispatch = useDocumentDispatch();
  return useMemo(
    () => ({
      setDocuments: (docs) => dispatch({ type: 'SET_DOCUMENTS', payload: docs }),
      selectDocument: (doc) => dispatch({ type: 'SELECT_DOCUMENT', payload: doc }),
      clearSelection: () => dispatch({ type: 'CLEAR_SELECTION' }),
      uploadStart: (pendingFile) => dispatch({ type: 'UPLOAD_START', payload: pendingFile }),
      uploadIndexing: () => dispatch({ type: 'UPLOAD_INDEXING' }),
      uploadSuccess: (doc) => dispatch({ type: 'UPLOAD_SUCCESS', payload: doc }),
      uploadError: (err) => dispatch({ type: 'UPLOAD_ERROR', payload: err }),
      uploadReset: () => dispatch({ type: 'UPLOAD_RESET' }),
    }),
    [dispatch],
  );
}
