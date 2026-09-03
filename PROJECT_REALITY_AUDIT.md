# SovereignAI — Project Reality Audit

**Project:** SovereignAI — Sovereign On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Audit Date:** September 3, 2026  
**Auditor:** Antigravity Advanced Agentic AI  
**Branch Audited:** `recover-frontend-backend`  

---

## 1. Executive Summary

This document establishes the empirical, code-level reality of the SovereignAI codebase. Every capability was evaluated against active source code, dependencies, running containers, and automated test suites. Documentation claims were independently cross-referenced against the actual runtime.

### High-Level Verdict:
- **Core MRPL Inspection & RAG:** **COMPLETE & TESTED**. End-to-end PDF parsing, OCR fallback, 384D dense vector search, LangGraph StateGraph orchestration, structured findings extraction with verbatim evidence, risk assessment, and Approval Note DOCX generation are fully implemented and verified.
- **Autonomous Agent & Sandbox:** **COMPLETE & TESTED**. LangGraph autonomous tool loop, tool registry (`calculator`, `document_search`, `file_read`, `document_generate`), PostgreSQL persistence, real-time SSE streaming, and isolated Docker coding sandbox (`--network none`) are fully implemented and passing tests.
- **Security & Sovereignty:** **COMPLETE & TESTED**. Zero external cloud AI APIs, local Ollama runtime, self-hosted Qdrant with 30,969 vectors, and persistent PostgreSQL storage.
- **Bonus / External Integrations:**
  - **Authentication:** **PARTIAL**. Relational database tables (`organizations`, `users`) and tenant header resolution exist, but there are no REST authentication routes (login/register) or JWT issuance middlewares.
  - **MCP (Model Context Protocol):** **NOT IMPLEMENTED**. Mentioned in documentation/roadmap; tools currently execute via internal Node.js modules.
  - **PPT / Excel Generation:** **NOT IMPLEMENTED**. Only Word `.docx` Approval Notes and PDF reports are supported.

---

## 2. Feature Reality Matrix

