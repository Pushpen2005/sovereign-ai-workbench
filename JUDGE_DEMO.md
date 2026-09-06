# SovereignAI — Judge Evaluation Walkthrough (5–7 Minutes)

This runbook guides judges and evaluators through an end-to-end evaluation of **SovereignAI**, proving that confidential industrial work can be performed locally without cloud AI APIs.

---

## Evaluation Schedule

```
0:00 ── Landing Page & Problem Statement
0:30 ── Enterprise Login & Multi-Tenant Scoping
1:00 ── Deterministic Grounded RAG Query
2:00 ── Anti-Hallucination Safe Refusal
2:30 ── Inspection Agent Workflow (Live SSE Streaming)
4:00 ── Statutory Approval Note (DOCX Deliverable)
4:30 ── Multimodal Vision (Local Moondream Inference)
5:00 ── Sandboxed Coding Agent (--network none)
5:30 ── Sovereignty Audit & Security Scorecard
6:00 ── Architecture Q&A & Verdict
```

---

### Minute 0:00 — Landing Page & Problem Statement
- **Action**: Navigate to `http://localhost:5173`.
- **Key Message to Judge**:
  > *"Refineries, chemical plants, and critical infrastructure cannot send confidential inspection logs, engineering drawings, or operational vulnerabilities to external cloud LLM APIs. SovereignAI is a 100% on-premise workbench delivering grounded RAG, autonomous agents, computer vision, and sandboxed code execution without a single byte leaving the host network."*
- **Visuals**: Highlight capability tags: `Local AI`, `RAG`, `OCR`, `Agents`, `Vision`, `Secure Coding`, `On-Premise`.
- **Honest Claim**: Zero claims of "100% secure" or "MRPL approved". Grounded purely in local architecture.

---

### Minute 0:30 — Enterprise Login & Tenant Scoping
- **Action**: Click **[ Login ]** or navigate to `/login`.
- **Credentials**:
  - Email: `engineer@example.com`
  - Password: `DemoPassword123!`
- **What Judge Sees**:
  - Authenticated session with JWT issued locally and passwords salted with bcrypt (10 rounds).
  - Organization Badge: `Enterprise Plant Alpha` (ad51f0f1...).
  - Topbar and Dashboard display verified local sovereignty indicators.

---

### Minute 1:00 — Deterministic Grounded RAG Query
- **Action**: Click **[ Ask AI ]** (`/chat`).
- **Prompt**:
  > *"What was the observed bearing temperature of Pump-03?"*
- **What Judge Sees**:
  - Local ONNX embeddings (384D) retrieve relevant chunks from self-hosted Qdrant.
  - Local LLM (`llama3.2:3b`) generates the grounded answer:
    > *"Observed bearing temperature: 92°C under full operating load with abnormal heating and heavy vibration."*
  - Verbatim citation badge: `Inspection_Report_Pump03.pdf`, Page 1.
  - Telemetry footer: `Runtime: Local`, `Model: llama3.2:3b`, `Latency: ~2.8s`.

---

### Minute 2:00 — Anti-Hallucination Safe Refusal
- **Action**: Submit an out-of-domain question with no supporting evidence in the knowledge base:
  > *"What was the exact annual maintenance budget allocated for Pump-03 last year?"*
- **What Judge Sees**:
  - Qdrant similarity scores fail threshold; insufficient context retrieved.
  - Model refuses to hallucinate:
    > *"I don't have sufficient information in the available documents to answer that question."*
  - Proves the system is grounded in verifiable evidence rather than generating plausible fiction.

---

### Minute 2:30 — Autonomous Inspection Agent (Real-Time SSE)
- **Action**: Navigate to **Inspection Workspace** (`/agent`).
- **Input**: Select `Demo_Inspection_Report_Pump03.pdf` (or upload `documents/demo/Pump03_Inspection.pdf`) and click **[ Run Autonomous Inspection Agent ]**.
- **What Judge Sees (Live SSE Events)**:
  1. `Reading report`: Text and tabular sensor readings extracted via local OCR/parser.
  2. `Extracting findings`: Structured JSON extracted (Bearing Temp: 92°C, Vibration: Heavy).
  3. `Searching SOP`: Qdrant retrieves `SOP-MAINT-001` (Limit: 80°C).
  4. `Analyzing risk`: Deterministic numeric comparison (92°C > 80°C = +12°C delta) + LLM classified as **HIGH RISK**.
  5. `Preparing recommendation`: Actionable corrective steps aligned with SOP section 2.
