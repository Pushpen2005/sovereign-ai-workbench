# SovereignAI — Phase 10: Docker & Deployment Verification

**Phase:** Phase 10 — Docker & Deployment Verification  
**Date:** September 3, 2026  
**Status:** Completed, Verified & 100% Reproducible  
**Verified On:** macOS (Darwin ARM64 / Apple Silicon) + Docker Engine 28.0.4 + Docker Compose v2.33.1  

---

## 1. Deployment Architecture Summary

SovereignAI operates as a fully containerized, sovereign industrial AI appliance:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           HOST ENVIRONMENT                                │
│                                                                           │
│   Browser / Client (Port 5173) ──► Host Ollama (Port 11434 / Metal GPU)   │
│                 │                                                         │
│                 ▼                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    DOCKER COMPOSE APPLIANCE                         │  │
│  │                                                                     │  │
│  │   frontend (Port 80 -> 5173)                                        │  │
│  │         │                                                           │  │
│  │         ▼                                                           │  │
│  │   backend (Port 9000) ───────────────┬──────────────────────────┐   │  │
│  │         │                            │                          │   │  │
│  │         ▼                            ▼                          ▼   │  │
│  │   postgres (Port 5432)        qdrant (Port 6333)       ai-service   │  │
│  │   [postgres_data volume]     [qdrant_storage volume]   (Port 5001)  │  │
│  │         │                            │                          │   │  │
│  │         ▼                            ▼                          ▼   │  │
│  │   agent_runs / reports        30,969 vectors             ONNX MiniLM │  │
│  │                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Service Inventory & Runtime Specs

| Service | Container Name | Image / Build | Port Mappings | Volume Mounts | Healthcheck |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **frontend** | `sovereign-ai-frontend` | `frontend/Dockerfile` (nginx:alpine) | `5173:80` | None (static assets bundled) | `wget -qO- http://127.0.0.1/` |
| **backend** | `sovereign-ai-backend` | `backend/Dockerfile` (node:22) | `9000:9000` | `uploads_data`, `reports_data`, `/var/run/docker.sock` | `curl -f http://localhost:9000/api/v1/health` |
| **ai-service** | `sovereign-ai-service` | `ai-service/Dockerfile` (node:22) | `5001:5001` | None | `curl -f http://localhost:5001/health` |
| **postgres** | `sovereign-ai-postgres` | `postgres:16-alpine` | `5433:5432` | `postgres_data:/var/lib/postgresql/data` | `pg_isready -U workbench -d workbench_db` |
| **qdrant** | `sovereign-ai-qdrant` | `qdrant/qdrant:latest` | `6333:6333`, `6334:6334` | `qdrant_storage:/qdrant/storage` | TCP socket check `/readyz` |
| **ollama** | `sovereign-ai-ollama` | `ollama/ollama:latest` | `11435:11434` | `ollama_data:/root/.ollama` | `ollama list` |

---

## 3. Qdrant & PostgreSQL Persistence Verification (Step 14)

A non-destructive container lifecycle test (`docker compose down` followed by `docker compose up -d`) was executed against the running database and vector index.

### Experimental Persistence Results:

| Storage Layer | Entity / Metric | Pre-Restart Count | Post-Restart Count | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Qdrant Vector DB** | Collection: `documents` | 30,969 points | 30,969 points | **100% Preserved** |
| **Qdrant Vector DB** | Vectors Dimension & Metric | 384D Cosine | 384D Cosine | **100% Preserved** |
| **PostgreSQL 16** | `documents` | 48 records | 48 records | **100% Preserved** |
| **PostgreSQL 16** | `reports` (Approval Notes) | 30 records | 30 records | **100% Preserved** |
| **PostgreSQL 16** | `agent_runs` (LangGraph state) | 10 records | 10 records | **100% Preserved** |
| **PostgreSQL 16** | `agent_run_steps` (Traces) | 21 records | 21 records | **100% Preserved** |
| **PostgreSQL 16** | `conversations` | 20 records | 20 records | **100% Preserved** |
| **PostgreSQL 16** | `messages` | 68 records | 68 records | **100% Preserved** |

Zero data loss occurred. All database tables, indexes, and vector points survived container recreation.

---

## 4. End-to-End Live Verification Results

Each platform capability was verified directly against the live Docker deployment:

1. **Frontend Production Serving:** `HTTP 200 OK` via NGINX on `http://localhost:5173/`.
2. **Backend API Health:** `HTTP 200 OK` on `http://localhost:9000/api/v1/health` returning `{"status":"ok"}`.
3. **Sovereignty Manifest:** `GET /api/v1/sovereignty` returned `status: "sovereign"`, 0 external cloud AI keys, and healthy reachability for local LLM, embeddings, OCR, and Qdrant.
4. **Documents API:** `GET /api/v1/documents` returned all 48 indexed documents.
5. **Approval Notes Repository:** `GET /api/v1/reports` returned 30 generated reports.
6. **Approval Note DOCX Download:** `GET /api/v1/inspection/download/Approval_Note.docx` returned `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` (40,045 bytes).
7. **RAG Conversational Query:** `POST /api/v1/chat/ask` retrieved 4 matching chunks from Qdrant (`score: 0.5515`) and routed to `llama3.2:3b`.
8. **LangGraph Autonomous Agent Loop:** `POST /api/v1/agent/run` successfully executed multi-step tool calls, validated outputs, and wrote the trace into PostgreSQL.
9. **Isolated Coding Sandbox:** `POST /api/v1/coding/execute` executed dynamic Python 3.11 code in an isolated Docker container with `--network none`, `memory: 256m`, and `cpu: 1`.

---

## 5. System Resource Footprint

Measured via `docker stats --no-stream` across all 6 services:

| Container | CPU Usage | Memory Usage | Memory % |
| :--- | :--- | :--- | :--- |
| `sovereign-ai-frontend` | 0.00% | 8.8 MB | 0.11% |
| `sovereign-ai-backend` | 0.00% | 142.1 MB | 1.79% |
| `sovereign-ai-service` | 0.16% | 37.8 MB | 0.48% |
| `sovereign-ai-postgres` | 0.03% | 24.4 MB | 0.31% |
| `sovereign-ai-qdrant` | 2.33% | 317.8 MB | 4.01% |
| `sovereign-ai-ollama` | 0.00% | 19.7 MB | 0.25% |
| **Total Docker Stack** | **~2.5%** | **~550 MB** | **~7%** |

*Note: Active LLM inference runs on host Ollama using ~2.2 GB of unified memory for `llama3.2:3b`.*  
The total stack runs comfortably within 8GB RAM on a standard developer laptop.

---

## 6. Startup & Run Instructions

```bash
# 1. Clone repository
git clone <repository_url>
cd sovereign-ai-workbench

# 2. Configure environment (if not already present)
cp .env.example .env

# 3. Ensure host Ollama has the model pulled
ollama pull llama3.2:3b

# 4. Start all services with Docker Compose
docker compose up -d

# 5. Check container health status
docker compose ps

# 6. Access the SovereignAI Workbench
# Frontend:  http://localhost:5173
# Backend:   http://localhost:9000
# Qdrant UI: http://localhost:6333/dashboard
```
