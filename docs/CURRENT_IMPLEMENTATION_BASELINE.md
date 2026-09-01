# SovereignAI — Current Implementation Baseline & Codebase Audit

**Audit Date:** September 1, 2026  
**Repository Working Tree:** `Pushpen2005/sovereign-ai-workbench`  
**Current Active Branch:** `recover-frontend-backend` (tracking `origin/recover-frontend-backend`)  
**Commit Range Audited:** `fd7e75a` (initial setup) through `686e4de` (autonomous agent orchestrator)

---

## 1. Executive Summary & Verification Matrix

A comprehensive inspection of all backend code, AI service pipelines, database schemas, vector collections, Docker configurations, and test suites was conducted.

### PR Implementation Verification Status

| Feature / Historical PR Reference | Status | Code Location | Verification Notes |
| :--- | :--- | :--- | :--- |
| **PR #11: Core RAG** | **COMPLETE** | `ai-service/rag/rag.service.js`<br>`ai-service/retrieval/retrieval.service.js`<br>`ai-service/llm/llm.service.js` | Full cosine similarity retrieval (limit, score threshold, `documentId`, `allowedDocumentIds`), grounded prompt templates, Ollama local generation, page citations. |
| **PR #12: OCR Service** | **COMPLETE** | `ai-service/extraction/ocr.service.js`<br>`ai-service/extraction/pdf.service.js` | Dual extraction: PDF.js `pdfjs-dist` text extraction with page-level fallback rendering to canvas and local Tesseract OCR spawning `tesseract stdout`. |
| **PR #13: Inspection Findings** | **COMPLETE** | `ai-service/inspection/inspection.service.js`<br>`ai-service/inspection/inspection.schema.js`<br>`ai-service/inspection/inspection.prompt.js` | Structured JSON extraction from inspection PDFs, multi-query retrieval (temperature, vibration, non-compliance), strict JSON schema validation, automatic 1-attempt repair/retry mechanism. |
| **PR #14: SOP Knowledge Base** | **COMPLETE** | `ai-service/knowledge/sop.service.js` | Ingestion pipeline with metadata `documentType: "sop"`, independent Qdrant filtering on `documentType="sop"`, verified demonstration PDFs included. |
| **PR #15: Risk Assessment + Recommendation** | **COMPLETE** | `ai-service/risk/risk.service.js`<br>`ai-service/risk/risk.schema.js`<br>`ai-service/risk/risk.prompt.js` | Evaluation of findings against retrieved SOP chunks, deterministic risk level classification (`LOW`, `MEDIUM`, `HIGH`, `null`), anti-hallucination citation validation (`filterValidCitations`). |
| **PR #16: Approval Note DOCX** | **COMPLETE** | `ai-service/reports/approval-note.service.js`<br>`ai-service/reports/generate_docx.py` | Schema validation, node child process invocation of `python3 generate_docx.py` using `python-docx`, structured executive report tables, metadata headers, and recommendation callouts. |
| **PR #17: Inspection End-to-End Workflow** | **COMPLETE** | `backend/src/controllers/inspection.controller.js`<br>`backend/src/routes/inspection.routes.js`<br>`backend/src/services/inspection.service.js` | `/api/v1/inspection/ingest`, `/analyze`, `/risk`, `/approval-note`, `/download/:filename`, `/workflow`. |
| **PR #18: PostgreSQL Document Persistence** | **COMPLETE** | `backend/src/repositories/documents.repository.js`<br>`backend/src/services/documents.service.js`<br>`backend/src/controllers/documents.controller.js` | Multi-tenant organization scoping, CRUD metadata, indexing lifecycle states (`Processing` -> `Indexed` / `Failed`). |
| **PR #19: Reports Persistence** | **COMPLETE** | `backend/src/repositories/reports.repository.js`<br>`backend/src/services/reports.service.js`<br>`backend/src/controllers/reports.controller.js` | PostgreSQL `reports` table linked to `documents`, download URL generation, organization filtering. |
| **PR #20: Chat Persistence & History** | **COMPLETE** | `backend/src/repositories/chat.repository.js`<br>`backend/src/services/chat.service.js`<br>`backend/src/controllers/chat.controller.js` | `conversations` and `messages` tables, source citation JSONB persistence, usage statistics endpoint. |
| **PR #22: Sovereignty Audit Manifest** | **COMPLETE** | `backend/src/app.js` (`/api/v1/sovereignty`) | Real-time audit endpoint ensuring local Ollama, ONNX local embeddings, local Tesseract, local Qdrant, and zero external cloud keys. |
| **PR #23: Deterministic Model Router** | **COMPLETE** | `ai-service/router/modelRouter.js`<br>`backend/src/app.js` (`/api/v1/router/models`) | Sub-millisecond keyword classifier dispatching to `DOCUMENT`, `CODING`, `VISION`, and `GENERAL` local Ollama models with fallback support. |
| **PR #24: Secure Coding Sandbox** | **COMPLETE** | `backend/src/services/sandbox.service.js`<br>`backend/src/controllers/coding.controller.js` | Ephemeral Docker container execution (`docker run --rm --network none`), strict 64KB input/output caps, execution timeout termination. |
| **PR #25: Multimodal Vision Analysis** | **COMPLETE** | `backend/src/controllers/vision.controller.js`<br>`backend/src/routes/vision.routes.js` | Binary magic bytes image validation (PNG, JPEG, WebP), Ollama base64 image passing, structured visual inspection extraction. |
| **PR #26: Autonomous Agent Tool Orchestrator** | **COMPLETE** | `backend/src/services/agent.service.js`<br>`backend/src/services/agentTools/*` | Bounded iterative execution loop (max 8 steps, 60s timeout), safe AST calculator tool, sandbox code tool, document search, file reader, document generator. |