| Feature | Exists in Code | Verified Tested | Current Status | Implementation & Architectural Evidence | Missing Work / Gaps |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **PDF Extraction** | Yes | Yes | **COMPLETE** | `ai-service/extraction/pdf.service.js` uses `pdfjs-dist` with page-by-page text parsing. Verified in `tests/documents.test.js`. | None. Fully functional. |
| **Page-Aware Chunking** | Yes | Yes | **COMPLETE** | `ai-service/chunking/chunk.service.js` splits text per page (1000 size, 200 overlap), tracking `page`, `pageStartOffset`, `pageEndOffset`. Verified in `tests/documents.test.js`. | None. |
| **384D Embeddings** | Yes | Yes | **COMPLETE** | `ai-service/embeddings/embedding.service.js` runs Xenova `@huggingface/transformers` (`all-MiniLM-L6-v2`) locally via ONNX. | None. 100% on-premise. |
| **Qdrant Persistence** | Yes | Yes | **COMPLETE** | Container `sovereign-ai-qdrant` mounted to `qdrant_storage:/qdrant/storage`. 30,969 points verified across container restarts. | None. Volume safety verified. |
| **Qdrant Retrieval** | Yes | Yes | **COMPLETE** | `ai-service/vectorstore/qdrant.service.js` executes cosine vector search with metadata filtering (`documentType`, `documentId`). | None. |
| **RAG Pipeline** | Yes | Yes | **COMPLETE** | `ai-service/rag/rag.service.js` and `backend/src/services/chat.service.js` orchestrate query embedding $\rightarrow$ Qdrant search $\rightarrow$ Ollama synthesis. Verified in `tests/chat.test.js`. | None. |
| **Local LLM (Ollama)** | Yes | Yes | **COMPLETE** | `ai-service/llm/llm.service.js` connects to Ollama (`llama3.2:3b`) via `host.docker.internal:11434`. Verified in all AI suites. | None. |
| **Citations Validation** | Yes | Yes | **COMPLETE** | `backend/src/orchestration/inspection/inspection.nodes.js` validates verbatim quote presence against raw chunk text; discards false citations. Verified in `tests/inspection.graph.test.js`. | None. Anti-hallucination active. |
| **Local OCR** | Yes | Yes | **COMPLETE** | `ai-service/extraction/ocr.service.js` spawns local `tesseract` binary when PDF text is empty or scanned. System package installed in Dockerfile. | None. |
| **Structured Findings** | Yes | Yes | **COMPLETE** | `ai-service/inspection/inspection.service.js` extracts JSON findings (`equipment`, `observedValue`, `limit`, `severity`, `evidence`). Verified in `tests/inspection.structured.test.js`. | None. |
| **SOP Ingestion** | Yes | Yes | **COMPLETE** | Documents marked with `documentType: 'sop'` are ingested into Qdrant collection `documents`. Verified in `tests/reports.test.js`. | None. |
| **SOP Filtered Retrieval** | Yes | Yes | **COMPLETE** | Inspection graph node `retrieve_sop` queries Qdrant with `must: [{ key: "documentType", match: { value: "sop" } }]`. | None. |
| **Risk Assessment** | Yes | Yes | **COMPLETE** | `ai-service/risk/risk.service.js` grades risk (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) against SOP limits. Verified in `tests/inspection.graph.test.js`. | None. |
| **Recommendations** | Yes | Yes | **COMPLETE** | Actionable maintenance instructions generated from matched SOP standard. Verified in `tests/inspection.graph.test.js`. | None. |
| **Approval Note DOCX** | Yes | Yes | **COMPLETE** | `ai-service/reports/generate_docx.py` and `approval-note.service.js` compile audit-ready `.docx` files via `python-docx`. Download verified via `GET /api/v1/inspection/download/:filename`. | None. |
| **PostgreSQL Docs Storage**| Yes | Yes | **COMPLETE** | `backend/src/config/db.js` manages `documents` table with organization isolation. Verified in `tests/documents.test.js`. | None. |
| **Chat Persistence** | Yes | Yes | **COMPLETE** | `conversations` and `messages` tables store history and citations. Verified in `tests/chat.test.js`. | None. |
| **Backend REST APIs** | Yes | Yes | **COMPLETE** | Express 5 application on port 9000 with clean route separation (`inspection`, `documents`, `chat`, `agent`, `coding`, `vision`, `reports`). | None. |
| **Frontend UI Workbench** | Yes | Yes | **COMPLETE** | React 19 + Vite 8 SPA with 10 operational pages. Built in 238ms (`vite build`) and passing `oxlint`. | None. |
| **Authentication** | Yes | Partial | **PARTIAL** | Database schema contains `users` and `organizations`. Multi-tenant requests resolve via `x-organization-id` header or fallback. BUT no login/register REST endpoints or JWT issuance middleware exist. | Implement JWT auth controller if user login flows are required for presentation. |
| **LangGraph Orchestration**| Yes | Yes | **COMPLETE** | `@langchain/langgraph` StateGraph powers both Inspection Agent (10 nodes, bounded retry) and Autonomous Agent (reason-tool loop). Verified in 82 graph tests. | None. Source of truth. |
| **Model Context Protocol (MCP)**| No | No | **NOT IMPLEMENTED** | Mentioned in early roadmap docs as potential future bridge. Internal Node.js tool registry (`toolRegistry.js`) is used instead. | Not needed for standalone demo; build only if external MCP clients must connect. |
| **Model Router** | Yes | Yes | **COMPLETE** | `ai-service/router/modelRouter.js` classifies task types (`DOCUMENT`, `CODING`, `VISION`, `GENERAL`) and dispatches models with fallback. Verified in `tests/router.test.js`. | None. |
| **Coding Sandbox** | Yes | Yes | **COMPLETE** | `backend/src/services/sandbox.service.js` executes Python code in ephemeral containers with `--network none`, `--memory 256m`, `--cpus 1`, and timeout kills. Verified in `tests/sandbox.test.js`. | None. |
| **Local Vision** | Yes | Yes | **COMPLETE** | `backend/src/controllers/vision.controller.js` parses uploaded image magic bytes, routes to local Ollama vision model, and extracts structured observations. Verified in `tests/vision.test.js`. | Requires pulling a vision model (`llava` or `llama3.2-vision`) into Ollama to run live inference. |
| **PPT Generation** | No | No | **NOT IMPLEMENTED** | No code or dependencies exist for PowerPoint `.pptx` generation. | Only `.docx` and `.pdf` are supported. |
| **Excel Generation** | No | No | **NOT IMPLEMENTED** | No code or dependencies (`xlsx`, `exceljs`) exist for spreadsheet generation. | Not implemented. |
| **Security Telemetry** | Yes | Yes | **COMPLETE** | `/api/v1/sovereignty` live audit manifest reports 0 external cloud AI keys and component reachability. Displayed visually in `/security`. | None. Defensible claims verified. |
| **Docker Compose** | Yes | Yes | **COMPLETE** | `docker-compose.yml` orchestrates all 6 services (`frontend`, `backend`, `ai-service`, `postgres`, `qdrant`, `ollama`) with healthchecks and persistent volumes. | None. |

---

## 3. Detailed Structural Audit

### 3.1 Git Repository & Branches
- **Active Working Branch:** `recover-frontend-backend` (all 11 engineering phases were completed on this branch).
- **Stale Branch:** `main` (last commit August 30, 2026; 6,970 files behind `recover-frontend-backend`).
- **Working Tree:** Clean, no uncommitted modifications.

### 3.2 Duplicate Implementations & Fallbacks
1. **Agent Loop:**
   - Active: `runAgentWorkflow` (`backend/src/services/agent-orchestrator.service.js`) via LangGraph StateGraph.
   - Duplicate/Fallback: `runLegacyAgentLoop` (`backend/src/services/agent.service.js`) via imperative while-loop. Controlled by `AGENT_ORCHESTRATOR=langgraph|legacy`.
