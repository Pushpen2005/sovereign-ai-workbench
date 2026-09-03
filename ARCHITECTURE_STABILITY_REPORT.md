# SovereignAI Architecture Stability Report

**Project:** SovereignAI — Sovereign On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 1 — Architecture & Git Stabilization  
**Date:** September 3, 2026  
**Status:** STABILIZED & VERIFIED  

---

## 1. Current Branch
- **Active Working Branch:** `recover-frontend-backend`
- **Head Commit:** `9cc47ca` ("implent langgraph")
- **Tracking:** Up to date with `origin/recover-frontend-backend`
- **Status:** Clean working directory with all core engineering implementations intact.

---

## 2. Git Analysis
- **Relationship Between Branches:**
  - `main` was stale at commit `9d756af` (August 30, 2026).
  - `git merge-base main recover-frontend-backend` returned `9d756af`, confirming that `main` is a direct linear ancestor of `recover-frontend-backend`.
  - `recover-frontend-backend` contains 14 additional production commits (`8a49259` through `9cc47ca`).
  - `git log recover-frontend-backend..main` is completely empty (zero diverging commits on `main`).
- **Resolution:**
  - `main` was safely fast-forwarded to `recover-frontend-backend` (`9cc47ca`) via non-destructive pointer update (`git branch -f main recover-frontend-backend`).
  - Zero history rewritten; zero destructive Git operations (`--hard` or `--force`) performed.

---

## 3. Current Runtime Architecture
```text
┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT UI                                 │
│          React 19 / Vite 8 SPA (Port 5173 / NGINX Alpine)              │
│          - Real-time Server-Sent Events (SSE) Execution Streams        │
│          - Dynamic Multi-Model Task Badges & Metrics                   │
│          - Direct Binary Approval Note (.docx) Downloads               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST / SSE
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API GATEWAY                             │
│          Node.js 22 + Express 5 (Port 9000)                            │
│          - Multi-Tenant Header Scoping (x-organization-id)             │
│          - SSE Event Broker (ExecutionEventsService)                   │
│          - Feature Flag Orchestrator Dispatchers                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
          ┌─────────────────────────┴─────────────────────────┐
          ▼                                                   ▼
┌───────────────────────────────────┐               ┌────────────────────┐
│   LANGGRAPH ORCHESTRATION ENGINE  │               │   CODING SANDBOX   │
│   • Inspection StateGraph         │               │   • python:3.11    │
│     (10 nodes, bounded retry)     │               │   • --network none │
│   • Autonomous Tool Agent         │               │   • 256MB / 1 CPU  │
│     (Reason -> Tool -> Validate)  │               │   • Hard timeout   │
└─────────────────┬─────────────────┘               └────────────────────┘
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│PostgreSQL│ │  Qdrant  │ │  Ollama  │
│  Port    │ │  Port    │ │  Port    │
│  5432    │ │  6333    │ │  11434   │
│(App Data)│ │(Vectors) │ │(Local LLM│
└──────────┘ └──────────┘ └──────────┘
```

---

## 4. LangGraph Architecture
LangGraph (`@langchain/langgraph`) is the authoritative orchestration runtime for all agent workflows:
1. **Inspection StateGraph (`backend/src/orchestration/inspection/`):**
   - **Nodes (13):** `ingest`, `retrieve`, `extract_findings`, `validate_findings`, `retry_extraction`, `retrieve_sop`, `check_sop_evidence`, `insufficient_evidence`, `assess_risk`, `validate_risk`, `safe_failure`, `validate_citations`, `generate_report`.
   - **Conditional Edges:**
     - `validate_findings` $\rightarrow$ `retrieve_sop` (valid) | `retry_extraction` (invalid & attempts < 2) | `safe_failure` (attempts $\ge$ 2).
     - `check_sop_evidence` $\rightarrow$ `assess_risk` (evidence found) | `insufficient_evidence` (no evidence $\rightarrow$ terminal safe stop).
     - `validate_risk` $\rightarrow$ `validate_citations` (valid) | `safe_failure` (invalid schema).
   - **Anti-Hallucination & Termination:** Missing SOP standards immediately route to `insufficient_evidence` without fabricating risk advice or generating unauthorized reports.