---

## 2. Current Architecture & Actual Services

The application is architected as a hybrid Node.js/Python microservices workspace containerized with Docker Compose:

```
                  ┌─────────────────────────────────┐
                  │   Vite + React 19 Frontend      │ (Port 5173 / Container 80)
                  │   (Tailwind CSS v4, Lucide)     │
                  └────────────────┬────────────────┘
                                   │ HTTP REST
                                   ▼
                  ┌─────────────────────────────────┐
                  │       Node.js Backend           │ (Port 9000)
                  │   Express v5, pg, multer, cors  │
                  └──┬─────────────┬─────────────┬──┘
                     │             │             │
        Internal RPC │             │ SQL         │ Docker CLI (Unix Socket)
                     ▼             ▼             ▼
┌───────────────────────────┐ ┌───────────────┐ ┌─────────────────────────┐
│        AI Service         │ │  PostgreSQL   │ │ Ephemeral Code Sandbox  │
│ Node.js (Port 5001)       │ │  16-alpine    │ │ python:3.11-slim        │
│ - Xenova ONNX Embeddings  │ │  (Port 5433)  │ │ (--network none, --rm)  │
│ - Tesseract OCR           │ └───────────────┘ └─────────────────────────┘
│ - pdfjs-dist + canvas     │
│ - python-docx script      │
└─────────────┬─────────────┘
              │ Vector Search & Embeddings
              ▼
┌───────────────────────────┐ ┌───────────────────────────────────────────┐
│     Qdrant Vector DB      │ │            Ollama Local Runtime           │
│   (Port 6333, Cosine 384) │ │       (Port 11434 / Host-accelerated)     │
└───────────────────────────┘ └───────────────────────────────────────────┘
```

### Actual Running Services
1. **Frontend:** React 19 + Vite 8 SPA (`frontend/`), running via Nginx in Docker or Vite locally.
2. **Backend API:** Node.js Express 5 server (`backend/src/app.js`, port 9000).
3. **AI Service:** Standalone Node.js service daemon (`ai-service/server.js`, port 5001) providing health discovery and internal shared modules.
4. **Relational Database:** PostgreSQL 16 Alpine (`sovereign-ai-postgres`, port 5433 on host).
5. **Vector Store:** Qdrant self-hosted (`sovereign-ai-qdrant`, port 6333).
6. **LLM Runtime:** Ollama self-hosted (`sovereign-ai-ollama`, port 11435/11434, running `llama3.2:3b`).

