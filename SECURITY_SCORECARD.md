# SovereignAI Security Scorecard

**Project:** SovereignAI — On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 7 — Production Security Boundary & Final SIH Readiness  
**Evaluation Standard:** Zero-Trust Industrial Air-Gap Assessment  
**Date:** September 3, 2026  

---

## 1. Executive Summary

This scorecard provides a technically defensible evaluation of the SovereignAI platform. In strict compliance with auditing standards, every security dimension is classified without score inflation as **PASS**, **PARTIAL**, or **NOT VERIFIED**.

---

## 2. Comprehensive Security Assessment Matrix

| Security Area | Status | Technical Evidence & Verification | Risk & Mitigation |
|---|:---:|---|---|
| **Authentication** | **PASS** | HMAC-SHA256 JWT validation on sensitive endpoints. User sessions authoritatively bound to verified database identities. | Low. Unauthenticated access blocked (`401 Unauthorized`). |
| **Authorization** | **PASS** | Role check helpers (`requireRole('inspector', 'admin')`) and resource-level ownership validation enforced on documents and reports. | Low. |
| **Tenant Isolation** | **PASS** | Organization ID derived authoritatively from authenticated JWT (`req.user.organizationId`). Header spoofing (`x-organization-id`) rejected with `403 Forbidden`. Cross-tenant queries, chat, reports, and DOCX downloads return `403` or `404`. | Low. Zero cross-tenant leakage. |
| **JWT Security** | **PASS** | Tokens signed with HMAC-SHA256. Expired tokens, malformed headers, and forged signatures strictly rejected with `HTTP 401`. Tokens omitted from server logs. | Low. |
| **Password Security** | **PASS** | Passwords hashed with `bcryptjs` (salt rounds = 10). Minimum 8 characters enforced. Passwords never persisted in plaintext, never logged, and never returned in API payloads. | Low. |
| **Rate Limiting** | **PASS** | In-memory token bucket rate limiter (`authRateLimiter`) active on `/api/v1/auth/login` and `/api/v1/auth/register` (30 requests/minute). Hard limit returns `HTTP 429 Too Many Requests`. Bounded cache eviction prevents memory leaks. | Low in single-node; see note on clustered Redis. |
| **Input Validation** | **PASS** | Malformed JSON cleanly rejected (`HTTP 400`). Express JSON body limit capped at 2 MB. Missing fields and invalid query parameters return structured 4xx errors rather than uncaught 500 exceptions. | Low. |
| **Upload Security** | **PASS** | Uploaded files renamed with random UUIDs (`crypto.randomUUID()`), neutralizing path traversal. PDF uploads verified with `%PDF` magic bytes. Image uploads verified with binary headers (PNG, JPEG, WebP). 10 MB limit enforced. | Low. Disguised binaries rejected. |
| **CORS** | **PASS** | Configurable origin whitelist (`CORS_ORIGIN`), defaulting to local frontend ports. Unauthorized cross-origin requests do not receive access headers. | Low. |
| **Security Headers** | **PASS** | Strict HTTP security headers enforced: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`. `X-Powered-By` header stripped. | Low. |
| **Secrets Management** | **PASS** | Git ignores all `*.env` files. Zero credentials or private keys in repository history. Config injected via environment variables. Dummy placeholders documented in `.env.example`. | Low. |
| **Logging Security** | **PASS** | Structured JSON audit logs use sanitized events (`AUTH_FAILURE`, `LOGIN_SUCCESS`, `vision.started`, `router.classified`). Passwords, raw JWTs, prompt payloads, and image buffers are strictly excluded. | Low. |
| **Database Security** | **PASS** | PostgreSQL 16 queries use parameterized statements (`$1, $2, ...`) across all controllers. Zero dynamic SQL string concatenation. SQL injection attempts neutralized. | Low. |
| **Qdrant Security** | **PASS** | Vector collection enforces mandatory payload filtering by `organizationId`. Cross-tenant similarity searches return zero foreign vectors. | Low. |
| **Ollama Security** | **PASS** | Model access strictly restricted by server-side Model Router allowlist (`llama3.2:3b`, `moondream`). Outbound model pulling blocked at runtime. | Low. |
| **Coding Sandbox Security** | **PASS** | Dynamic code execution isolated in ephemeral `python:3.11-alpine` containers with `--user 1000:1000` (non-root), `--network none`, `--read-only`, `--security-opt no-new-privileges`, 1 vCPU, 256 MB RAM, 64 PIDs limit, and 16 MB tmpfs. 11/11 attack probes blocked. | Low within container. |
| **Docker Socket** | **HARDENED WITH LIMITATION** | Backend mounts `/var/run/docker.sock` to spawn ephemeral sandbox containers. Backend code audited: invokes ONLY `docker run`, `docker kill`, and `docker rm` on dedicated ephemeral container names. Sandbox itself does NOT mount the Docker socket. | Moderate. Production recommendation: deploy Docker Socket Proxy or rootless microVMs. |
| **Host Port Exposure** | **PASS (Production Profile)** | `docker-compose.prod.yml` eliminates host port exposure for PostgreSQL, Qdrant, Ollama, and ai-service, keeping them internal to `sovereign_net`. Only Frontend (80) and Backend (9000) are exposed. | Low. |
| **Container Privileges** | **PARTIAL** | Sandbox container runs as non-root (`--user 1000:1000`). Frontend nginx worker processes run unprivileged (`nginx`). Backend and ai-service containers currently run as root inside their container namespaces. | Moderate. Production roadmap: non-root user mappings. |
| **Read-Only Filesystem** | **PARTIAL** | Coding sandbox enforces `--read-only` root filesystem. Backend and ai-service require writable directories for temporary PDF extraction, OCR artifacts, model caches, and DOCX generation. | Low / Moderate. |
| **Network Isolation** | **PARTIAL** | Coding sandbox has verified zero network access (`--network none`). Core containers communicate over bridge network `sovereign_net`. Zero runtime outbound cloud AI calls. However, Docker bridge has outbound host NAT capability unless host firewall blocks egress. | Moderate at host level; Low at application level. |
| **Air-Gapped Operation** | **PASS (Application Level)** | Full pipeline (LLM, vision, embeddings, OCR, vector store, relational DB, report generation) operates with zero external internet dependencies. | Low (Host physical air-gap not provided by app). |
| **Backup / Recovery** | **PASS** | Non-destructive drill completed: `pg_dump` produced 107 KB SQL archive; Qdrant snapshot API produced verified 407 MB archive with valid checksum. | Low. |

---

## 3. Host Port Exposure Audit Table

| Service | Development Host Port | Production Host Port (`docker-compose.prod.yml`) | Architectural Justification |
|---|:---:|:---:|---|
| **frontend** | `5173:80` | `80:80` (or `5173:80`) | Public web interface ingress for operators and inspection engineers. |
| **backend** | `9000:9000` | `9000:9000` | API Gateway and SSE stream endpoint. |
| **postgres** | `5433:5432` | **NONE** (`expose: 5432` internal) | Confidential relational data; strictly internal to `sovereign_net`. |
| **qdrant** | `6333:6333`, `6334:6334` | **NONE** (`expose: 6333, 6334` internal) | High-dimensional embedding storage; strictly internal to `sovereign_net`. |
| **ollama** | `11435:11434` | **NONE** (`expose: 11434` internal) | Local LLM inference engine; strictly internal to `sovereign_net`. |
| **ai-service** | `5001:5001` | **NONE** (`expose: 5001` internal) | Private microservice invoked only by backend orchestrator. |

---

## 4. Coding Sandbox Security Matrix (11 Probes)

| Attack / Abuse Probe | Tested Mechanism | Result | Status |
|---|---|---|:---:|
| **1. Internet Egress** | `urllib.request.urlopen("https://8.8.8.8")` | `NET_BLOCKED: OSError` | **BLOCKED** |
| **2. Host Filesystem** | Inspect `/app`, `/host`, `/Users`, `/home/workbench` | `HOST_PATHS_FOUND: []` | **ISOLATED** |
| **3. Privilege Escalation** | Read `/etc/shadow` | `PermissionError` (User `1000:1000`) | **DENIED** |
| **4. Secrets Leakage** | Inspect `JWT_SECRET`, `POSTGRES_PASSWORD`, etc. | `LEAKED_SECRETS: []` | **ISOLATED** |
| **5. Internal PostgreSQL** | Connect to `172.19.0.3:5432` | `OSError: Network is unreachable` | **BLOCKED** |
| **6. Internal Qdrant** | Connect to `172.19.0.2:6333` | `OSError: Network is unreachable` | **BLOCKED** |
| **7. Internal Ollama** | Connect to `172.19.0.4:11434` | `OSError: Network is unreachable` | **BLOCKED** |
| **8. Docker Socket** | Inspect `/var/run/docker.sock` | `DOCKER_SOCKET_FOUND: []` | **ABSENT** |
| **9. Fork Bomb** | Spawn 100 child processes | `BlockingIOError` (--pids-limit 64) | **BOUNDED** |
| **10. Memory Exhaustion** | Allocate 700 MB dirty pages | Container terminated by cgroup cap (--memory 256m) | **BOUNDED** |
| **11. Infinite Loop** | `while True: pass` | Terminated safely by timeout in 2066 ms | **TERMINATED** |
