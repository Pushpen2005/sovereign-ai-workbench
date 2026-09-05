# SovereignAI — On-Premise & Air-Gapped Deployment Guide

> **Enterprise On-Premise Installation, Offline Packaging & Disaster Recovery Runbook**  
> **Classification:** On-Premise / Air-Gapped Capable Deployment  
> **Target Audience:** Enterprise Infrastructure Engineers, DevOps, On-Premise Systems Administrators

---

## 1. Architecture & Deployment Overview

SovereignAI runs as a self-contained, microservice stack orchestrated by **Docker Compose**. All model weights, vector databases, relational persistence, and document processing execute strictly on-premise without external cloud telemetry or third-party AI APIs.

```
                    COMPANY LAN / INTRANET
                              │
                              ▼
                     SovereignAI Host Server
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
Frontend UI            Backend Gateway          AI Service
(Nginx :5173)          (Express :9000)        (Express :5001)
       │                      │                      │
       │                      ├──── PostgreSQL (:5433)
       │                      ├──── Qdrant Vector DB (:6333)
       │                      ├──── Ollama Local Daemon (:11434 / :11435)
       │                      └──── Isolated Docker Sandbox (--network none)
       │
       └──────── Enterprise Browser Clients
```

---

## 2. Hardware & Host Prerequisites

### Minimum vs Recommended Specifications

| Dimension | Minimum Development Host | Recommended Enterprise Production Host |
|---|---|---|
| **Operating System** | macOS 14+ (Apple Silicon) / Linux (x86_64) | Ubuntu 22.04 LTS / RHEL 9 (x86_64) |
| **CPU** | 8 Cores (Apple M-series or Intel/AMD) | 16+ Cores (x86_64 AVX2 / AVX-512) |
| **RAM** | 16 GB Unified Memory / RAM | 32 GB – 64 GB ECC RAM |
| **Storage** | 50 GB NVMe SSD | 250 GB+ High-IOPS NVMe SSD |
| **GPU Acceleration** | Apple Metal (Host Ollama) | NVIDIA GPU (Optional: 1x RTX 4090 or A10 / L4) |
| **Container Engine** | Docker Desktop 4.30+ / Docker 26+ | Docker Engine 26+ with Docker Compose v2.27+ |

---

## 3. Two-Stage Installation Model

Enterprise industrial deployments follow a strict two-stage procedure:
- **STAGE A (Online Preparation):** Download images, model weights, and npm/python dependencies while connected to an authorized network.
- **STAGE B (Offline Deployment):** Transfer assets via physical media or secure jumpbox to the air-gapped host, load images, and start the stack.

---

### STAGE A: Online Preparation (Staging Machine)

On an internet-connected workstation, pull and export all required Docker images and local model weights.

#### Step 1: Clone Repository
```bash
git clone https://github.com/Pushpen2005/sovereign-ai-workbench.git
cd sovereign-ai-workbench
```

#### Step 2: Build Application Docker Images
```bash
docker compose build
```

#### Step 3: Package Docker Images for Offline Transfer (`docker save`)
```bash
mkdir -p offline_bundle/images offline_bundle/models

docker save -o offline_bundle/images/sovereign_images.tar \
  sovereign-ai-workbench-backend:latest \
  sovereign-ai-workbench-ai-service:latest \
  sovereign-ai-workbench-frontend:latest \
  postgres:16-alpine \
  qdrant/qdrant:latest \
  ollama/ollama:latest \
  python:3.11-alpine
```

#### Step 4: Pull & Package Ollama Local Models
While internet is available, download the validated open-weight models:
```bash
ollama pull llama3.2:3b
ollama pull moondream:latest
```

Verify models in local Ollama storage:
```bash
ollama list
# Expected output:
# NAME              ID              SIZE      MODIFIED
# llama3.2:3b       a80c46757be5    2.0 GB    ...
# moondream:latest  55fc3abd3867    1.7 GB    ...
```

Export Ollama model directory (`~/.ollama` or docker volume `ollama_data`):
```bash
tar -czf offline_bundle/models/ollama_models.tar.gz -C ~/.ollama .
```

#### Step 5: Transfer Archive
Copy `offline_bundle/` and the repository directory to the target on-premise host via approved encrypted removable storage or secure enterprise jump host.

---

### STAGE B: Offline Air-Gapped Deployment (Production Host)

On the internal on-premise server with zero internet connection:

#### Step 1: Extract Source and Prepare Environment
```bash
cd /opt/sovereign-ai-workbench
cp .env.example .env
```

Review and adjust `.env` parameters:
- `JWT_SECRET`: Provide a unique, 32+ character random secret string.
- `POSTGRES_PASSWORD`: Provide a secure internal database password.
- `BIND_IP`: Set to `127.0.0.1` to restrict internal database exposure to localhost.

#### Step 2: Load Docker Images (`docker load`)
```bash
docker load -i /path/to/offline_bundle/images/sovereign_images.tar
```

#### Step 3: Populate Ollama Model Weights
Extract the pre-staged model weights into the local volume or host directory:
```bash
docker volume create ollama_data
docker run --rm -v ollama_data:/target -v /path/to/offline_bundle/models:/source alpine \
  tar -xzf /source/ollama_models.tar.gz -C /target
```

#### Step 4: Launch the Sovereign Stack
Run the automated deployment script:
```bash
./scripts/deploy-local.sh
```