- **Key Takeaway**: Real LangGraph directed graph execution, not a fake front-end timer.

---

### Minute 4:00 — Statutory Approval Note (DOCX Deliverable)
- **Action**: In the Inspection Workspace, click **[ Generate Approval Note ]** / **[ Download DOCX ]**.
- **What Judge Sees**:
  - A real Microsoft Word document (`Approval_Note_Pump03.docx`) generated on-premise.
  - Open the file: Contains Subject, Background, Findings (92°C), Technical Analysis, Risk Assessment, Recommendations, Citation Audit Trail, and Signature Sign-Off Block.
  - Validates end-to-end industrial utility: transforms raw field reports into audit-ready statutory deliverables.

---

### Minute 4:30 — Multimodal Vision Analysis
- **Action**: Navigate to **Vision** (`/vision`).
- **Input**: Upload `documents/demo/Pump03_Vibration_Gauge.png`.
  - Prompt: *"Read the vibration gauge reading, asset identifier, and alert threshold."*
- **What Judge Sees**:
  - Routed to `moondream:latest` via local Model Router.
  - Observed Reading: **6.8 mm/s** (RMS velocity).
  - Threshold Detected: **4.5 mm/s** (ALARM EXCEEDED).
  - Explicit Governance Disclaimer: *"Visual AI analysis is advisory decision support. It does not replace certified engineer inspection or statutory sign-off."*

---

### Minute 5:00 — Sandboxed Coding Agent
- **Action**: Navigate to **Coding** (`/coding`).
- **Prompt**:
  > *"Write Python code to calculate pump efficiency given 45 kW hydraulic power output and 55 kW electrical power input."*
- **What Judge Sees**:
  - Code generated by `llama3.2:3b`.
  - Executed inside an ephemeral Docker container:
    - `--network none` (Zero internet/intranet access)
    - Non-root user (`1000:1000`)
    - Read-only root filesystem
    - 256 MB memory cap
  - Output displayed: `Efficiency: 81.82%`.
  - Proves dangerous arbitrary code execution is strictly isolated from host systems and internal databases.

---

### Minute 5:30 — Sovereignty Scorecard & Terminal Proof
- **Action**: Navigate to **Security** (`/security`).
- **What Judge Sees**:
  - Real-time audit dashboard showing component statuses:
    - Local LLM: `LOCAL` (Ollama `llama3.2:3b`)
    - Local Embeddings: `LOCAL` (ONNX `all-MiniLM-L6-v2`, 384D)
    - Vector Store: `SELF_HOSTED` (Qdrant `documents` collection)
    - Database: `SELF_HOSTED` (PostgreSQL 16)
    - OCR Engine: `LOCAL` (Tesseract)
    - External Cloud Keys: `NONE DETECTED` (0 cloud keys)
    - Sandbox Isolation: `ENFORCED` (`--network none`)
- **Live Terminal Verification**:
  ```bash
  npm run audit:sovereignty
  ```
  Returns:
  ```
  ========================================
  SOVEREIGNAI SOVEREIGNTY AUDIT
  ========================================
  LLM                 PASS
  EMBEDDINGS          PASS
  QDRANT              PASS
  POSTGRESQL          PASS
  OCR                 PASS
  MODEL GOVERNANCE    PASS
  TENANT ISOLATION    PASS
  EXTERNAL AI APIS    NONE REQUIRED

  OVERALL: PASS
  ```

---

### Minute 6:00 — Architecture Summary & Q&A
- **Core Architecture Recap**:
  - Self-contained Docker Compose stack.
  - Localhost loopback bindings on database/service ports (`127.0.0.1`).
  - Strict tenant boundary isolating cross-organization queries.
  - Deployable on air-gapped workstations or private company LANs.
