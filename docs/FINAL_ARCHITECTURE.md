# SovereignAI — Final System Architecture

**Document Version:** 1.0 (Final Pre-Demo Release)  
**Target Audience:** SIH Judges, Enterprise Architects, Security Evaluators  
**Scope:** Canonical System Architecture, Component Interfaces, and Data Flow Boundaries  

---

## 1. Canonical System Architecture

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT LAYER                                         │
│                                                                                        │
│               Industrial Analyst / Asset Reliability Engineer                          │
│                                      │                                                 │
│                                      ▼                                                 │
│               React 19 / Vite 8 Single Page Application (NGINX:5173)                   │
│               - Live Server-Sent Events (SSE) Stream Timeline                          │
│               - Evidence-First Finding Presentation                                    │
│               - Direct Binary DOCX Approval Note Downloads                             │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │ HTTPS / Bearer Auth / x-organization-id
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SOVEREIGN APPLIANCE BOUNDARY                                    │
│                                                                                        │
│   Node.js 22 Express API Gateway (Port 9000)                                           │
│   ├── Authentication & Multi-Tenant Scoping Middleware                                │
│   ├── Real-Time Server-Sent Events Broker (ExecutionEventsService)                     │
│   └── Task Router & Model Dispatcher                                                   │
│                                      │                                                 │
│                                      ▼                                                 │
│   LangGraph StateGraph Orchestration Engine                                            │
│   ├── Inspection Workflow StateGraph (10 Nodes with Bounded Retries)                   │
│   └── Autonomous Tool Agent StateGraph (Reason -> Tool -> Validate Loop)               │
│                                      │                                                 │
│   ┌──────────────────────────────────┼──────────────────────────────────┐              │
│   │                                  │                                  │              │
│   ▼                                  ▼                                  ▼              │
│ ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐        │
│ │  Local AI Services    │  │  Secure Code Sandbox  │  │  Document Generators  │        │
│ │                       │  │                       │  │                       │        │
│ │ • Host Ollama Runtime │  │ • Ephemeral Container │  │ • python-docx Engine  │        │
│ │   (llama3.2:3b LLM)   │  │ • python:3.11-alpine  │  │ • Executive Summary   │        │
│ │ • Xenova ONNX MiniLM  │  │ • --network none      │  │ • Verbatim Citations  │        │
│ │   (384D Embeddings)   │  │ • 256MB RAM / 1 CPU   │  │ • Sign-Off Blocks     │        │
│ │ • Self-Hosted Qdrant  │  │ • Hard Execution Kill │  │                       │        │
│ │   (30,969 vectors)    │  │                       │  │                       │        │
│ │ • Tesseract OCR (5.x) │  │                       │  │                       │        │
│ └───────────────────────┘  └───────────────────────┘  └───────────────────────┘        │
│                                      │                                                 │
│                                      ▼                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────┐        │
│ │                    Durable Relational Persistence                           │        │
│ │                                                                             │        │
│ │   PostgreSQL 16 Database (Port 5433:5432)                                   │        │
│ │   • Multi-tenant isolated documents & chunks metadata                       │        │
│ │   • Generated Approval Notes & sign-off records                             │        │
│ │   • Durable LangGraph agent runs & chronological trace steps                │        │
│ │   • Conversational chat history & citation references                       │        │
│ └─────────────────────────────────────────────────────────────────────────────┘        │
│                                                                                        │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
                                       X  EGRESS STRICTLY BLOCKED (0 Calls)
                                       ▼
                             Public Cloud AI APIs
                         (OpenAI, Anthropic, Google)
```

---

## 2. Component Responsibility & Interfaces

### 1. Presentation Layer (Frontend)
- **Framework:** React 19.2.8 with Vite 8.2.2 and TailwindCSS v4.
- **Client Protocol:** HTTP REST with Axios for command triggers; `fetch()` + `ReadableStream` for real-time SSE streaming.
- **Key Views:**
  - `/agent`: Multi-step LangGraph autonomous agent with live event timeline and PostgreSQL run history.
  - `/inspection`: Full pipeline view showing structured findings, SOP matches, risk assessment, and DOCX generation.
  - `/chat`: Grounded RAG query interface with document/page citations.
  - `/security`: Real-time data sovereignty governance dashboard with live component reachability.

### 2. Orchestration Layer (LangGraph)
- **Inspection Pipeline:**
  `START` $\rightarrow$ `ingest` $\rightarrow$ `retrieve` $\rightarrow$ `extract_findings` $\rightarrow$ `validate_findings` $\rightarrow$ `retrieve_sop` $\rightarrow$ `check_sop_evidence` $\rightarrow$ `assess_risk` $\rightarrow$ `validate_risk` $\rightarrow$ `validate_citations` $\rightarrow$ `generate_report` $\rightarrow$ `END`.
  - **Bounded Retry:** Schema validation failures trigger a retry (`maxExtractionAttempts = 2`) before failing safely.
  - **Insufficient Evidence Halt:** Missing SOP standards trigger `insufficient_evidence`, preventing false recommendations.
- **Autonomous Tool Agent:**
  `START` $\rightarrow$ `initialize` $\rightarrow$ `reason` $\rightarrow$ `execute_tool` $\rightarrow$ `validate_tool_result` $\rightarrow$ `reason` $\rightarrow$ `final_answer` / `safe_failure` $\rightarrow$ `END`.
  - **Tool Registry:** Whitelisted tools (`calculator`, `document_search`, `file_read`, `document_generate`).
  - **Bounded Execution:** Bounded by `maxSteps = 8` and hard execution deadlines.

### 3. AI & Vector Engine Layer
- **Large Language Model:** Local Ollama runtime (`llama3.2:3b`) on `host.docker.internal:11434` leveraging hardware GPU acceleration.
- **Vector Embeddings:** Xenova `@huggingface/transformers` running local ONNX `all-MiniLM-L6-v2` generating 384-dimensional dense vectors.
- **Vector Storage:** Self-hosted Qdrant instance managing 30,969 vectors with cosine distance on persistent disk.
- **OCR Fallback:** Local Tesseract OCR (v5.x) for scanned industrial inspection sheets.

### 4. Code Execution Sandbox
- **Runtime:** Ephemeral container spawned via `/var/run/docker.sock` (`python:3.11-alpine`).
- **Network Isolation:** Spawns with `--network none` (no internet, no LAN socket access).
- **Resource Constraints:** `--memory 256m`, `--cpus 1`, `--pids-limit 64`, `--read-only`, and process kill timer (5s).

### 5. Persistence Layer
- **Engine:** PostgreSQL 16 on persistent Docker volume `postgres_data`.
- **Tables:** `organizations`, `users`, `documents`, `reports`, `conversations`, `messages`, `agent_runs`, `agent_run_steps`.
- **Security:** 100% parameterized SQL (`$1, $2, ...`), strict multi-tenant boundary checks.

---

## 3. Trust Boundary & Governance Summary

1. **Zero External AI Vendor Calls:** Verified at runtime via `/api/v1/sovereignty`.
2. **Local Component Processing:** All model weights, embeddings, and vector math run within local memory.
3. **Data Durability:** Vector indexes and database records survive container destruction and restart.
4. **Transparent Auditability:** Complete execution traces stored in PostgreSQL and streamable over authenticated SSE.
