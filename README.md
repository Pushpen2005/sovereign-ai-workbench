# SovereignAI

> **On-Premise Agentic AI Workbench using Open-Weight Multimodal LLMs for Confidential Industrial Work**  
> Target Problem: **SIH 26117 — Mangalore Refinery and Petrochemicals Limited (MRPL)**

---

## Overview

**SovereignAI** is an on-premise industrial AI workbench engineered for enterprise environments where operational data, engineering designs, and inspection records must remain strictly within organizational boundaries. Built to address the requirements of **SIH 26117 (MRPL)**, SovereignAI guarantees complete data sovereignty by running entirely locally without outbound internet transmission or third-party cloud AI dependencies.

The system combines local document ingestion, optical character recognition (OCR), dense vector retrieval (Qdrant), relational audit persistence (PostgreSQL), and open-weight Large Language Models (executed locally via Ollama) to assist refinery engineers with document intelligence, technical standard compliance, and inspection reporting.

---

## Problem Statement

Refinery and petrochemical operations generate vast amounts of confidential, safety-critical documentation:
- Equipment inspection reports and non-destructive testing (NDT) records
- Standard Operating Procedures (SOPs) and safety compliance manuals
- Process flow diagrams (PFDs) and Piping & Instrumentation Diagrams (P&IDs)
- Maintenance logs and statutory compliance filings

**The Core Challenge:**
Commercial cloud-based LLM APIs violate strict industrial confidentiality and cybersecurity regulations. Sending refinery telemetry, vulnerability assessments, or equipment defect logs to external servers creates unacceptable data leakage risks. 

At the same time, manual review of inspection reports against hundreds of internal SOPs is labor-intensive, error-prone, and delays statutory approval processes.

---

## Why SovereignAI

- **100% On-Premise Execution:** Zero external API calls. All embeddings, OCR, vector searches, and LLM inferences execute inside the enterprise perimeter.
- **Air-Gapped Viability:** Operates on local compute hardware without requiring internet connectivity during runtime.
- **Verifiable Provenance:** Every extracted finding and generated recommendation includes page-level citations and exact verbatim evidence from source documents.
- **Dual-Database Architecture:** Clear segregation of concerns between relational application state (PostgreSQL) and high-dimensional semantic search (Qdrant).

---

## Key Objective

Provide industrial inspection engineers with a local, sovereign AI workbench that:
1. Ingests dense, scanned, or complex industrial PDF reports with page-level awareness and OCR fallbacks.
2. Extracts structured inspection findings backed by verbatim source evidence.
3. Cross-references identified defects against internal Standard Operating Procedures (SOPs).
4. Performs structured technical risk assessments.
5. Formulates actionable maintenance recommendations.
6. Automatically drafts audit-ready Approval Notes in standard `.docx` format for human sign-off.

---

## Current Architecture

### Target System Architecture

```
User
  │
  ▼
Frontend (React / Vite)
  │
  ▼
Backend API (Node.js / Express)
  │
  ▼
AI Service (Local Ingestion & Orchestration)
  │
  ├── Local OCR (Tesseract) / Local Embeddings (Transformers.js 384D)
  │     │
  │     ▼
  ├── Self-Hosted Qdrant (Persistent Docker Volume)
  │
  ├── Local LLM Execution (Ollama / Open-Weight Models)
  │
  └── Orchestration Pipeline:
        ├── Grounded RAG & Citations
        ├── Inspection Findings Extraction
        ├── SOP Cross-Referencing [⚠️ Verification Required]
        ├── Risk Assessment Engine [⚠️ Verification Required]
        ├── Recommendation Engine [⚠️ Verification Required]
        └── Approval Note DOCX Generation [⚠️ Verification Required]
```

### Target Flagship Workflow

```
Inspection Report (PDF)
         │
         ▼
Extract Findings (Structured & Validated Evidence)
         │
         ▼
Search Internal SOPs (Semantic Retrieval)
         │
         ▼
Technical Analysis & Compliance Check
         │
         ▼
Risk Assessment (Severity & Impact Scoring)
         │
         ▼
Recommendation Generation
         │
         ▼
Generate Approval Note (.docx)
         │
         ▼
Human Review & Official Sign-Off
```

---

## Current Working AI Pipeline

The foundational Retrieval-Augmented Generation (RAG) and document processing pipeline is operational and verified:

```
PDF Document
     │
     ▼
Page-Aware Extraction (pdfjs-dist)
     │   (Fallback per page to Tesseract OCR when unextractable)
     ▼
Page-Aware Chunking (1000 characters, 200 character overlap)
     │
     ▼
Local 384-Dimensional Dense Embeddings (@huggingface/transformers)
     │
     ▼
Qdrant Vector Database (Self-hosted on persistent Docker volume)
     │
     ▼
Similarity Retrieval (Top-K semantic matching)
     │
     ▼
Retrieved Context Chunks + Source Metadata
     │
     ▼
Grounded Prompting (Ollama local LLM)
     │
     ▼
Grounded Answer with Page-Level Source Citations
```

### Inspection Findings Pipeline (Verified Working)

```
Inspection Report Chunks (Retrieved from Qdrant)
     │
     ▼
Structured Inspection Prompt
     │
     ▼
Local LLM (Ollama)
     │
     ▼
Structured Finding Output (Component, Defect Type, Severity)
     │
     ▼
Application Evidence Validation (Verbatim check against retrieved chunks)
     │
     ▼
Validated Finding + Attached Page-Level Citation Metadata
```

---

## Database Responsibilities

To prevent architecture degradation, database roles are strictly bifurcated:

```
┌───────────────────────────────────────────────────────────┐
│                    PostgreSQL                             │
│         (Relational / Application Primary DB)             │
├───────────────────────────────────────────────────────────┤
│ • User accounts & access control (RBAC)                   │
│ • Document records & processing metadata                  │
│ • Inspection runs & execution logs                        │
│ • Structured findings & risk assessments                  │
│ • Audit trails & compliance logs                          │
│ • Persistent chat conversation history (in progress)      │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│                      Qdrant                               │
│              (Vector Search Engine)                       │
├───────────────────────────────────────────────────────────┤
│ • 384-dimensional dense document embeddings               │
│ • Chunk payloads (text snippet, page number, document ID) │
│ • Approximate Nearest Neighbor (ANN) cosine similarity     │
│ • Semantic retrieval for RAG & SOP matching               │
└───────────────────────────────────────────────────────────┘
```

> **Note:** Qdrant is **never** used as the relational or transactional database. PostgreSQL handles all entity state, relationships, and document cataloging.

---

## Technology Stack

| Layer | Technologies | Role |
|---|---|---|
| **Frontend** | React 19, Vite, React Router 7, TailwindCSS | Workbench user interface, document upload, dashboard, chat views |
| **Backend API** | Node.js, Express 5, Multer, `pg` | Document ingestion routing, business logic, PostgreSQL persistence |
| **Relational Database** | PostgreSQL | System of record for users, documents, inspection runs, and audit logs |
| **Vector Database** | Qdrant (Dockerized, persistent volume) | Dense vector storage and similarity retrieval |
| **AI / Ingestion Engine** | Node.js (ESM), `pdfjs-dist`, `pdf-to-img` | Page-aware PDF parsing and image rasterization |
| **OCR** | Tesseract (Local) | Per-page optical character recognition for scanned/legacy PDFs |
| **Embeddings** | `@huggingface/transformers` (384-dim) | Local dense vector generation |
| **Local LLM Runtime** | Ollama | Local inference for open-weight instruction models |
| **Document Generation** | Python `python-docx` / Node child process | Programmatic generation of Approval Note DOCX files |

---

## Implementation Status

