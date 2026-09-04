# SovereignAI — SIH Judge Demonstration Guide

**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Project:** SovereignAI — On-Premise Agentic AI Workbench using Open-Weight Multimodal LLMs for Confidential Industrial Work  
**Target Audience:** SIH Evaluators, Technical Judges, MRPL Plant Engineering Leadership  

---

## 1. Problem Statement & Industrial Context

Mangalore Refinery and Petrochemicals Limited (MRPL) operates continuous crude distillation, hydrocracking, and petrochem units where equipment health is critical to safety and profitability. Daily inspection rounds generate vast amounts of mechanical inspection logs, vibration reports, and non-destructive testing (NDT) data.

### Why Cloud AI Is Unacceptable in Industrial Refining:
1. **Critical Infrastructure Confidentiality:** Plant schematics, operating limits, and equipment degradation data are sensitive industrial assets that cannot be transmitted to commercial public clouds (e.g. OpenAI, Microsoft, Google) under Indian critical information infrastructure policies.
2. **Air-Gapped Refinery Networks:** SCADA and Distributed Control Systems (DCS) operate in strictly segregated, air-gapped security zones (ISA-99 / IEC 62443 Level 3/4) with zero outbound internet access.
3. **Hallucination Liability:** In an industrial plant, a hallucinated bearing limit or incorrect torque spec could lead to catastrophic equipment failure or human injury.
4. **Human Authority Boundary:** An AI system must never autonomously sign off on plant maintenance; decisions must be advisory, evidence-backed, and require explicit human engineering sign-off.

---

## 2. SovereignAI Solution Architecture

SovereignAI runs **100% on-premise** on local workstation or edge server hardware:

```text
                        OPERATOR WORKSTATION (Browser)
                                      │
                                      ▼
                      [ Frontend UI : React 19 + Vite ]
                                      │
                                      ▼
                      [ Backend Gateway : Express.js ]
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
[ PostgreSQL 16 ]            [ Qdrant Vector DB ]        [ AI Service Engine ]
• Users & Multi-Tenant Org   • 384-dim Dense Embeddings  • Task Router
• Document Metadata          • Page-Aware Chunk Vectors  • Local LLM (llama3.2:3b)
• Persisted Reports & Chat   • Cosine Similarity Metric  • Local Vision (moondream)
                                                         • Local OCR (Tesseract 5.5.2)
                                                         • Ephemeral Coding Sandbox
```

---

## 3. Two-Minute Pitch for Judges

> *"Respected Judges, SovereignAI is a 100% on-premise, air-gapped AI workbench built specifically for confidential refinery engineering at MRPL. Unlike commercial AI tools that require internet connectivity and leak proprietary data to third-party clouds, SovereignAI performs all language inference, multimodal vision, document OCR, and vector retrieval on local hardware with zero external API calls.*
>
> *When an engineer uploads an inspection report, our LangGraph agent extracts observations, searches authoritative company Standard Operating Procedures (SOPs), calculates risk levels, produces grounded advisory recommendations with exact page-level citations, and compiles an official Approval Note DOCX for human sign-off. Furthermore, our Model Router directs engineering code calculations to an ephemeral, air-gapped Docker sandbox with zero network access. SovereignAI guarantees full data sovereignty, zero hallucinated citations, and strict human engineering governance."*

---

## 4. Five-Minute Live Demonstration Script

### Step 1: Prove Sovereignty & Zero Cloud Calls (30 Seconds)
1. In the Web UI, open the **System Health & Sovereignty** badge.
2. Show the live JSON manifest (`GET /api/v1/sovereignty`):
   - External Cloud AI APIs: **0**
   - LLM: `llama3.2:3b` (Local Ollama daemon)
   - Vision: `moondream:latest` (Local Ollama daemon)
   - Embeddings: `all-MiniLM-L6-v2` (Local ONNX)
   - OCR: `Tesseract 5.5.2` (Local system binary)
3. Highlight: Even if the network cable is unplugged, the entire system continues to operate seamlessly.

