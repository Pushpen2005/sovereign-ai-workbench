# SovereignAI — Phase 8 Frontend Audit

**Date:** September 3, 2026  
**Audited Directory:** `frontend/`  
**Purpose:** Comprehensive baseline audit of the frontend before implementing the Phase 8 Agent Workspace and SSE streaming client.

---

## 1. Current Frontend Stack

- **Framework:** React 19.2.8 (`react`, `react-dom`)
- **Router:** React Router DOM 7.18.3 (`react-router-dom`)
- **Build Tool:** Vite 8.2.2 with `@vitejs/plugin-react` (6.1.0)
- **Styling:** TailwindCSS v4 with `@tailwindcss/vite` (4.3.3)
- **HTTP Client:** Axios 1.20.0
- **Linter:** Oxlint 1.79.0
- **Development Server:** Vite running on port 5173 with proxy / base URL configuration (`http://localhost:9000`)

---

## 2. Current Routes & Navigation

Defined in [`frontend/src/routes/routes.jsx`](file:///Users/pushpentiwari/sovereign-ai-workbench/frontend/src/routes/routes.jsx):

- `/` $\rightarrow$ `LandingPage` (Public overview)
- `/dashboard` $\rightarrow$ `DashboardPage` (System overview, cluster stats, operational status)
- `/documents` $\rightarrow$ `DocumentsPage` (PDF ingestion, chunk preview, Qdrant vectors)
- `/chat` $\rightarrow$ `ChatPage` (Evidence-grounded RAG query interface)
- `/coding` $\rightarrow$ `CodingPage` (Isolated Python sandbox execution)
- `/vision` $\rightarrow$ `VisionPage` (Multimodal industrial image defect analysis)
- `/agent` $\rightarrow$ `AgentPage` (Inspection Pipeline & Autonomous Tool Agent)
- `/reports` $\rightarrow$ `ReportsPage` (Approval Note listing and DOCX downloads)
- `/security` $\rightarrow$ `SecurityPage` (Tenant isolation and compliance audit logs)

Sidebar navigation is handled in [`frontend/src/components/layout/Sidebar.jsx`](file:///Users/pushpentiwari/sovereign-ai-workbench/frontend/src/components/layout/Sidebar.jsx).

---

## 3. Existing API Abstraction

Located in [`frontend/src/api/`](file:///Users/pushpentiwari/sovereign-ai-workbench/frontend/src/api/):
- **Core HTTP Client:** [`client.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/frontend/src/api/client.js) exports:
  - `API_BASE_URL` (`import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000'`)
  - Normalized `ApiError` class catching server non-2xx responses and network failures.
  - Helper functions: `get(path)`, `post(path, body)`, `postForm(path, formData)`.
- **Domain API Modules:**
  - `agent.api.js`: `runAgent(goal, options)` $\rightarrow$ `POST /api/v1/agent/run`
  - `inspection.api.js`: `runWorkflow(input, task)` $\rightarrow$ `POST /api/v1/inspection/workflow`, `downloadApprovalNote(filename)` $\rightarrow$ `GET /api/v1/inspection/download/:filename`
  - `chat.api.js`: Conversation and message persistence APIs
  - `documents.api.js`: Document ingestion and indexing APIs
  - `reports.api.js`: Approval Note reports APIs

---

## 4. Authentication Mechanism & Tenant Scoping

- **Authentication Strategy:** The current workbench is deployed as an on-premise industrial appliance with organization context.
- **Tenant Header:** The backend utilizes `resolveOrganizationId(req)` which extracts the tenant from `x-organization-id` headers (or falls back to `DEFAULT_ORGANIZATION_ID`).
- **SSE Authentication Constraint:**
  - Standard browser `EventSource` cannot set custom HTTP headers (such as `x-organization-id` or `Authorization: Bearer <token>`).
  - Passing authentication tokens or tenant IDs in URL query parameters (`?token=...`) is an insecure anti-pattern that leaks credentials in access logs and proxies.
  - **Resolution:** We implement a custom `fetch()` + `ReadableStream` SSE reader in [`frontend/src/services/sseClient.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/frontend/src/services/sseClient.js). This allows passing any custom headers (`x-organization-id`, `Authorization`), supports `AbortController` cancellation, and handles chunked SSE parsing (`event:`, `data:`, `id:`, `: heartbeat`).

---

## 5. Existing Relevant Components & Design System

- **UI Primitives:**
  - `Button.jsx`: Supports `primary`, `secondary`, `danger`, `ghost` variants.
  - `Card.jsx`: Consistent slate border, elevation, and rounded padding.
  - `Badge.jsx`: `StatusBadge` for severity (`HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT EVIDENCE`) and execution state.
  - `FeedbackStates.jsx`: `LoadingState`, `EmptyState`, `ErrorState`.
  - `StatusIndicator.jsx`: Visual cluster status badges.
- **Layout Primitives:**
  - `AppLayout.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `PageHeader.jsx`.
- **State Management:**
  - React standard hooks (`useState`, `useEffect`, `useCallback`, `useRef`).
  - Contexts: `AppStateContext` (`appState.jsx`), `DocumentStateContext` (`documentState.jsx`).

---

## 6. Location for Agent Workspace & Inspection Agent Workspace

1. **Autonomous Tool Agent Workspace:**
   - URL: `/agent` (or `/agent?mode=autonomous`)
   - Components in: `src/pages/Agent/AutonomousAgentWorkspace.jsx`
   - Real-time tool loop timeline (initialize $\rightarrow$ reason $\rightarrow$ execute_tool $\rightarrow$ validate $\rightarrow$ final_answer / safe_failure).
   - Historical runs sidebar powered by `GET /api/v1/agent/runs`.
2. **Inspection Agent Workspace:**
   - URL: `/inspection` and `/agent` (supporting seamless tab switcher in `/agent` as well as dedicated `/inspection` route).
   - Components in: `src/pages/Inspection/InspectionAgentWorkspace.jsx`
   - Real-time pipeline timeline driven by SSE (`ingest` $\rightarrow$ `retrieve` $\rightarrow$ `extract_findings` $\rightarrow$ `validate_findings` $\rightarrow$ `retrieve_sop` $\rightarrow$ `check_sop_evidence` $\rightarrow$ `assess_risk` $\rightarrow$ `validate_citations` $\rightarrow$ `generate_report`).
   - Grounded findings, verbatim evidence quotes, SOP evidence, risk assessment, and direct DOCX Approval Note download.

---

## 7. SSE Client Implementation Plan

The client utility in `src/services/sseClient.js` will:
- Connect to `/api/v1/agent/runs/:runId/stream` or `/api/v1/inspection/runs/:runId/stream` via `fetch()`.
- Inject `x-organization-id` (and `Authorization` if present).
- Read chunks with `ReadableStreamDefaultReader` and parse `id`, `event`, `data`, and `: heartbeat`.
- Invoke callbacks: `onEvent(event)`, `onError(error)`, `onClose()`.
- Return an abort function to cleanly close stream on component unmount.
- Support historical replay and `Last-Event-ID` resume.