| Component / Feature | Status | Notes |
|---|:---:|---|
| **PDF Extraction** | 🟢 Complete | Native text extraction via `pdfjs-dist` |
| **Page-Aware Extraction** | 🟢 Complete | Text segments track originating page numbers |
| **Page-Aware Chunking** | 🟢 Complete | 1,000 characters chunk size, 200 characters overlap with page tagging |
| **384D Embeddings** | 🟢 Complete | Local inference via `@huggingface/transformers` |
| **Qdrant Storage** | 🟢 Complete | Chunks and vector payloads indexed in collection |
| **Qdrant Similarity Retrieval** | 🟢 Complete | Top-K cosine search operational |
| **Qdrant Persistence** | 🟢 Complete | Persistent Docker volume verified across container restarts |
| **RAG Pipeline** | 🟢 Complete | Context assembly and grounded generation working |
| **Ollama / Local LLM Integration** | 🟢 Complete | Local model execution without external network calls |
| **Grounded Prompting** | 🟢 Complete | Strict hallucination constraints enforced in prompts |
| **Page-Level Citations** | 🟢 Complete | Source file name and page numbers included in output |
| **OCR Fallback** | 🟢 Complete | Tesseract invoked automatically on pages with insufficient text |
| **Inspection Findings Extraction** | 🟢 Complete | Structured finding extraction with verbatim evidence validation |
| **PostgreSQL Application DB** | 🟢 Complete | PostgreSQL client, schema, and connection pooling integrated |
| **Document Metadata Persistence** | 🟢 Complete | Document records saved and queried in PostgreSQL |
| **Document List Persistence** | 🟢 Complete | Document catalog persists across browser page reloads |
| **Chat History Persistence** | 🟡 Pending | Chat messages remain in React client state; lost on page refresh |
| **SOP Knowledge Base** | ⚠️ Verify Current Codebase | Commits exist; requires branch validation and E2E verification |
| **Risk Assessment Engine** | ⚠️ Verify Current Codebase | Commits exist; requires branch validation and E2E verification |
| **Recommendation Generation** | ⚠️ Verify Current Codebase | Commits exist; requires branch validation and E2E verification |
| **Approval Note DOCX Generation** | ⚠️ Verify Current Codebase | Python script and service exist; requires pipeline verification |
| **Inspection Agent Integration** | 🔴 Remaining | Unifying standalone steps into a cohesive automated agent pipeline |
| **Backend Product API Layer** | 🔴 Remaining | Complete standardized REST endpoints for workbench features |
| **Frontend Full Integration** | 🔴 Remaining | Connecting all workbench UI screens to active backend endpoints |
| **Authentication (JWT / RBAC)** | 🔴 Remaining | User registration, login, token verification, and role security |
| **Sovereignty / Security Evidence**| 🔴 Remaining | UI/audit verification panel showing zero outbound network calls |
| **Final Docker Compose Integration**| 🔴 Remaining | Single-command multi-container orchestration (`docker-compose up`) |
| **Final End-to-End Demo Workflow** | 🔴 Remaining | Seamless report upload → approval note download validation |
| **Model Router** | ⭐ Bonus | Dynamic task routing across multiple open-weight models |
| **MCP Tool Layer** | ⭐ Bonus | Model Context Protocol server interface |
| **Coding Sandbox** | ⭐ Bonus | Local sandboxed code execution environment |
| **Vision / P&ID Analysis** | ⭐ Bonus | Multimodal processing of engineering schematics and diagrams |

---

## Completed Capabilities

The following capabilities are implemented, tested, and confirmed functional:
1. **Deterministic Document Parsing:** Page-aware PDF text extraction with automatic fallback to local Tesseract OCR on a per-page basis when scanned pages or rasterized diagrams are detected.
2. **Dense Vector Chunking & Indexing:** Chunks of 1,000 characters with 200-character overlaps indexed into 384-dimensional vector space using local transformer models.
3. **Persistent Vector Storage:** Self-hosted Qdrant deployment running with a persistent Docker volume, retaining vectors and chunk payloads across container recreation.
4. **Local Grounded RAG:** Ingestion, retrieval, and contextual prompting running entirely locally through Ollama, outputting verifiable page-level source references.
5. **Structured Finding Extraction with Evidence Guardrails:** Extraction of inspection defects ensuring that evidence is validated verbatim against source text before attachment.
6. **Relational Document Persistence:** PostgreSQL storage for document records and metadata, ensuring document lists persist across browser reloads.

---

## Known Pending Work

- **PostgreSQL Chat History Persistence:** Chat messages are currently held in React component state. Refreshing the browser clears active conversation sessions. A PostgreSQL schema and corresponding API endpoints are required to store and reload chat threads.
- **Inspection Agent Orchestration:** While discrete processing blocks exist, they are not yet unified into an autonomous agent pipeline that handles errors, retries, and multi-step reasoning.
- **End-to-End API & UI Wiring:** Full integration of workbench views (inspection, findings, risk, reports) with backend controllers.
- **Authentication & Authorization:** Secure user registration, password hashing, JWT issuance, and route protection.
- **Unified Deployment:** Comprehensive `docker-compose.yml` encapsulating frontend, backend, AI service, Qdrant, and PostgreSQL with persistent volumes and health checks.

---

## Features Requiring Verification

