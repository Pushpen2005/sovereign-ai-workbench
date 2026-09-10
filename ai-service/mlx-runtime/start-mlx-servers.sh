#!/bin/bash
# ==============================================================================
# SovereignAI MLX Model Servers - Safe Startup Script
# ==============================================================================
# Discovers running servers, verifies environment, and starts only stopped servers.
# Ports:
#   :8080 -> Gemma 2B IT 4-bit (mlx_lm.server)
#   :8081 -> Qwen2.5-Coder 3B 4-bit (mlx_lm.server)
#   :8082 -> Qwen2.5-VL 3B 4-bit (mlx_vlm.server)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"
LOGS_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGS_DIR"

if [ ! -f "$VENV_PYTHON" ]; then
    echo "❌ Error: Virtual environment python not found at $VENV_PYTHON"
    exit 1
fi

check_port_health() {
    local port="$1"
    curl -s -m 2 "http://127.0.0.1:${port}/health" > /dev/null 2>&1
}

# 1. Gemma :8080
if check_port_health 8080; then
    echo "✅ Gemma MLX (:8080) is already RUNNING and HEALTHY."
else
    echo "🚀 Starting Gemma MLX on :8080..."
    nohup "$VENV_PYTHON" -m mlx_lm.server \
        --model models/gemma-2-2b-it-4bit \
        --host 0.0.0.0 --port 8080 > "$LOGS_DIR/gemma.log" 2>&1 &
    sleep 2
    if check_port_health 8080; then
        echo "✅ Gemma MLX (:8080) started successfully."
    else
        echo "⚠️ Gemma MLX (:8080) starting in background. Check $LOGS_DIR/gemma.log."
    fi
fi

# 2. Qwen Coder :8081
if check_port_health 8081; then
    echo "✅ Qwen Coder MLX (:8081) is already RUNNING and HEALTHY."
else
    echo "🚀 Starting Qwen Coder MLX on :8081..."
    nohup "$VENV_PYTHON" -m mlx_lm.server \
        --model models/qwen2.5-coder-3b-4bit \
        --host 0.0.0.0 --port 8081 > "$LOGS_DIR/qwen_coder.log" 2>&1 &
    sleep 2
    if check_port_health 8081; then
        echo "✅ Qwen Coder MLX (:8081) started successfully."
    else
        echo "⚠️ Qwen Coder MLX (:8081) starting in background. Check $LOGS_DIR/qwen_coder.log."
    fi
fi

# 3. Qwen VL :8082
if check_port_health 8082; then
    echo "✅ Qwen VL MLX (:8082) is already RUNNING and HEALTHY."
else
    echo "🚀 Starting Qwen VL MLX on :8082..."
    nohup "$VENV_PYTHON" -m mlx_vlm.server \
        --model models/qwen2.5-vl-3b-4bit \
        --host 0.0.0.0 --port 8082 > "$LOGS_DIR/qwen_vl.log" 2>&1 &
    sleep 2
    if check_port_health 8082; then
        echo "✅ Qwen VL MLX (:8082) started successfully."
    else
        echo "⚠️ Qwen VL MLX (:8082) starting in background. Check $LOGS_DIR/qwen_vl.log."
    fi
fi

echo "=================================================="
echo "SovereignAI MLX Model Servers Status Check:"
curl -s http://127.0.0.1:8080/health && echo " (Gemma :8080)"
curl -s http://127.0.0.1:8081/health && echo " (Qwen Coder :8081)"
curl -s http://127.0.0.1:8082/health && echo " (Qwen VL :8082)"
echo "=================================================="