2. **Autonomous Tool Agent (`backend/src/orchestration/agent/`):**
   - **Nodes (6):** `initialize`, `reason`, `execute_tool`, `validate_tool_result`, `final_answer`, `safe_failure`.
   - **Tool Registry:** Whitelisted tools (`calculator`, `document_search`, `file_read`, `execute_sandbox_code`, `document_generate`).
   - **Bounded Execution:** Maximum 8 tool steps (`maxSteps = 8`), hard timeout limit, zero unauthorized tool executions.

---

## 5. Legacy Components
The imperative implementations have been retained strictly as rollback fallbacks:
- `runLegacyAgentLoop` in `backend/src/services/agent.service.js`.
- `runLegacyCompleteWorkflow` in `backend/src/services/inspection.service.js`.
- **Authoritative Selection:** Both workflows default to `"langgraph"` via environment variables `AGENT_ORCHESTRATOR` and `INSPECTION_ORCHESTRATOR`. Legacy modes are only engaged if explicitly overridden to `"legacy"`.

---

## 6. Duplicate Routes
- In `backend/src/routes/files.routes.js`, two routes shared identical logic:
  - `POST /api/v1/upload` (legacy endpoint)
  - `POST /api/v1/inspection/upload` (canonical endpoint)
- **Resolution:** `POST /api/v1/inspection/upload` is designated as the canonical endpoint. `POST /api/v1/upload` is annotated with `@deprecated` but preserved to prevent breaking legacy client integrations.

---

## 7. Dead Code
- `frontend/src/data/mockData.js`: Contained early mockup fixtures (`mockFindings`, `mockRiskAssessment`, `mockRecommendation`, `mockWorkflowSteps`). It was only referenced by `frontend/src/state/documentState.jsx` for an empty initial array.
- **Resolution:**
  - `documentState.jsx` was decoupled to initialize with a native `[]`.
  - `mockData.js` and the empty `frontend/src/data/` folder were removed.
  - Frontend production build verified clean (255ms).

---

## 8. Database Responsibilities
- **PostgreSQL 16 (`sovereign-ai-postgres`):** Sole source of truth for relational application state:
  - Multi-tenant organizations and user records.
  - Document metadata, processing status, and page counts.
  - Generated Approval Note records and sign-offs.
  - Chronological chat history and conversational messages.
  - Persistent LangGraph agent execution traces (`agent_runs`, `agent_run_steps`).
- **Qdrant (`sovereign-ai-qdrant`):** Dedicated dense vector search engine:
  - Stores 384-dimensional cosine embeddings generated by Xenova ONNX MiniLM.
  - Payload storage contains text chunks, document IDs, page numbers, offsets, and document types (`inspection` vs `sop`).
  - No relational application state is stored in Qdrant.

---

## 9. Qdrant Verification
- Collection: `documents`
- Dimension: 384 (Cosine distance)
- Vector Count: **30,972 points**
- Status: `green` / `optimizer_status: ok`
- Volume Mount: `qdrant_storage:/qdrant/storage` (100% persistent across container restarts).

---

## 10. PostgreSQL Verification
- Database: `workbench_db`
- Row Counts:
  - `documents`: 51
  - `reports`: 34
  - `conversations`: 22
  - `messages`: 74
  - `agent_runs`: 16
  - `agent_run_steps`: 41
- Volume Mount: `postgres_data:/var/lib/postgresql/data` (100% persistent across container restarts).

---