The repository commit history reflects development on the following features (e.g., PR #14, PR #15, PR #16, and inspection workflow commits). However, subsequent development notes reported them as pending or partially integrated in different development states:

- **SOP Knowledge Base** (`ai-service/sop/`, `sop.service.js`)
- **Risk Assessment** (`ai-service/risk/`, `risk.service.js`)
- **Recommendation Generation** (`ai-service/recommendation/`)
- **Approval Note DOCX Generation** (`ai-service/reports/approval-note.service.js`, `generate_docx.py`)

> ⚠️ **Notice on Verification Status:**  
> These four features are explicitly designated as **`⚠️ Verify Current Codebase`**. Do not assume they are fully working in the current branch until integration tests have been executed and verified end-to-end against live Qdrant and PostgreSQL instances.

---

## Target Inspection Agent Workflow

The intended end-state of the sovereign inspection workflow:

1. **Ingestion & Extraction:** The user uploads an NDT/equipment inspection report. The document is parsed and indexed.
2. **Findings Extraction:** The agent identifies specific component defects, degradation rates, wall thickness losses, or weld anomalies, attaching verbatim source citations.
3. **SOP Matching:** The agent queries the internal SOP vector space to retrieve applicable maintenance standards, safety thresholds, and repair procedures.
4. **Risk Quantification:** The agent scores risk based on severity, operational impact, and regulatory non-compliance.
5. **Recommendation Formulation:** Immediate, short-term, and preventive maintenance actions are generated.
6. **Approval Note Compilation:** The findings, SOP citations, risk matrix, and recommendations are compiled into an enterprise-standard Word document (`.docx`).
7. **Human Approval:** The engineer reviews the generated note, modifies content if necessary, and submits it for management sign-off.

---

## Project Roadmap

The recommended development sequence to bring SovereignAI to full operational demonstration:

```
Step 1:  Verify PR #14 / SOP Knowledge Base
Step 2:  Verify PR #15 / Risk Assessment & Recommendation Services
Step 3:  Verify PR #16 / Approval Note DOCX Generation Pipeline
Step 4:  Implement Chat History Persistence in PostgreSQL
Step 5:  Complete Backend Product API Layer (Standardize Endpoints)
Step 6:  Integrate Frontend Workbench Views with Backend Endpoints
Step 7:  Implement Authentication (Register, Login, JWT, Route Guards)
Step 8:  Construct Sovereignty & Security Verification View (Zero outbound traffic evidence)
Step 9:  Finalize Multi-Container Docker Compose Setup
Step 10: Run and Validate Final End-to-End Inspection-to-DOCX Demo
Step 11: Implement Bonus Features (Model Router, MCP, Sandbox, Vision)
```

---

## Bonus Features (Future Scope)

The following features represent architectural enhancements and are not prerequisites for core inspection workflow validation:
- **Model Router:** Intelligent request router that selects smaller models (e.g., 7B/8B) for extraction and larger models (e.g., 14B/32B) for complex risk reasoning.
- **MCP Tool Layer:** Integration with the Model Context Protocol (MCP) to allow agentic tool calling to internal enterprise databases or asset management systems.
- **Coding Sandbox:** Isolated execution sandbox for running Python data analysis or engineering formula verification locally.
- **Vision / P&ID Analysis:** Multimodal vision processing for structural defect photographs, isometric drawings, and P&ID diagrams.

---

## Current Project Position

The core RAG and AI foundation is **active and functional** (PDF parsing, OCR fallback, dense embeddings, persistent Qdrant search, grounded Ollama generation, structured findings, and PostgreSQL document persistence). 

The immediate task is **productization and verification**: validating the SOP/Risk/DOCX pipelines on the current branch, finishing chat history persistence, wiring the remaining backend API routes to the React frontend, and delivering a clean, verifiable end-to-end demo.

---

## Important Development Rule

> **"Do not assume a feature is complete merely because it appears in an older project summary. Verify the current branch, implementation, and tests."**

---

## Demo Goal

The final proof-of-concept demonstration must reliably execute the following sequence:

```
1. Upload an industrial inspection report (PDF).
2. Trigger automated analysis.
3. Extract structured equipment findings with verbatim source citations.
4. Retrieve relevant internal SOP clauses via vector search.
5. Assess engineering risk and calculate severity.
6. Generate actionable maintenance recommendations.
7. Generate an enterprise-formatted Approval Note (.docx).
8. Inspect page-level citations within the UI.
9. Download the generated .docx Approval Note for review.
```
