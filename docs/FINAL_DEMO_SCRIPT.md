# SovereignAI — Final Judge Demo Script (5–7 Minutes)

**Target Audience:** SIH Judges, Technical Evaluators, Industry Experts  
**Theme:** Sovereign On-Premise Industrial AI for Confidential Operations (MRPL Problem Statement)  
**Primary UI URL:** `http://localhost:5173`  
**Core Value Proposition:** *"SovereignAI converts confidential industrial documents into grounded, auditable engineering decisions without sending sensitive data to external AI services."*

---

## Timeline & Step-by-Step Flow

### [0:00 – 0:30] Introduction: The Industrial Sovereignty Problem
- **Spoken Delivery:**
  > *"In process industries like MRPL, inspection reports, ultrasonic thickness logs, and refinery SOPs contain sensitive infrastructure details and statutory compliance data. Uploading this data to public cloud AI vendors violates corporate cybersecurity policies. At the same time, manual cross-referencing between equipment inspection findings and hundreds of SOP clauses takes days and risks human error. SovereignAI solves both challenges: a private, self-hosted AI workbench running 100% locally."*

---

### [0:30 – 1:00] Screen 1: Real-Time Sovereignty Audit (`/security`)
- **Action:** Navigate to **Security** (`/security`).
- **Visuals on Screen:**
  - Status badge: `Operational · Sovereign`.
  - External Cloud AI APIs counter: **0**.
  - Local AI Component Stack cards:
    - **Local LLM:** Ollama (`llama3.2:3b`) running on-premise.
    - **Local Embeddings:** Xenova ONNX MiniLM (`384D`).
    - **Vector Database:** Self-hosted Qdrant with 30,969 vectors.
    - **Local OCR:** Tesseract OCR binary.
    - **Database:** PostgreSQL 16.
- **Spoken Delivery:**
  > *"Here on the Security & Sovereignty dashboard, judges can verify live runtime telemetry. Zero external cloud AI API keys are configured. All inference, vectorization, and storage execute on dedicated local infrastructure. The diagnostic manifest proves that all data processing boundaries remain completely inside the appliance."*

---

### [1:00 – 2:00] Screen 2: Evidence-Grounded Document Intelligence (`/chat`)
- **Action:** Navigate to **AI Search** (`/chat`).
- **Query Prompt:**
  ```text
  What are the safety and isolation requirements before performing maintenance on rotating equipment?
  ```
- **Visuals on Screen:**
  - Grounded answer displayed.
  - Verbatim citations citing `Demo_Safety_SOP.pdf` (Page 2, lockout/tagout procedure).
  - Source similarity scores and exact chunk text.
- **Spoken Delivery:**
  > *"When an engineer queries internal documentation, SovereignAI generates a grounded answer with precise source citations. Every claim links to an exact document, page, and chunk score. Notice that it does not hallucinate: citations are verified against actual chunks in the self-hosted Qdrant vector database."*

---

### [2:00 – 3:00] Screen 3: Autonomous LangGraph Agent (`/agent`)
- **Action:** Navigate to **Agent Workspace** (`/agent`).
- **Prompt:** Click suggestion:
  ```text
  Calculate 15 * 6 using calculator
  ```
  *(Or: "Search internal documents for bearing temperature limits and summarize findings.")*
- **Click:** `[ ⚡ Run Agent ]`.
- **Visuals on Screen:**
  - Status changes to `Executing Plan` with live pulsing telemetry.
  - **Live Activity Stream:** Real-time backend Server-Sent Events (SSE) stream into view:
    - `Agent initialized (LangGraph engine)`
    - `Reasoning & planning next action (Step 1)`
    - `Invoking tool: calculator`
    - `Tool 'calculator' completed successfully (Result: 90)`
    - `Tool output validated`
    - `Final answer compiled`
  - Synthesis output displayed: `"The result of 15 * 6 is 90."`
  - Persistent run history on the right sidebar updates from PostgreSQL (`GET /api/v1/agent/runs`).
- **Spoken Delivery:**
  > *"This is our autonomous tool agent powered by a LangGraph StateGraph. The activity stream is not an animation—it is driven by real Server-Sent Events from the Node.js backend. The agent plans, executes whitelisted tools, validates the output, and terminates safely. Furthermore, every step and metric is durably persisted in PostgreSQL."*

---

### [3:00 – 4:30] Screen 4: MRPL Inspection Agent Golden Path ⭐ (`/inspection`)
- **Action:** Click **Inspection Pipeline** tab or navigate to `/inspection`.
- **Select Document:** `Synthetic_Inspection_Report_Demo.pdf` (or click `+ Upload PDF`).
- **Directive:** `"Analyze this inspection report and extract all significant findings."`
- **Click:** `[ ⚡ Run Inspection Analysis ]`.
- **Visuals on Screen:**
  - Real-time SSE stage progression:
    1. `Ingesting & indexing inspection document`
    2. `Retrieving relevant document chunks`
    3. `Extracting structured findings with verbatim evidence`
    4. `Validating findings schema & integrity`
    5. `Searching internal SOP knowledge base in Qdrant`
    6. `Evaluating SOP evidence sufficiency`
    7. `Assessing equipment operational risk`
    8. `Validating risk assessment schema`
    9. `Verifying citations & anti-hallucination check`
    10. `Compiling audit-ready Approval Note DOCX`
  - Structured Finding Cards appear:
    - Finding 1: Bearing temperature `92 °C` vs Limit `80 °C` on `P-101 Process Pump` with verbatim quote.
    - Finding 2: Abnormal vibration `6.8 mm/s RMS` vs Limit `4.5 mm/s RMS`.
    - Finding 3: Inadequate lubrication observed.
  - Operational Risk Assessment: `HIGH / MEDIUM` with operating limit justification.
  - Corrective Recommendation grounded in `SOP-MAINT-001`.
  - **Official Approval Note Card:** `Approval_Note_127a43a0-a49f-434e-8deb-2fb106d1f599.docx`.
- **Spoken Delivery:**
  > *"Here is the flagship workflow for MRPL. In seconds, the agent parses the equipment inspection report, extracts structured anomalies, validates the evidence quotes, searches our SOP vector collection, assesses operational risk, and produces actionable recommendations. If SOP evidence were absent, it would safely halt with an explicit Insufficient Evidence alert rather than guessing."*

---

### [4:30 – 5:00] Deliverable: Download Approval Note DOCX
- **Action:** Click `[ 📥 Download DOCX ]`.
- **Visuals:** Browser downloads the generated Word document.
- **Spoken Delivery:**
  > *"With one click, an audit-ready Approval Note DOCX is generated and downloaded. It contains the exact equipment parameters, verbatim evidence, cited SOP standards, and risk classification ready for plant manager sign-off."*

---

### [5:00 – 5:30] Technical Governance & Closing
- **Spoken Delivery:**
  > *"To summarize: SovereignAI provides:
  > 1. Complete data sovereignty: 0 external cloud AI API dependencies.
  > 2. LangGraph stateful orchestration: bounded retries, evidence validation, and safe failure.
  > 3. Multi-tenant isolation: strict organization scoping and parameterized SQL.
  > 4. Secure code execution: Docker sandbox with network disabled and hard resource bounds.
  > 5. Full observability: durable PostgreSQL state and real-time SSE streaming.
  > 
  > SovereignAI enables industrial operators to automate technical inspection workflows with complete regulatory confidence. Thank you."*