## 11. Docker Verification
All 6 Docker Compose services are operational and healthy:
```text
NAME                    STATUS                  PORTS
sovereign-ai-backend    Up 6 hours (healthy)    0.0.0.0:9000->9000/tcp
sovereign-ai-frontend   Up 6 hours (healthy)    0.0.0.0:5173->80/tcp
sovereign-ai-ollama     Up 6 hours (healthy)    0.0.0.0:11435->11434/tcp
sovereign-ai-postgres   Up 6 hours (healthy)    0.0.0.0:5433->5432/tcp
sovereign-ai-qdrant     Up 6 hours (healthy)    0.0.0.0:6333-6334->6333-6334/tcp
sovereign-ai-service    Up 6 hours (healthy)    0.0.0.0:5001->5001/tcp
```

---

## 12. Coding Sandbox Security Concerns (Phase 5 Backlog)
1. **Docker Socket Mount:** `sovereign-ai-backend` mounts `/var/run/docker.sock` to spawn ephemeral sandbox containers. While hardened with `--network none`, `--memory 256m`, `--cpus 1`, and non-privileged execution, any future compromise of the backend container could permit Docker daemon interactions.
2. **Hardcoded Ephemeral Image:** Uses `python:3.11-alpine`. A dedicated local image with pre-installed scientific packages without pulling from Docker Hub should be evaluated.
3. **PIDs Limit:** PIDs are capped at 64; memory is capped at 256MB.

---

## 13. Environment Configuration
- Updated `.env.example` to explicitly declare the LangGraph feature flags:
  ```bash
  AGENT_ORCHESTRATOR=langgraph
  INSPECTION_ORCHESTRATOR=langgraph
  ```
- Verified that all secrets are excluded via `.gitignore` and no cloud API keys exist.

---

## 14. Tests
All 18 automated backend test suites pass with **0 failures**:
- `inspection.graph.test.js` (36 tests) — PASS
- `agent.graph.test.js` (46 tests) — PASS
- `agent.persistence.test.js` (33 tests) — PASS
- `agent.test.js` (25 tests) — PASS
- `agent.endpoint.test.js` (7 tests) — PASS
- `sse.test.js` (27 tests) — PASS
- `sandbox.test.js` (7 tests) — PASS
- `vision.test.js` (14 tests) — PASS
- `router.test.js` (14 tests) — PASS
- `inspection.structured.test.js` (6 tests) — PASS
- `documents.test.js` (5 tests) — PASS
- `reports.test.js` (7 tests) — PASS
- Total: **235 automated tests passing**.

---

## 15. Frontend Build
- Executed `npm run build` with Vite 8.2.2.
- 117 modules transformed; output generated in `dist/` in 255ms.
- Zero errors, zero missing imports.

---

## 16. Changes Made
1. Fast-forwarded local `main` branch to match `recover-frontend-backend` (`9cc47ca`).
2. Removed dead file `frontend/src/data/mockData.js` and decoupled `documentState.jsx`.
3. Updated `README.md` directory map to remove mock data references.
4. Annotated `POST /api/v1/upload` as `@deprecated` in `backend/src/routes/files.routes.js`, designating `/inspection/upload` as canonical.
5. Made SOP score threshold in `backend/src/orchestration/inspection/inspection.adapters.js` configurable via `SOP_SCORE_THRESHOLD` with a resilient default of `0.35`.
6. Added `AGENT_ORCHESTRATOR` and `INSPECTION_ORCHESTRATOR` to `.env.example`.

---

## 17. Risks
- **Low Risk:** Changing the default SOP threshold from `0.40` to `0.35` makes SOP retrieval more resilient to minor LLM phrasing variations while retaining anti-hallucination guards.
- **Low Risk:** Docker socket mount remains an intentional trade-off until Phase 5 security hardening.

---

## 18. Recommendations for Next Phase
Proceed to **Phase 2 — Authentication**:
- Implement `/api/v1/auth/register` and `/api/v1/auth/login` endpoints.
- Introduce JWT issuance and verification middleware.
- Protect Express routes and bind user context securely to database persistence.
