#!/usr/bin/env bash
# ==============================================================================
# SovereignAI — Local Data Backup & Disaster Recovery Utility
# Usage: ./scripts/backup-local.sh [backup_dir]
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
BACKUP_DIR="${1:-${ROOT_DIR}/backups/backup_${TIMESTAMP}}"

mkdir -p "${BACKUP_DIR}"

echo "=================================================="
echo "  SovereignAI — Local Data Backup Utility"
echo "=================================================="
echo "Target backup directory: ${BACKUP_DIR}"
echo ""

# 1. PostgreSQL Database Dump
echo "[1/4] Creating PostgreSQL database dump..."
if docker ps --format '{{.Names}}' | grep -q "sovereign-ai-postgres"; then
    docker exec sovereign-ai-postgres pg_dump -U workbench -d workbench_db -F c > "${BACKUP_DIR}/postgres_workbench_db.dump"
    docker exec sovereign-ai-postgres pg_dump -U workbench -d workbench_db -s > "${BACKUP_DIR}/postgres_schema.sql"
    echo "  ✓ PostgreSQL dump saved: postgres_workbench_db.dump ($(wc -c < "${BACKUP_DIR}/postgres_workbench_db.dump" | tr -d ' ') bytes)"
else
    echo "  ⚠️ Container sovereign-ai-postgres not running; skipping PostgreSQL dump."
fi

# 2. Uploaded Documents Backup
echo "[2/4] Archiving uploaded documents (uploads_data)..."
if [ -d "backend/src/uploads" ]; then
    tar -czf "${BACKUP_DIR}/uploads_data.tar.gz" -C backend/src uploads
    echo "  ✓ Uploads archive saved: uploads_data.tar.gz ($(wc -c < "${BACKUP_DIR}/uploads_data.tar.gz" | tr -d ' ') bytes)"
else
    echo "  ⚠️ backend/src/uploads directory not found."
fi

# 3. Generated Reports Backup
echo "[3/4] Archiving generated reports (reports_data)..."
if [ -d "backend/generated" ]; then
    tar -czf "${BACKUP_DIR}/reports_data.tar.gz" -C backend generated
    echo "  ✓ Reports archive saved: reports_data.tar.gz ($(wc -c < "${BACKUP_DIR}/reports_data.tar.gz" | tr -d ' ') bytes)"
else
    echo "  ⚠️ backend/generated directory not found."
fi

# 4. Qdrant Vector DB Snapshot
echo "[4/4] Creating Qdrant collection snapshot metadata..."
if curl -sf http://127.0.0.1:6333/collections/documents >/dev/null 2>&1; then
    curl -sf -X POST http://127.0.0.1:6333/collections/documents/snapshots > "${BACKUP_DIR}/qdrant_snapshot_result.json" || true
    curl -sf http://127.0.0.1:6333/collections/documents > "${BACKUP_DIR}/qdrant_collection_meta.json" || true
    echo "  ✓ Qdrant snapshot triggered and metadata saved."
else
    echo "  ⚠️ Qdrant not reachable on http://127.0.0.1:6333; skipping Qdrant snapshot."
fi

# Write Manifest
cat <<EOF > "${BACKUP_DIR}/manifest.json"
{
  "backupTimestamp": "${TIMESTAMP}",
  "version": "1.0.0",
  "database": "postgres_workbench_db.dump",
  "uploads": "uploads_data.tar.gz",
  "reports": "reports_data.tar.gz",
  "qdrant": "qdrant_collection_meta.json"
}
EOF

echo ""
echo "=================================================="
echo "✅ BACKUP COMPLETED SUCCESSFULLY"
echo "Location: ${BACKUP_DIR}"
echo "=================================================="
