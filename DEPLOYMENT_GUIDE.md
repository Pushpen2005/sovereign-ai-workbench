# SovereignAI Deployment & Operational Runbook

**Target Platform:** On-Premise Industrial Workstation / Edge Server  
**SIH Problem Statement:** 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Security Standard:** Zero-Cloud On-Premise Air-Gapped Operation  

---

## 1. System Architecture

```text
                    OPERATOR BROWSER / CLIENT
                                │
                                ▼
                   [ Frontend : Port 5173 ]
                   (React 19 + Vite 8 Nginx)
                                │
                                ▼
                   [ Backend : Port 9000 ]
                     (Express.js + Node 22)
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
[ PostgreSQL 16 ]       [ Qdrant Vector DB ]   [ AI Service : 5001 ]
   (Port 5433)              (Port 6333)        (FastAPI / Express)
                                                      │
                                                      ▼
                                              [ Ollama : 11434 ]
                                              (llama3.2 + moondream)
```

---

## 2. Prerequisites & Hardware Requirements

- **OS:** Linux (Ubuntu 22.04 LTS / RHEL 9 recommended) or macOS (Apple Silicon supported).
- **RAM:** 16 GB minimum (32 GB recommended for concurrent heavy LLM + Vision pipelines).
- **Disk:** 30 GB available SSD storage (for Docker images, vector store, and model weights).
- **Docker Engine:** Docker 24.0+ with Docker Compose v2.20+.
- **Ollama:** Installed either as a host daemon or running within Compose.

---

## 3. Environment Configuration

1. Copy the provided template to create `.env`:
   ```bash
   cp .env.example .env
   ```

2. Key Configuration Variables:
   ```ini
   PORT=9000
   QDRANT_URL=http://qdrant:6333
   OLLAMA_URL=http://host.docker.internal:11434
   OLLAMA_MODEL=llama3.2:3b
   DEFAULT_MODEL=llama3.2:3b
   DOCUMENT_MODEL=llama3.2:3b
   CODING_MODEL=llama3.2:3b
   VISION_MODEL=moondream
   POSTGRES_HOST=postgres
   POSTGRES_PORT=5432
   POSTGRES_USER=workbench
   POSTGRES_PASSWORD=workbench_secret
   POSTGRES_DB=workbench_db
   JWT_SECRET=your-secure-random-jwt-secret-string
   CORS_ORIGIN=http://localhost:5173
   ```

---

## 4. Local Model Setup (One-Time Preparation)

Before running in an air-gapped environment, pull the required open-weight models:

```bash
# 1. Text inference model (General, Document, Coding)
ollama pull llama3.2:3b

# 2. Multimodal vision model (Industrial image inspection)
ollama pull moondream

# Verify local availability
ollama list
```

---

## 5. Deployment with Docker Compose

Launch the complete 6-service stack in detached mode:

```bash
docker compose up -d --build
```

### Verify Service Health:
```bash
docker compose ps
```
All 6 services must report `Up (healthy)`:
- `sovereign-ai-frontend` (Port 5173)
- `sovereign-ai-backend` (Port 9000)
- `sovereign-ai-service` (Port 5001)
- `sovereign-ai-postgres` (Port 5433)
- `sovereign-ai-qdrant` (Port 6333)
- `sovereign-ai-ollama` (Port 11435)

---

## 6. Access & User Authentication

### Default Web UI:
Navigate to: `http://localhost:5173`

### Demo Account Credentials:
- **Email:** `demo@sovereign.local`
- **Password:** `DemoUser2026!`
- **Organization:** `Demo Organization`

### API Authentication:
Obtain a Bearer JWT by calling:
```bash
curl -X POST http://localhost:9000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@sovereign.local","password":"DemoUser2026!"}'
```

---

## 7. Core Workflows

### A. Document Upload & Ingestion:
```bash
curl -X POST http://localhost:9000/api/v1/inspection/upload \
  -F "document=@/path/to/inspection_report.pdf"
```

### B. Grounded RAG Query:
```bash
curl -X POST http://localhost:9000/api/v1/chat/ask \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the maximum allowable bearing temperature in the SOP?"}'
```

### C. Visual Inspection Analysis:
```bash
curl -X POST http://localhost:9000/api/v1/vision/analyze \
  -H "Authorization: Bearer <TOKEN>" \
  -F "image=@/path/to/pressure_gauge.png" \
  -F "prompt=What pressure reading and label are visible on this gauge?"
```

### D. Secure Coding Sandbox:
```bash
curl -X POST http://localhost:9000/api/v1/coding/execute \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"code":"print(sum([x**2 for x in range(10)]))"}'
```

---

## 8. Backup & Disaster Recovery

### Relational Database Backup (PostgreSQL):
```bash
# Export non-destructive SQL dump
docker exec sovereign-ai-postgres pg_dump -U workbench -d workbench_db > backup_$(date +%F).sql

# Restore from SQL dump
docker exec -i sovereign-ai-postgres psql -U workbench -d workbench_db < backup_2026-09-03.sql
```

### Vector Database Snapshot (Qdrant):
```bash
# Trigger collection snapshot
curl -X POST http://localhost:6333/collections/documents/snapshots

# Download snapshot archive
curl -O http://localhost:6333/collections/documents/snapshots/<SNAPSHOT_NAME>
```

### Document Storage Backup:
```bash
# Archive raw uploaded documents and generated DOCX reports
tar -czf uploads_backup.tar.gz -C backend/src/uploads .
tar -czf reports_backup.tar.gz -C backend/generated .
```

---

## 9. Troubleshooting & Diagnostics

1. **Model Connection Errors:**
   Verify host resolution:
   `curl -s http://localhost:11434/api/tags`
   If backend cannot reach Ollama, verify `OLLAMA_URL` in `.env` is set to `http://host.docker.internal:11434`.

2. **Database Connectivity:**
   Check PostgreSQL logs:
   `docker logs sovereign-ai-postgres`

3. **Qdrant Vector Points Count:**
   `curl -s http://localhost:6333/collections/documents | jq .result.points_count`

4. **Sovereignty Manifest Audit:**
   `curl -s http://localhost:9000/api/v1/sovereignty | jq .`
