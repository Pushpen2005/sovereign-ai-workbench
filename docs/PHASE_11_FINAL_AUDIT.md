# SovereignAI — Phase 11 Final System Audit

**Date:** September 3, 2026  
**Auditor:** SovereignAI Final Engineering & Hardening Team  
**System Status:** Pre-Demo Hardened & Production Verified  

---

## 1. System Architecture Overview

SovereignAI is an on-premise industrial AI workbench engineered for confidential industrial workloads (e.g., refinery maintenance, rotating equipment NDT inspection, and statutory SOP verification).

```text
                                 Client Browser
                      (React 19 / Vite 8 / TailwindCSS v4)
                                       │
                                       ▼
                             NGINX (Port 5173:80)
                                       │
                                       ▼
                       Express Backend Gateway (Port 9000)
                     ├── LangGraph Inspection StateGraph
                     ├── LangGraph Autonomous Tool StateGraph
                     ├── SSE Event Broker (ExecutionEventsService)
                     ├── Multi-Tenant Resolution & Authorization
                     └── Docker-in-Docker Coding Sandbox
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
     PostgreSQL 16               Qdrant Vector DB            AI Microservice
     (Port 5433:5432)            (Port 6333:6333)            (Port 5001:5001)
     - documents                 - 30,969 vectors            - Xenova ONNX MiniLM
     - reports                   - Cosine distance           - Tesseract OCR (5.x)
     - agent_runs                - persistent storage        - python-docx
     - agent_run_steps                                            │
     - conversations                                              ▼
     - messages                                         Host Ollama Runtime
                                                        (llama3.2:3b via Metal GPU)
```

---

## 2. Service Inventory

1. **`sovereign-ai-frontend`:** Pre-built React 19 SPA served via NGINX Alpine with client-side routing and authenticated SSE reader.
2. **`sovereign-ai-backend`:** Node 22 runtime hosting REST APIs, LangGraph StateGraph runners, and database pools.
3. **`sovereign-ai-service`:** Auxiliary embedding and OCR service hosting Xenova ONNX models locally.
4. **`sovereign-ai-postgres`:** PostgreSQL 16 relational store preserving documents, reports, conversations, and agent runs across restarts (`postgres_data`).
5. **`sovereign-ai-qdrant`:** Vector search engine managing 30,969 dense embeddings on persistent disk (`qdrant_storage`).
6. **`sovereign-ai-ollama`:** Local LLM service; host-bridged (`host.docker.internal:11434`) for Metal acceleration of `llama3.2:3b`.

---

## 3. Frontend & Backend Routes

### Frontend Routes
- `/`: Public landing page with architecture highlights and entry CTA.
- `/dashboard`: High-level operational telemetry, cluster health, and recent activities.
- `/documents`: Document upload, parsing status, chunk review, and vector indexing.
- `/chat`: Evidence-grounded conversational search over indexed documents with verbatim citations.
- `/agent`: Flagship Autonomous Agent Workspace with live SSE telemetry and persistent execution history.
- `/inspection`: Dedicated Inspection Agent Workspace for industrial report analysis, SOP matching, and Approval Note DOCX downloads.
- `/reports`: Approval Note repository and direct DOCX downloads.
- `/coding`: Isolated Python execution sandbox with resource bounds.
- `/vision`: Multimodal engineering defect image analysis.
- `/security`: Security and data sovereignty governance dashboard with real-time audit manifest.

### Core Backend APIs
- `POST /api/v1/inspection/workflow`: End-to-end LangGraph inspection workflow.
- `GET /api/v1/inspection/runs/:runId/stream`: Server-Sent Events stream for inspection runs.
- `GET /api/v1/inspection/download/:filename`: Direct binary download of Approval Note DOCX.
- `POST /api/v1/agent/run`: LangGraph autonomous tool execution.
- `GET /api/v1/agent/runs`: Paginated historical agent runs from PostgreSQL.
- `GET /api/v1/agent/runs/:runId`: Detailed run summary.
- `GET /api/v1/agent/runs/:runId/steps`: Detailed chronological step trace.
- `GET /api/v1/agent/runs/:runId/stream`: Server-Sent Events stream for autonomous agent.
- `POST /api/v1/chat/ask`: RAG query with vector search and anti-hallucination citations.
- `POST /api/v1/coding/execute`: Sandboxed Python execution.
- `GET /api/v1/sovereignty`: Live audit manifest confirming zero external cloud AI dependencies.
- `GET /api/v1/health`: Cluster healthcheck.

---

## 4. AI Capabilities & Guardrails

1. **Deterministic Structured Findings:** Extracts equipment, observed value, operating limits, severity, and verbatim evidence quotes.
2. **Bounded Retry on Schema Validation:** Extraction attempts are capped at `maxExtractionAttempts = 2` to prevent runaway LLM loops.
3. **Grounded SOP Retrieval:** Qdrant similarity search matches findings against internal maintenance and safety guidelines.
4. **Safe Failure on Insufficient Evidence:** If no relevant SOP is found, the system halts with `INSUFFICIENT_EVIDENCE` and alerts the user instead of fabricating risk recommendations.
5. **Anti-Hallucination Citation Validation:** Citations are verified against verbatim text; fabricated citations are discarded.
6. **Isolated Sandbox:** Code executes inside ephemeral containers with `--network none`, `--memory 256m`, and `--cpus 1`.

---

## 5. Existing Test Coverage

18 automated test suites exist in `backend/tests/` covering:
- `inspection.graph.test.js`: 36 unit tests for StateGraph stages and edge transitions.
- `inspection.migration.test.js`: 15 integration tests ensuring LangGraph produces identical schemas to legacy workflows.
- `agent.graph.test.js`: 46 tests for tool calling, reasoning, validation, and safe failure.
- `agent.persistence.test.js`: 33 tests verifying PostgreSQL tenant isolation and state durability.
- `sse.test.js` & `sse.live.test.js`: 27 tests verifying SSE protocols, Last-Event-ID, and secret sanitization.
- `sandbox.test.js`: 7 tests verifying Docker container isolation and resource bounds.
- `router.test.js`: 14 tests verifying dynamic task classification and local model routing.
- `chat.test.js`, `documents.test.js`, `reports.test.js`, `vision.test.js`, and `backend.e2e.test.js`.