The script automatically:
1. Verifies Docker Engine and Compose.
2. Validates `.env` and `docker-compose.yml`.
3. Creates persistent volumes (`postgres_data`, `qdrant_storage`, `uploads_data`, `reports_data`).
4. Starts containers with `docker compose up -d`.
5. Polls healthchecks until all 6 services report `healthy`.
6. Validates `/api/v1/health` and `/api/v1/security/status`.

---

## 4. Service Inventory & Port Architecture

| Service Name | Docker Container | Image | Port (Host -> Container) | Interface Binding | Purpose |
|---|---|---|---|---|---|
| **frontend** | `sovereign-ai-frontend` | `sovereign-ai-workbench-frontend` | `5173:80` | `0.0.0.0` (Client LAN) | Nginx SPA web application |
| **backend** | `sovereign-ai-backend` | `sovereign-ai-workbench-backend` | `9000:9000` | `0.0.0.0` (Client LAN) | Express API Gateway & LangGraph |
| **ai-service** | `sovereign-ai-service` | `sovereign-ai-workbench-ai-service` | `5001:5001` | `127.0.0.1` (Localhost) | Extraction, RAG & ONNX Embeddings |
| **postgres** | `sovereign-ai-postgres` | `postgres:16-alpine` | `5433:5432` | `127.0.0.1` (Localhost) | Multi-tenant relational persistence |
| **qdrant** | `sovereign-ai-qdrant` | `qdrant/qdrant:latest` | `6333:6333`, `6334:6334` | `127.0.0.1` (Localhost) | Self-hosted vector similarity database |
| **ollama** | `sovereign-ai-ollama` | `ollama/ollama:latest` | `11435:11434` | `127.0.0.1` (Localhost) | Local inference engine |

---

## 5. Persistent Storage & Named Volumes

SovereignAI enforces persistent storage across container restarts and updates:

| Named Volume | Container Mount Path | Stored Assets | Retention Policy |
|---|---|---|---|
| `postgres_data` | `/var/lib/postgresql/data` | Relational tables, organizations, users, document metadata, audit logs | Permanent (Survives container recreation) |
| `qdrant_storage` | `/qdrant/storage` | 384-dimensional dense vectors, HNSW index, collection configs | Permanent (Survives container recreation) |
| `uploads_data` | `/app/backend/src/uploads` | Original uploaded inspection PDFs, partitioned by tenant | Permanent |
| `reports_data` | `/app/backend/generated` | Compiled Approval Note DOCX deliverables | Permanent |
| `ollama_data` | `/root/.ollama` | Local LLM and Vision model weights (`llama3.2`, `moondream`) | Permanent |

> [!CAUTION]
> NEVER execute `docker compose down -v`. The `-v` flag instructs Docker to destroy persistent volumes. Normal maintenance and shutdowns should use `docker compose stop` or `docker compose down` (without flags).

---

## 6. Health Checks & Startup Order

Container dependencies are orchestrated via `condition: service_healthy`:
- `qdrant` waits on TCP probe to `/readyz`.
- `postgres` waits on `pg_isready -U workbench -d workbench_db`.
- `ai-service` depends on `qdrant: service_healthy`.
- `backend` depends on `postgres: service_healthy`, `qdrant: service_healthy`, and `ai-service: service_healthy`.
- `frontend` depends on `backend: service_healthy`.

---

## 7. Operational Backup & Disaster Recovery

### Backup Execution
Run the automated backup script to create a timestamped archive:
```bash
./scripts/backup-local.sh
```

Creates `/opt/sovereign-ai-workbench/backups/backup_<timestamp>/` containing:
- `postgres_workbench_db.dump`: Binary PostgreSQL dump.
- `uploads_data.tar.gz`: Archive of all tenant document files.
- `reports_data.tar.gz`: Archive of all generated DOCX approval notes.
- `qdrant_collection_meta.json`: Qdrant collection snapshot metadata.
- `manifest.json`: Checksum and timestamp manifest.

### Restore Execution
To restore from a backup directory:
```bash
# 1. Restore PostgreSQL database
docker exec -i sovereign-ai-postgres pg_restore -U workbench -d workbench_db --clean < /path/to/backup/postgres_workbench_db.dump

# 2. Restore Uploads
tar -xzf /path/to/backup/uploads_data.tar.gz -C backend/src

# 3. Restore Generated Reports
tar -xzf /path/to/backup/reports_data.tar.gz -C backend
```

---

## 8. Troubleshooting & Common Scenarios

### Diagnostic Checklist
```bash
# 1. Check all container statuses and healthchecks
docker compose ps

# 2. View logs for a specific service
docker compose logs -f backend
docker compose logs -f ai-service

# 3. Verify backend connectivity to Ollama
curl -s http://127.0.0.1:9000/api/v1/security/status | jq .

# 4. Verify Qdrant collection status
curl -s http://127.0.0.1:6333/collections/documents | jq .

# 5. Verify database connectivity
docker exec -it sovereign-ai-postgres pg_isready -U workbench -d workbench_db
```

### Common Issues
1. **Ollama connection refused from inside containers**:
   - Verify `OLLAMA_URL=http://host.docker.internal:11434` in `.env`.
   - On Linux hosts, ensure `extra_hosts: ["host.docker.internal:host-gateway"]` is present in `docker-compose.yml`.
2. **Permission denied on Docker socket (`/var/run/docker.sock`)**:
   - Ensure the user running Docker has permissions to access the docker socket (`sudo usermod -aG docker $USER`).
3. **Database port collision on 5432**:
   - SovereignAI maps PostgreSQL to external port `5433` (`5433:5432`), preventing conflicts with host-installed PostgreSQL instances.
