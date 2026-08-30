/**
 * STATE LAYER — documentState.jsx
 *
 * Documents state:
 * - documents list
 * - selected document
 * - upload state
 */

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { mockDocuments } from '../data/mockData.js';

const initialState = {
  documents: mockDocuments,
  selectedDocument: null,
  // 'idle' | 'uploading' | 'indexing' | 'success' | 'error'
  uploadState: 'idle',
  uploadError: null,
  pendingFile: null,      // { name, sizeMb } captured before upload
  lastUploaded: null,     // { documentId, filename, chunksStored } from backend
};

function documentReducer(state, action) {
  switch (action.type) {
    case 'SET_DOCUMENTS':
      return { ...state, documents: action.payload };
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
      return {
        ...state,
        uploadState: 'success',
        lastUploaded: {
          documentId: newDoc.documentId,
          filename: newDoc.filename,
          chunksStored: newDoc.chunksStored,
        },
        // Prepend real document; remove any mock entry with same filename
        documents: [
          {
            id: newDoc.documentId,
            filename: newDoc.filename,
            type: 'Inspection',
            pages: null,
            status: 'Indexed',
            uploadedAt: new Date().toISOString(),
            sizeMb: state.pendingFile?.sizeMb || null,
            chunksStored: newDoc.chunksStored,
            documentId: newDoc.documentId,
          },
          ...state.documents,
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
  return {
    selectDocument: useCallback(
      (doc) => dispatch({ type: 'SELECT_DOCUMENT', payload: doc }),
      [dispatch],
    ),
    clearSelection: useCallback(() => dispatch({ type: 'CLEAR_SELECTION' }), [dispatch]),
    uploadStart: useCallback(
      (pendingFile) => dispatch({ type: 'UPLOAD_START', payload: pendingFile }),
      [dispatch],
    ),
    uploadIndexing: useCallback(() => dispatch({ type: 'UPLOAD_INDEXING' }), [dispatch]),
    uploadSuccess: useCallback(
      (doc) => dispatch({ type: 'UPLOAD_SUCCESS', payload: doc }),
      [dispatch],
    ),
    uploadError: useCallback(
      (err) => dispatch({ type: 'UPLOAD_ERROR', payload: err }),
      [dispatch],
    ),
    uploadReset: useCallback(() => dispatch({ type: 'UPLOAD_RESET' }), [dispatch]),
  };
}
