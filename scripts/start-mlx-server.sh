#!/usr/bin/env bash
# ==============================================================================
# SovereignAI — Native macOS Gemma MLX Server Launcher
#
# Starts the local MLX inference server bound to port 8080.
# Accessible natively on macOS (127.0.0.1:8080) and from Docker containers
# via host.docker.internal:8080.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_PYTHON="${ROOT_DIR}/ai-service/mlx-runtime/venv/bin/python"
MODEL_PATH="${ROOT_DIR}/ai-service/mlx-runtime/models/gemma-2-2b-it-4bit"
PORT="${MLX_PORT:-8080}"
HOST="${MLX_HOST:-0.0.0.0}"

if [ ! -f "${VENV_PYTHON}" ]; then
  echo "❌ Error: MLX virtualenv python not found at ${VENV_PYTHON}"
  echo "Run setup in ai-service/mlx-runtime first."
  exit 1
fi

if [ ! -d "${MODEL_PATH}" ]; then
  echo "❌ Error: Gemma model directory not found at ${MODEL_PATH}"
  exit 1
fi

echo "=================================================="
echo "Starting SovereignAI Native Gemma MLX Server"
echo "Host:  ${HOST}"
echo "Port:  ${PORT}"
echo "Model: ${MODEL_PATH}"
echo "=================================================="

exec "${VENV_PYTHON}" -m mlx_lm server \
  --model "${MODEL_PATH}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --prompt-cache-size 0 \
  --decode-concurrency 1 \
  --prompt-concurrency 1