2. **Inspection Workflow:**
   - Active: `runInspectionWorkflow` (`backend/src/services/inspection-orchestrator.service.js`) via LangGraph StateGraph.
   - Duplicate/Fallback: `runLegacyCompleteWorkflow` (`backend/src/services/inspection.service.js`) via promise chaining. Controlled by `INSPECTION_ORCHESTRATOR=langgraph|legacy`.
3. **Upload Routes:**
   - `POST /api/v1/upload` and `POST /api/v1/inspection/upload` in `backend/src/routes/files.routes.js` share the exact same controller logic.

### 3.3 Dead Code & Artifacts
- `frontend/src/data/mockData.js`: Contains early mockup data. Not imported by active operational pages.
- `generated/`: Contains test artifacts from past runs (`Approval_Note_Agent_2a6d1d8b.docx`, `Approval_Note_Migration_doc-migration-test-001.docx`).
- Root `package.json`: Contains only `"dependencies": { "canvas": "^3.2.3" }` and is not part of a formal npm workspace.

### 3.4 Architectural Inconsistencies
1. **Authentication vs. Multi-Tenancy:**
   - PostgreSQL defines full `organizations` and `users` tables with `password_hash`.
   - However, the backend exposes **no** `/api/v1/auth/login` or `/api/v1/auth/register` endpoints.
   - Tenant scoping operates via the `x-organization-id` HTTP request header, falling back to `DEFAULT_ORGANIZATION_ID` (`0bd5dba2-05e1-4f5c-9047-25843d338622`).
   - The frontend Landing Page "Login" button merely navigates directly to `/dashboard`.
2. **Docker Socket Exposure:**
   - `backend` mounts `/var/run/docker.sock` to spawn ephemeral sandbox containers. While necessary for isolated code execution without Kubernetes, mounting the Docker daemon into an application container is a standard security trade-off.

### 3.5 Environment Variables Audit
- `.env.example` is complete and synchronized with required service configurations.
- `VISION_MODEL` in `.env.example` defaults to `llava:latest`. Note: `llama3.2:3b` is the standard LLM installed on the host. If a vision query is submitted without pulling `llava` first, the system safely halts via a clean `RouterError`.

### 3.6 Automated Tests Health
- **Total Test Files:** 18
- **Total Passing Tests:** 235
- **Total Failing Tests:** 0
- **Broken Imports:** None.
- **Linter Errors:** 0.

---

## 4. Final Classification Summary

### 1. Verified Completed Features (Production & Demo Ready)
1. PDF text extraction with page tracking
2. Page-aware chunking (1000 chars, 200 overlap)
3. Local 384D ONNX embeddings (`all-MiniLM-L6-v2`)
4. Qdrant persistent vector indexing & search (30,969 points)
5. Evidence-grounded RAG with verbatim citations
6. Local Ollama LLM integration (`llama3.2:3b`)
7. Local Tesseract OCR fallback for scanned sheets
8. Industrial inspection findings structured extraction
9. SOP ingestion & filtered similarity retrieval
10. Equipment risk assessment against SOP limits
11. SOP-grounded maintenance recommendations
12. Approval Note Word `.docx` generation and download
13. PostgreSQL relational document & reports persistence
14. Conversational chat & message persistence
15. LangGraph Inspection StateGraph (10 nodes, bounded retry)
16. LangGraph Autonomous Tool Agent (reason $\rightarrow$ tool $\rightarrow$ validate $\rightarrow$ finalize)
17. Real-time Server-Sent Events (SSE) streaming
18. Docker coding sandbox with `--network none`
19. Dynamic Task Router & local model dispatching
20. Security & Sovereignty diagnostic dashboard (`/security`)
21. Multi-tenant data isolation via header resolution
22. Full Docker Compose 6-container deployment stack

### 2. Verified Incomplete / Partial Features
1. **Authentication:** Database schema exists and multi-tenant scoping functions via headers, but user login/registration endpoints, session state, and JWT tokens are not implemented.

### 3. Non-Existent / Not Implemented Features
1. **Model Context Protocol (MCP):** Not implemented; internal tool registry is used.
2. **PowerPoint (.pptx) Generation:** Not implemented.
3. **Excel (.xlsx) Generation:** Not implemented.

---

## 5. Recommended Implementation Order (If Further Enhancements Are Desired)

If continuing beyond the hackathon demo scope:
1. **Git Hygiene (Immediate):** Merge or fast-forward `recover-frontend-backend` into `main` so the primary repository branch reflects the complete application.
2. **Real User Authentication (Optional):** If user login forms are desired for judging, add `/api/v1/auth/login` and `/api/v1/auth/register` with `bcrypt` + `jsonwebtoken` and protect Express routes.
3. **MCP Tool Server (Future):** If external agent platforms need to call SovereignAI tools, expose an MCP standard JSON-RPC server over stdio or SSE.
4. **Office Format Extensions (Future):** Add `pptxgenjs` or `exceljs` if slide deck or spreadsheet deliverables are requested by MRPL.
