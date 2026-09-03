# Phase 1 Changelog — Architecture & Git Stabilization

**Project:** SovereignAI Workbench  
**Phase:** Phase 1  
**Date:** September 3, 2026  

---

### 1. `git branch -f main recover-frontend-backend`
- **File / Entity:** Git branch reference `main`
- **Change:** Fast-forwarded local `main` branch pointer from stale commit `9d756af` to `9cc47ca` (`recover-frontend-backend`).
- **Reason:** `main` was a direct ancestor lacking 14 production commits. Merging/fast-forwarding reconciles the branches without conflict.
- **Risk:** None. Fast-forward only; no history rewritten.
- **Backward Compatibility:** 100% preserved.

---

### 2. `frontend/src/state/documentState.jsx`
- **File:** `frontend/src/state/documentState.jsx`
- **Change:** Removed `import { mockDocuments } from '../data/mockData.js'` and initialized `initialState.documents` with `[]`.
- **Reason:** Documents are dynamically fetched from the PostgreSQL backend via `useDocuments()`. Initializing from a mock file was dead code.
- **Risk:** None.
- **Backward Compatibility:** 100% preserved.

---

### 3. `frontend/src/data/mockData.js`
- **File:** `frontend/src/data/mockData.js`
- **Change:** Removed dead file and deleted the empty `frontend/src/data` folder.
- **Reason:** File was not imported by any operational page or component.
- **Risk:** None. Verified via global search and full production build.
- **Backward Compatibility:** 100% preserved.

---

### 4. `backend/src/routes/files.routes.js`
- **File:** `backend/src/routes/files.routes.js`
- **Change:** Annotated `POST /api/v1/upload` as `@deprecated` and documented `POST /api/v1/inspection/upload` as the canonical upload endpoint.
- **Reason:** Resolved duplication confusion discovered during audit while keeping both endpoints operational.
- **Risk:** None. Both routes remain active and share the same handler.
- **Backward Compatibility:** 100% preserved.

---

### 5. `backend/src/orchestration/inspection/inspection.adapters.js`
- **File:** `backend/src/orchestration/inspection/inspection.adapters.js`
- **Change:** Added `process.env.SOP_SCORE_THRESHOLD ? parseFloat(process.env.SOP_SCORE_THRESHOLD) : 0.35` as the default score threshold for `runSopRetrieval`.
- **Reason:** Prevents legitimate matching SOP evidence from being prematurely dropped when LLM-extracted finding text produces cosine similarity scores between 0.35 and 0.40.
- **Risk:** Low. Retains anti-hallucination boundary while improving robustness across local model phrasing variances.
- **Backward Compatibility:** 100% preserved.

---

### 6. `.env.example`
- **File:** `.env.example`
- **Change:** Added explicit declarations for `AGENT_ORCHESTRATOR=langgraph` and `INSPECTION_ORCHESTRATOR=langgraph`.
- **Reason:** Clarifies the orchestrator feature flags and documents the available options.
- **Risk:** None. Default was already `"langgraph"` in code.
- **Backward Compatibility:** 100% preserved.

---

### 7. `README.md`
- **File:** `README.md`
- **Change:** Updated frontend architecture directory tree to remove reference to `mockData.js` and list live inspection/agent execution hooks.
- **Reason:** Documentation accuracy.
- **Risk:** None.
- **Backward Compatibility:** 100% preserved.
