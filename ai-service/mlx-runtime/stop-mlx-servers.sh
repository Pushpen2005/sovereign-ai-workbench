#!/bin/bash
# ==============================================================================
# SovereignAI MLX Model Servers - Safe Shutdown Script
# ==============================================================================
# Stops managed servers by listening port PIDs on :8080, :8081, :8082.
# ==============================================================================

stop_port() {
    local name="$1"
    local port="$2"
    local pid=$(lsof -ti :${port} -sTCP:LISTEN 2>/dev/null || true)

    if [ -n "$pid" ]; then
        echo "🛑 Stopping $name on port :$port (PID $pid)..."
        kill -15 "$pid" 2>/dev/null || true
        for i in {1..8}; do
            if ! kill -0 "$pid" 2>/dev/null; then
                echo "✅ $name stopped."
                return 0
            fi
            sleep 0.5
        done
        echo "⚠️ $name did not terminate gracefully, sending SIGKILL..."
        kill -9 "$pid" 2>/dev/null || true
    else
        echo "ℹ️ $name on port :$port is not running."
    fi
}

stop_port "Gemma MLX" 8080
stop_port "Qwen Coder MLX" 8081
stop_port "Qwen VL MLX" 8082

echo "Shutdown completed."