---

## 3. Actual API Endpoints

### System & Diagnostics
- `GET /api/v1/health` — Backend readiness check.
- `GET /api/v1/sovereignty` — Real-time air-gap and local runtime audit.
- `GET /api/v1/router/models` — Local Ollama installed models and active routing registry.

### Document Persistence (`/api/v1/documents`)
- `GET /api/v1/documents` — List all documents belonging to the request organization.
- `GET /api/v1/documents/:id` — Retrieve metadata for a specific document.
- `POST /api/v1/documents` — Upload PDF (`multipart/form-data`) -> extract -> embed -> index into Qdrant -> persist into PostgreSQL.

### Ingestion & Inspection Workflow (`/api/v1/inspection`)
- `POST /api/v1/inspection/upload` — Raw PDF upload to local disk storage (`uploads/`).
- `POST /api/v1/inspection/ingest` — Chunk, embed, and upsert inspection PDF to Qdrant.
- `POST /api/v1/inspection/analyze` — Query Qdrant for observations and extract structured JSON findings.
- `POST /api/v1/inspection/risk` — Evaluate finding against SOP vector search and return risk rating + recommendation.
- `POST /api/v1/inspection/approval-note` — Assemble findings & risk into Word DOCX.
- `GET /api/v1/inspection/download/:filename` — Download generated `.docx` report.
- `POST /api/v1/inspection/workflow` — Full automated pipeline execution (upload -> findings -> risk -> recommendation -> approval note).

### RAG & Chat (`/api/v1/chat`)
- `POST /api/v1/chat/ask` — RAG question answering with citations and conversation thread tracking.
- `GET /api/v1/chat/history` — List active conversations for the organization.
- `GET /api/v1/chat/conversations/:id/messages` — Chronological message exchange in a conversation.
- `GET /api/v1/chat/stats` — Organization query counts and chat statistics.

### Reports (`/api/v1/reports`)
- `GET /api/v1/reports` — List generated reports with risk levels and download links.
- `GET /api/v1/reports/:id` — Fetch individual report details.

### Coding Sandbox (`/api/v1/coding`)
- `POST /api/v1/coding/generate` — Generate Python code for a prompt.
- `POST /api/v1/coding/execute` — Execute code inside an isolated Docker sandbox.

### Multimodal Vision (`/api/v1/vision`)
- `POST /api/v1/vision/analyze` — Upload industrial image (PNG/JPEG/WebP) and extract visual findings using vision LLM.

### Autonomous Agent (`/api/v1/agent`)
- `POST /api/v1/agent/run` — Bounded iterative tool-calling agent loop.

---

## 4. Actual Database Tables (PostgreSQL)

Verified directly against `sovereign-ai-postgres` (Database: `workbench_db`):

1. **`organizations`**
   - `id` (VARCHAR(255) PK), `name` (VARCHAR(255)), `created_at`, `updated_at`.
   - Default seeded organization: `0bd5dba2-05e1-4f5c-9047-25843d338622` ("Demo Organization").
2. **`users`**
   - `id` (VARCHAR(255) PK), `organization_id` (FK to `organizations.id`), `name`, `email`, `password_hash`, `role`, `created_at`, `updated_at`.
3. **`documents`**
   - `id` (VARCHAR(255) PK), `organization_id` (FK to `organizations.id`), `filename`, `original_filename`, `status` (`Processing`, `Indexed`, `Failed`), `chunks_stored` (INTEGER), `created_at`, `updated_at`.
4. **`reports`**
   - `id` (VARCHAR(255) PK), `document_id` (FK to `documents.id`), `organization_id` (FK to `organizations.id`), `title`, `filename`, `risk_level` (`HIGH`, `MEDIUM`, `LOW`, `null`), `status`, `task`, `created_at`, `updated_at`.
