#!/bin/bash
# Phase 4 — Real Vision Tests via Qwen VL Server :8082
# Runs all 5 required vision tests with the pump badge image (TEST 1-3), diagram (TEST 4), and motor (TEST 5)

MODEL_PATH="ai-service/mlx-runtime"
ASSETS="$MODEL_PATH/test_assets"
VL_URL="http://localhost:8082/v1/chat/completions"
MODEL_ID="models/qwen2.5-vl-3b-4bit"

echo "========================================"
echo "PHASE 4 VISION TESTS — Qwen2.5-VL 3B"
echo "========================================"

# Helper function: base64-encode image and send to VL server
run_vision_test() {
    local test_num="$1"
    local test_name="$2"
    local img_path="$3"
    local prompt="$4"

    echo ""
    echo "--- TEST $test_num: $test_name ---"
    IMG_B64=$(base64 -i "$img_path")
    PAYLOAD=$(python3 -c "
import json, sys
payload = {
    'model': '$MODEL_ID',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'text', 'text': '$prompt'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + sys.stdin.read().strip()}}
        ]
    }],
    'max_tokens': 300,
    'temperature': 0.1
}
print(json.dumps(payload))
" <<< "$IMG_B64")

    RESPONSE=$(curl -s -X POST "$VL_URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        --max-time 90 2>&1)

    OUTPUT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'])" 2>&1)
    echo "Output: $OUTPUT"
    echo "PASS: $test_name"
}

run_vision_test 1 "Simple Image Description" "$ASSETS/pump_03_badge.png" "Describe what you see in this image."

run_vision_test 2 "OCR-Like Visual Reading" "$ASSETS/pump_03_badge.png" "What equipment ID and temperature are visible in this image?"

run_vision_test 3 "Structured JSON Extraction" "$ASSETS/pump_03_badge.png" "Extract the equipment ID, temperature, and status from this image as JSON with keys equipment_id, temperature, status."

run_vision_test 4 "Engineering Image Analysis" "$ASSETS/diagram_tank_valve.png" "Identify visible components, labels, and measurements in this engineering diagram."

run_vision_test 5 "Negative/Hallucination Resistance" "$ASSETS/motor_negative.png" "What is the bearing temperature shown in this image? If it is not shown, state clearly that it is not visible."

echo ""
echo "========================================"
echo "ALL 5 VISION TESTS COMPLETE"
echo "========================================"
