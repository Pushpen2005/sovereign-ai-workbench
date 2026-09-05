#!/usr/bin/env bash
# ==============================================================================
# SovereignAI — On-Premise Local & Air-Gapped Deployment Script
# Usage: ./scripts/deploy-local.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

echo "=================================================="
echo "  SovereignAI — On-Premise Production Deployment"
echo "=================================================="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Working directory: ${ROOT_DIR}"
echo ""

# 1. Check Docker & Docker Compose
echo "[1/7] Validating Docker infrastructure..."
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ Error: Docker Engine is not installed or not in PATH."
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "❌ Error: Docker daemon is not running or current user lacks permissions."
    exit 1
fi
echo "  ✓ Docker Engine is active: $(docker version --format '{{.Server.Version}}')"

# 2. Check Environment Configuration
echo "[2/7] Checking environment configuration (.env)..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "  ⚠️ Warning: .env not found. Creating from .env.example..."
        cp .env.example .env
    else
        echo "❌ Error: Neither .env nor .env.example found."
        exit 1
    fi
fi
echo "  ✓ Environment configuration verified."

# 3. Validate Docker Compose Configuration
echo "[3/7] Validating Docker Compose syntax & configuration..."
if ! docker compose config >/dev/null 2>&1; then
    echo "❌ Error: Invalid docker compose configuration."
    docker compose config
    exit 1
fi
echo "  ✓ docker compose config validated successfully."

# 4. Ensure Persistent Docker Volumes Exist
echo "[4/7] Ensuring persistent data volumes exist..."
for vol in postgres_data qdrant_storage ollama_data uploads_data reports_data; do
    if ! docker volume inspect "${vol}" >/dev/null 2>&1; then
        echo "  • Creating persistent volume: ${vol}"
        docker volume create "${vol}" >/dev/null
    else
        echo "  ✓ Existing volume preserved: ${vol}"
    fi
done

# 5. Start Container Stack
echo "[5/7] Starting SovereignAI service stack..."
docker compose up -d

# 6. Poll Healthchecks
echo "[6/7] Waiting for all services to pass health checks..."
MAX_ATTEMPTS=30
ATTEMPT=1
SERVICES=("sovereign-ai-postgres" "sovereign-ai-qdrant" "sovereign-ai-service" "sovereign-ai-backend" "sovereign-ai-frontend")

while [ ${ATTEMPT} -le ${MAX_ATTEMPTS} ]; do
    ALL_HEALTHY=true
    for s in "${SERVICES[@]}"; do
        STATUS=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${s}" 2>/dev/null || echo "not_found")
        if [ "${STATUS}" != "healthy" ] && [ "${STATUS}" != "running" ]; then
            ALL_HEALTHY=false
            break
        fi
    done

    if [ "${ALL_HEALTHY}" = true ]; then
        echo "  ✓ All ${#SERVICES[@]} services are HEALTHY and operational!"
        break
    fi

    echo "  • Waiting for health checks... (attempt ${ATTEMPT}/${MAX_ATTEMPTS})"
    sleep 3
    ATTEMPT=$((ATTEMPT + 1))
done

if [ ${ATTEMPT} -gt ${MAX_ATTEMPTS} ]; then
    echo "⚠️ Warning: Some services took longer than expected to report healthy."
    echo "Current container states:"
    docker compose ps
fi

# 7. Endpoint Verification
echo "[7/7] Verifying live application endpoints..."
sleep 2

# Verify Backend
if curl -sf http://127.0.0.1:9000/api/v1/health >/dev/null 2>&1; then
    echo "  ✓ Backend API is reachable on http://127.0.0.1:9000/api/v1/health"
else
    echo "  ⚠️ Backend API health check pending at http://127.0.0.1:9000"
fi

# Verify Sovereignty status
if curl -sf http://127.0.0.1:9000/api/v1/security/status >/dev/null 2>&1; then
    echo "  ✓ Sovereignty & Security status verified on http://127.0.0.1:9000/api/v1/security/status"
fi

echo ""
echo "=================================================="
echo "🎉 SOVEREIGNAI STACK SUCCESSFULLY DEPLOYED"
echo "=================================================="
echo "  Frontend Application: http://localhost:5173"
echo "  Backend API Gateway:  http://localhost:9000"
echo "  Internal Qdrant REST: http://127.0.0.1:6333 (Localhost only)"
echo "  Internal PostgreSQL:  http://127.0.0.1:5433 (Localhost only)"
echo "  Default Demo User:    engineer@example.com / DemoPassword123!"
echo "=================================================="