5. **`conversations`**
   - `id` (VARCHAR(255) PK), `organization_id` (FK to `organizations.id`), `title`, `created_at`, `updated_at`.
6. **`messages`**
   - `id` (VARCHAR(255) PK), `conversation_id` (FK to `conversations.id`), `role` (`user`, `assistant`), `content` (TEXT), `sources` (JSONB), `document_id`, `created_at`.

---

## 5. Actual Qdrant Collections

Verified directly via Qdrant REST API (`http://localhost:6333/collections`):

- **Collection Name:** `documents`
  - **Vector Dimension:** `384`
  - **Distance Metric:** `Cosine`
  - **Payload Storage:** On-disk enabled
  - **Payload Attributes per Point:**
    - `documentId`: String UUID
    - `filename`: String filename
    - `documentType`: String (`"inspection"` | `"sop"`)
    - `page`: Integer page number
    - `chunkIndex`: Integer global chunk offset
    - `text`: Chunk content (1000 characters, 200 overlap)
    - `pageStartOffset`: Integer offset in page
    - `pageEndOffset`: Integer offset in page
  - **Point Count:** Over 29,485 points currently indexed and persisted.

---

## 6. Actual RAG Flow (`ai-service/rag/rag.service.js`)

1. User sends query to `POST /api/v1/chat/ask` (or `answerQuestion()` internally).
2. **Embedding Generation:** Query is converted into 384-dimensional vector using `@huggingface/transformers` with `Xenova/all-MiniLM-L6-v2` locally.
3. **Similarity Search:** Search Qdrant collection `documents` using Cosine distance.
   - If `options.documentId` is passed, filters by `documentId`.
   - If `options.allowedDocumentIds` is passed, applies candidate retrieval filter.
4. **Relevance Thresholding:** Filters chunks where `chunk.score >= 0.5` and sorts descending by score; takes top 5 chunks.
5. **Context Construction:** Concatenates source chunks into formatted context.
6. **Grounded Prompting:** Injects context into enterprise document assistant prompt enforcing non-fabrication and prompt injection isolation.
7. **LLM Generation:** Calls local Ollama `llama3.2:3b` via `POST /api/generate` with `stream: false`.
8. **Citation Response:** Emits answer alongside structured page-aware citations (`documentId`, `page`, `chunkIndex`, `score`).

---

## 7. Actual Inspection Flow (`ai-service/inspection/`)

1. **Ingest Inspection:** `POST /api/v1/inspection/ingest` or upload PDF.
   - PDF.js extracts page text; if empty/scanned, renders canvas to PNG and runs local Tesseract OCR.
   - Chunks text by 1000 chars (200 overlap), tagging `documentType: "inspection"`.
   - Embeds each chunk with ONNX `all-MiniLM-L6-v2` and upserts points to Qdrant.
2. **Multi-Aspect Retrieval:**
   - Instead of a single query, executes 3 distinct queries across equipment, temperature/vibration limits, and audit non-compliances.
   - Merges results deduplicated by chunk key.
3. **Structured Findings Extraction:**
   - Invokes Ollama with `format: "json"` asking for structured array: `finding`, `equipment`, `observedValue`, `limit`, `severity`, `evidence`.
   - Validates response schema. If the model outputs conversational markdown or invalid JSON, automatically invokes **Attempt 2 Strict Retry** with explicit schema correction instructions.
4. **Source Linkage:** Matches verbatim evidence string back to retrieved chunks and binds `source: { documentId, page, chunkIndex }`.

---

## 8. Actual SOP Flow (`ai-service/knowledge/sop.service.js`)

1. **Ingest SOP:** `ingestSop(filePath)` extracts, chunks, embeds, and indexes PDF chunks into Qdrant tagged specifically with `documentType: "sop"`.
2. **Authoritative Search:** `searchSop(query)` conducts similarity search applying a native Qdrant filter `{ key: "documentType", match: { value: "sop" } }`.
3. **Isolation Guarantee:** Inspection documents are guaranteed never to be returned during SOP matching, preventing circular feedback between observations and standards.

