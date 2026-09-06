# SovereignAI — Demonstration Guide

> **SovereignAI**: Private AI for Confidential Industrial Work.  
> 100% On-Premise · Local LLM · Self-Hosted Vector Store · Sandboxed Code Execution · Zero External AI APIs.

---

## 1. Prerequisites

- **Docker Engine**: v24.0+ with Docker Compose v2.20+
- **Memory**: 16 GB RAM minimum (32 GB recommended for concurrent multi-tenant loads)
- **Local Models** (Pre-pulled via Ollama):
  - `llama3.2:3b` (General reasoning, RAG, inspection, coding)
  - `moondream:latest` (Multimodal vision analysis)
- **Local Ports Available**:
  - `5173` (Frontend UI)
  - `9000` (Backend API)
  - Internal microservice ports (`5433`, `6333`, `5001`, `11435`) bind safely to `127.0.0.1`

---

## 2. Quick Start Command

Start the complete sovereign stack with health verification:

```bash
# Automated local deployment script (recommended)
./scripts/deploy-local.sh
```

Or via standard Docker Compose:

```bash
docker compose up -d
```

Open your browser to: **`http://localhost:5173`**

---

## 3. Demo Credentials

Pre-seeded evaluation credentials (created automatically during database initialization):

| Role | Email Address | Password | Organization / Tenant |
| :--- | :--- | :--- | :--- |
| **Lead Engineer** | `engineer@example.com` | `DemoPassword123!` | Enterprise Plant Alpha |
| **Plant Administrator**| `admin@example.com` | `DemoPassword123!` | Enterprise Plant Alpha |

*(New accounts can also be registered instantly on the `/login` screen under any arbitrary company tenant.)*

---

## 4. Recommended Demo Sequence

Follow this proven 5–7 minute evaluation path:

```
Step 1: Landing Page (http://localhost:5173)
        ↓ Review sovereignty claim: "Private AI for Confidential Industrial Work"
Step 2: Login (/login)
        ↓ Use: engineer@example.com / password123
Step 3: Document Ingestion (/documents)
        ↓ Upload: documents/demo/Pump03_Inspection.pdf & Maintenance_SOP.pdf
Step 4: Grounded RAG Query (/chat)
        ↓ Ask: "What was the observed bearing temperature of Pump-03?"
        ↓ Verify: Cites 92°C with source Inspection_Report_Pump03.pdf (Page 1)
Step 5: Anti-Hallucination Safe Refusal (/chat)
        ↓ Ask: "What was the exact maintenance budget for Pump-03 last year?"
        ↓ Verify: Safe refusal ("I don't have sufficient information in the documents...")
Step 6: Inspection Agent & Approval Note (/agent)
        ↓ Trigger automated analysis on Pump-03 inspection report
        ↓ Watch live SSE pipeline: Extract -> SOP Search -> Risk -> Recommendation
        ↓ Download generated statutory Approval Note DOCX
Step 7: Multimodal Vision (/vision)
        ↓ Upload: documents/demo/Pump03_Vibration_Gauge.png
        ↓ Model: moondream (local) detects 6.8 mm/s reading & alarm threshold
Step 8: Sandboxed Coding Agent (/coding)
        ↓ Prompt: "Write Python code to calculate pump efficiency"
        ↓ Verify execution inside Docker container (--network none, non-root)
Step 9: Sovereignty & Security Scorecard (/security)
        ↓ View live machine-readable manifest: 100% Local LLM, ONNX, Qdrant, OCR
```

---

## 5. Stop Command

Gracefully shut down all containers without deleting persistent database volumes:

```bash
docker compose down
```

> [!CAUTION]
> **DO NOT run `docker compose down -v`**. Flag `-v` deletes persistent storage containing indexed vectors and database history.

---

## 6. Troubleshooting

- **Ollama connection error (`ECONNREFUSED 11434`)**:
  - If running Ollama natively on macOS: ensure `ollama serve` is active.
  - If running Ollama inside Docker: ensure container `sovereign-ai-ollama` is healthy (`docker compose ps`).
- **PostgreSQL port collision**:
  - The stack maps internal port `5432` to host port `5433` (`127.0.0.1:5433`), avoiding conflicts with local PostgreSQL instances.
- **Inspect Service Logs**:
  ```bash
  docker compose logs -f backend
  docker compose logs -f ai-service
  ```
- **Run Live Sovereignty Audit**:
  ```bash
  npm run audit:sovereignty
  ```
