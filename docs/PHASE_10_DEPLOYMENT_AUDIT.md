# SovereignAI — Phase 10 Deployment Audit

**Audit Date:** September 3, 2026  
**Auditor:** SovereignAI Deployment Engineering  
**Stack:** React 19 / Vite 8 + Express / Node.js 22 + PostgreSQL 16 + Qdrant + Ollama  
**Status:** 100% Code & Runtime Verified  

---

## 1. Current Architecture Overview

SovereignAI runs as a multi-tier microservice architecture coordinated by Docker Compose (`docker-compose.yml`):

1. **`frontend` (sovereign-ai-frontend):**
   - **Base:** `nginx:alpine` serving pre-built Vite production bundle.
   - **Exposed Port:** Host `5173` $\rightarrow$ Container `80`.
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** `wget -qO- http://127.0.0.1/ || exit 1` (Interval: 10s).
   - **Dependency:** `backend` (service_healthy).

2. **`backend` (sovereign-ai-backend):**
   - **Base:** `node:22-bookworm-slim` with system Tesseract OCR, Python 3, `python-docx`, Docker CLI, and Cairo/Pango graphics libraries.
   - **Exposed Port:** Host `9000` $\rightarrow$ Container `9000`.
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** `curl -f http://localhost:9000/api/v1/health || exit 1` (Interval: 10s).
   - **Dependencies:** `postgres` (service_healthy), `qdrant` (service_healthy), `ai-service` (service_healthy).
   - **Volumes:** `uploads_data` (`/app/backend/src/uploads`), `reports_data` (`/app/backend/generated`), `/var/run/docker.sock` (for isolated sandbox).

3. **`ai-service` (sovereign-ai-service):**
   - **Base:** `node:22-bookworm-slim` with Tesseract OCR, Python 3, `python-docx`, and Xenova ONNX embeddings.
   - **Exposed Port:** Host `5001` $\rightarrow$ Container `5001`.
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** `curl -f http://localhost:5001/health || exit 1` (Interval: 10s).
   - **Dependency:** `qdrant` (service_healthy).

4. **`postgres` (sovereign-ai-postgres):**
   - **Base:** `postgres:16-alpine`.
   - **Exposed Port:** Host `5433` $\rightarrow$ Container `5432`.
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** `pg_isready -U workbench -d workbench_db` (Interval: 5s).
   - **Volume:** `postgres_data` (`/var/lib/postgresql/data`).

5. **`qdrant` (sovereign-ai-qdrant):**
   - **Base:** `qdrant/qdrant:latest`.
   - **Exposed Ports:** Host `6333:6333` (REST), `6334:6334` (gRPC).
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** TCP/HTTP socket check querying `/readyz` (Interval: 5s).
   - **Volume:** `qdrant_storage` (`/qdrant/storage`).

6. **`ollama` (sovereign-ai-ollama):**
   - **Base:** `ollama/ollama:latest`.
   - **Exposed Port:** Host `11435` $\rightarrow$ Container `11434`.
   - **Internal Network:** `sovereign_net`.
   - **Healthcheck:** `ollama list || exit 1`.
   - **Host Accelerator:** `backend` and `ai-service` connect via `http://host.docker.internal:11434`, leveraging Apple Silicon Metal GPU acceleration without re-downloading model weights into the container.

---

## 2. Environment Variables & Security Hygiene

- **`.env` Ignored by Git:** Verified `.gitignore` in root excludes `.env`, `.env.local`, and `*.env`.
- **`.env.example` Baseline:** Contains generic development placeholders (`workbench`, `workbench_secret`) with zero production API tokens.
- **Frontend `VITE_*` Audit:** The only `VITE_` variable is `VITE_API_BASE_URL=http://localhost:9000`. No database passwords, JWT secrets, or tokens are exposed to the client bundle.
- **Backend Secrets:** PostgreSQL and internal service URLs are configured exclusively inside the backend and AI-service container environment.