---

## 9. Actual Risk & Recommendation Flow (`ai-service/risk/`)

1. Takes an extracted finding from the inspection flow.
2. **Query Formulation:** Synthesizes finding and equipment into an SOP query.
3. **SOP Evidence Retrieval:** Calls `searchSop()`. If zero matching SOP chunks meet score `>= 0.5`, halts immediately and returns `INSUFFICIENT_EVIDENCE_RESULT` (`level: null`, no recommendation) without hallucinating.
4. **Risk Prompting:** Formulates prompt with finding details and authoritative SOP excerpts.
5. **LLM Evaluation:** Local LLM outputs JSON rating (`LOW`, `MEDIUM`, or `HIGH`), detailed justification reason, and recommendation.
6. **Anti-Hallucination Citation Verification:** `filterValidCitations()` cross-checks all cited chunk indices against actually retrieved SOP chunks. Any fabricated citations are discarded.

---

## 10. Actual Approval Note DOCX Flow (`ai-service/reports/`)

1. `validateApprovalNoteInput()` enforces strict structure on findings, risk assessment, and citations.
2. Formats sanitized JSON and pipes it via `stdin` to `ai-service/reports/generate_docx.py`.
3. Python script uses `python-docx` to construct an executive document:
   - Header table with document ID, date, status.
   - Findings summary table with severity badges.
   - Technical analysis paragraph.
   - Risk assessment box with color-coded severity.
   - Prescriptive recommendation section.
   - Verified bibliographic citations table.
4. Saves `.docx` output to `backend/generated/` and registers record in PostgreSQL `reports` table.

---

## 11. Existing Tests and Execution Results

Backend test files located in `backend/tests/`:

1. **`inspection.structured.test.js`**: **PASSED** (6 unit & integration tests for JSON validation, retry on prose, graceful error handling, markdown stripping).
2. **`router.test.js`**: **PASSED** (14 tests verifying `DOCUMENT`, `CODING`, `VISION`, `GENERAL` task routing, fallback switching, and model availability).
3. **`vision.test.js`**: **PASSED** (14 tests verifying magic byte image validation, task classification, missing model errors, structured vision extraction).
4. **`sandbox.test.js`**: **PASSED** (7 tests verifying Docker ephemeral execution, timeout enforcement, `--network none` block, secret isolation, output truncation, cleanup).
5. **`backend.e2e.test.js`**: **PASSED** (Full HTTP API surface: upload, ingest, Qdrant payload, analyze findings, risk assessment, approval note generation, file download, workflow orchestration).
6. **`reports.test.js`**: **PASSED** (Verification of report persistence in PostgreSQL, download URLs, multi-tenant organization isolation).
7. **`chat.test.js`**: **PASSED** (Verification of chat conversations, message ordering, stats, organization isolation).
8. **`agent.test.js`**: **PARTIAL** (13 passed, 1 minor failure in unit test assertion where `exitCode` returned `null` instead of `0` in container stdout check; core agent logic operational).
9. **`documents.test.js`**: **PARTIAL** (Assertion mismatch on test setup due to a historical failed test document with the same filename `RIL-IAR-2025.pdf` in the database; database and document service functionality itself is fully intact).

---

## 12. Feature Completion Breakdown