### Step 2: Golden Path Inspection Agent Demo (90 Seconds)
1. **Upload Synthetic Inspection Document:** `Inspection_Report_Pump03.pdf`
2. Point out:
   - Asset: `Process Pump P-101 / Pump-03`
   - Observed Bearing Temperature: **92 °C**
   - Observed Vibration: **6.8 mm/s RMS**
3. Launch the **LangGraph Inspection Agent**:
   - Watch real-time SSE stream nodes: `read_document` $\rightarrow$ `extract_findings` $\rightarrow$ `retrieve_sop` $\rightarrow$ `analyze_findings` $\rightarrow$ `assess_risks` $\rightarrow$ `generate_recommendations` $\rightarrow$ `human_review` $\rightarrow$ `generate_docx`.
4. Point out the findings:
   - Agent cites authoritative `Maintenance_SOP.pdf`: *"Normal bearing operating limit is up to 80 °C."*
   - Calculated Risk: **HIGH** (92 °C exceeds 80 °C limit).
   - Advisory Recommendation: *"Record temperature, inspect bearing immediately, check lubrication."*
   - Human Governance Notice: *"This recommendation is advisory decision support. Final operational approval remains with the certified plant engineer."*
5. Click **Download Approval Note (.docx)**: Show the generated official corporate report.

### Step 3: Failure / Safe Refusal Demo (60 Seconds)
1. Open the AI Chat interface.
2. Ask an unanswerable question:
   > *"What is the chemical composition of Pump-03 lubricant?"*
3. Observe the response:
   - System returns: *"The provided context does not contain information about the chemical composition of Pump-03 lubricant."*
4. Explain to the judge:
   - Many AI models hallucinate believable chemical formulas (e.g. *"Polyalphaolefin synthetic ester..."*).
   - SovereignAI enforces strict grounded RAG with citation validation; when facts are absent, it safely refuses.

### Step 4: Multimodal Vision Demo (40 Seconds)
1. Upload a photograph of an industrial pressure gauge (`gauge_reading.png`).
2. Prompt: *"What pressure reading and label are visible?"*
3. Watch the Model Router automatically detect `TASK_TYPE.VISION` and invoke local `moondream:latest`.
4. Response: Detects **"42 PSI"** in under 5 seconds with zero external cloud calls.

### Step 5: Secure Coding Sandbox Demo (40 Seconds)
1. Request: *"Write Python code to calculate pump efficiency."*
2. Watch the Model Router classify `TASK_TYPE.CODING` and dispatch to the isolated sandbox.
3. Show execution output:
   - Computed: `PUMP_EFFICIENCY: 75.0%`
   - Execution time: ~260 ms
   - Network constraint: `--network none` (impervious to egress attacks)

---

## 5. Key Differentiators

| Feature | SovereignAI | Generic Cloud Chatbot (ChatGPT / Claude) | Generic Enterprise AI |
|---|---|---|---|
| **Data Sovereignty** | 100% On-Premise; 0 bytes leave host | Data transmitted to external cloud servers | Hosted on commercial cloud (AWS/Azure) |
| **Air-Gap Compliance** | Operates with no internet connection | Fails completely without internet | Requires cloud egress |
| **Hallucination Defense**| Verbatim citation cross-referencing | Unpredictable hallucinations | Best-effort heuristic |
| **Code Execution** | Ephemeral Docker sandbox (`--network none`) | Remote cloud execution or unisolated | Often unconstrained |
| **Human Authority** | Advisory workflow with formal approval boundary | Direct conversational answer | Unstructured output |

---

## 6. Honest Appraisal of Known Limitations

To maintain credibility during technical questioning, openly acknowledge:
1. **Physical Air-Gap Boundary:** Application-level offline capability is verified; physical air-gapping requires plant-level cable/switch isolation.
2. **Docker Socket Mounting:** Backend container orchestrates sandboxes via Docker socket; production hardening roadmap recommends deploying `docker-socket-proxy`.
3. **Host Port Bindings:** Development compose exposes PostgreSQL and Qdrant host ports; production runbook provides `docker-compose.prod.yml` where data stores are strictly internal.
4. **Optical Limits:** Vision analysis reads digital dials and visible tags; subsurface metallographic crack propagation requires specialized NDT ultrasonic sensors.