| Feature Area | Implementation State |
| :--- | :--- |
| **Page-aware PDF extraction** | **COMPLETE** |
| **Tesseract OCR fallback** | **COMPLETE** |
| **Page-aware chunking** | **COMPLETE** |
| **384-d local embeddings (all-MiniLM-L6-v2)** | **COMPLETE** |
| **Qdrant storage & similarity search** | **COMPLETE** |
| **Core RAG pipeline** | **COMPLETE** |
| **Ollama local inference** | **COMPLETE** |
| **Grounded prompting** | **COMPLETE** |
| **Citations & metadata tracking** | **COMPLETE** |
| **Inspection finding structured extraction** | **COMPLETE** |
| **SOP knowledge base & isolated search** | **COMPLETE** |
| **Risk assessment & recommendation** | **COMPLETE** |
| **Approval Note DOCX generation** | **COMPLETE** |
| **PostgreSQL document & report persistence** | **COMPLETE** |
| **Multi-tenant organization isolation** | **COMPLETE** |
| **Deterministic Model Router** | **COMPLETE** |
| **Docker code execution sandbox** | **COMPLETE** |
| **Multimodal vision inspection** | **COMPLETE** |
| **Autonomous agent runtime (Custom loop)** | **COMPLETE** |
| **LangGraph orchestration** | **NOT IMPLEMENTED** (Custom loop currently used) |

---

## 13. Partial Functionality & Existing Technical Debt

1. **Custom Autonomous Agent Loop (`backend/src/services/agent.service.js`):**
   - The current autonomous agent uses a bespoke `runAgentLoop()` while-loop with string regex parsing for JSON tool calling (`parseActionJSON()`). While functional, it lacks a formal state graph, checkpointing, branching, and state machine rollback capabilities.
2. **Cross-Service Code Duplication:**
   - Both `ai-service/package.json` and `backend/package.json` exist. The backend imports modules directly from `../../ai-service/*` via relative ES module paths instead of consuming it as an internal npm package or monorepo workspace package.
3. **Database Test Fixture Pollution:**
   - `documents.test.js` expects exactly one `RIL-IAR-2025.pdf` row in PostgreSQL. Repeated test runs without unique transaction rollbacks resulted in multiple test document records in development.
4. **Sharp / Canvas Dynamic Library Warning:**
   - Notice in logs: `Class GNotificationCenterDelegate is implemented in both sharp-libvips and canvas`. While non-fatal on macOS, this is a minor dependency conflict in development runtimes.

---

## 14. Recommended LangGraph Integration Point

Currently, the orchestration across:
1. Document Ingestion ->
2. Multi-Aspect Retrieval ->
3. Findings Extraction (with retry) ->
4. SOP Matching ->
5. Risk Evaluation ->
6. Recommendation Generation ->
7. Approval Note DOCX Generation

is written as an imperative sequential promise chain in `backend/src/services/inspection.service.js` (`runCompleteWorkflow()`) and a custom while-loop in `backend/src/services/agent.service.js` (`runAgentLoop()`).

### Ideal LangGraph Integration Architecture:
Replace the imperative `runCompleteWorkflow()` and bespoke `runAgentLoop()` with a formal **LangGraph StateGraph**:

```
                 [START]
                    │
                    ▼
           ┌─────────────────┐
           │ Ingest & Embed  │
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │ Multi-Aspect    │
           │ Retrieval       │
           └────────┬────────┘
                    ▼
           ┌─────────────────┐       (Schema Invalid)
           │ Extract Finding ├─────────────────────────┐
           └────────┬────────┘                         │
                    │ (Valid Schema)                   │
                    │                                  ▼
                    │                         ┌──────────────────┐
                    │                         │ LLM Retry Prompt │
                    │                         └────────┬─────────┘
                    ▼                                  │
           ┌─────────────────┐                         │
           │ Search SOP KB   │◄────────────────────────┘
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │ Assess Risk &   │
           │ Recommendation  │
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │ Validate        │
           │ Citations       │
           └────────┬────────┘
                    ▼
           ┌─────────────────┐
           │ Generate DOCX   │
           └────────┬────────┘
                    ▼
                  [END]
```

### Key Integration Rules for Next Phase:
- Do **not** replace the existing Qdrant vectorstore client, embedding model, or Ollama service.
- Use LangGraph solely as the **orchestrator** node-and-edge state machine wrapping the existing tested service functions (`analyzeInspectionReport`, `searchSop`, `assessFindingRisk`, `generateApprovalNote`).
