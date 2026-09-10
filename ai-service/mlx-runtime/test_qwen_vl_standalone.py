#!/usr/bin/env python3
"""
Standalone Qwen2.5-VL 3B 4-bit MLX Validation & Benchmark Script.
Phase 4 SovereignAI Apple Silicon M4.
"""

import os
import sys
import time
import json
import tracemalloc
from PIL import Image, ImageDraw, ImageFont
import mlx.core as mx
import mlx_vlm

MODEL_PATH = os.path.abspath("models/qwen2.5-vl-3b-4bit")
TEST_ASSETS_DIR = os.path.abspath("test_assets")
os.makedirs(TEST_ASSETS_DIR, exist_ok=True)

def create_test_images():
    # 1. Pump Badge (Text & OCR test)
    img_pump = Image.new("RGB", (400, 200), color=(30, 41, 59))
    draw = ImageDraw.Draw(img_pump)
    # Draw simple border
    draw.rectangle([10, 10, 390, 190], outline=(56, 189, 248), width=3)
    draw.text((30, 30), "EQUIPMENT ID: Pump-03", fill=(255, 255, 255))
    draw.text((30, 70), "Bearing Temperature: 92°C", fill=(248, 113, 113))
    draw.text((30, 110), "Operational Status: High Alert", fill=(251, 191, 36))
    draw.text((30, 150), "Location: Sector-4 Facility-A", fill=(148, 163, 184))
    pump_path = os.path.join(TEST_ASSETS_DIR, "pump_03_badge.png")
    img_pump.save(pump_path)

    # 2. Engineering Diagram (Components & Measurements)
    img_diag = Image.new("RGB", (500, 250), color=(15, 23, 42))
    draw_diag = ImageDraw.Draw(img_diag)
    draw_diag.rectangle([20, 20, 160, 120], outline=(34, 197, 94), width=2)
    draw_diag.text((30, 35), "[TANK-T01]", fill=(34, 197, 94))
    draw_diag.text((30, 65), "Level: 85%", fill=(255, 255, 255))
    draw_diag.text((30, 90), "Status: Normal", fill=(203, 213, 225))

    draw_diag.line([160, 70, 260, 70], fill=(148, 163, 184), width=3)

    draw_diag.rectangle([260, 20, 420, 120], outline=(56, 189, 248), width=2)
    draw_diag.text((270, 35), "[VALVE-V101]", fill=(56, 189, 248))
    draw_diag.text((270, 65), "State: OPEN", fill=(255, 255, 255))
    draw_diag.text((270, 90), "Flow: 120 L/min", fill=(203, 213, 225))

    draw_diag.text((40, 180), "Pressure Gauge PG-02: 4.5 bar", fill=(251, 191, 36))
    diag_path = os.path.join(TEST_ASSETS_DIR, "diagram_tank_valve.png")
    img_diag.save(diag_path)

    # 3. Negative test (Motor without temperature)
    img_neg = Image.new("RGB", (400, 180), color=(24, 24, 27))
    draw_neg = ImageDraw.Draw(img_neg)
    draw_neg.rectangle([10, 10, 390, 170], outline=(161, 161, 170), width=2)
    draw_neg.text((30, 30), "ASSET: Motor-M07", fill=(255, 255, 255))
    draw_neg.text((30, 70), "Speed: 1750 RPM", fill=(212, 212, 216))
    draw_neg.text((30, 110), "Vibration: 1.2 mm/s (RMS)", fill=(212, 212, 216))
    neg_path = os.path.join(TEST_ASSETS_DIR, "motor_negative.png")
    img_neg.save(neg_path)

    return pump_path, diag_path, neg_path

def main():
    print(f"=== QWEN2.5-VL 3B 4-BIT STANDALONE INFERENCE BENCHMARK ===")
    print(f"Model path: {MODEL_PATH}")

    pump_path, diag_path, neg_path = create_test_images()
    print("Test images created successfully.")

    # 1. Measure Cold Load
    print("\n[1] Measuring Cold Load...")
    tracemalloc.start()
    t_load_start = time.perf_counter()
    model, processor = mlx_vlm.load(MODEL_PATH)
    t_load_end = time.perf_counter()
    cold_load_time = t_load_end - t_load_start
    current_mem, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    print(f"Cold load time: {cold_load_time:.3f} s")
    print(f"Memory traced delta: current={current_mem / (1024*1024):.2f} MB, peak={peak_mem / (1024*1024):.2f} MB")

    tests = [
        {
            "id": "TEST_A_PUMP",
            "name": "OCR & Information Extraction",
            "image": pump_path,
            "prompt": "What information is shown in this image?",
            "max_tokens": 200,
        },
        {
            "id": "TEST_B_DIAGRAM",
            "name": "Engineering Diagram Description",
            "image": diag_path,
            "prompt": "Identify visible components, labels, and measurements shown in this diagram.",
            "max_tokens": 200,
        },
        {
            "id": "TEST_C_STRUCTURED_JSON",
            "name": "Structured JSON Extraction",
            "image": pump_path,
            "prompt": "Extract the equipment ID, temperature, and visible operational status as a valid JSON object with keys equipment_id, temperature, status.",
            "max_tokens": 150,
        },
        {
            "id": "TEST_D_NEGATIVE",
            "name": "Negative Information Check (Hallucination Resistance)",
            "image": neg_path,
            "prompt": "What is the bearing temperature shown in this image? If it is not shown, state clearly that it is not visible.",
            "max_tokens": 100,
        }
    ]

    results = []
    print("\n[2] Running Vision Tests...")

    for t in tests:
        print(f"\n--- Running {t['id']}: {t['name']} ---")
        prompt_formatted = mlx_vlm.apply_chat_template(
            processor,
            config=model.config,
            prompt=t["prompt"],
            num_images=1
        )

        t_infer_start = time.perf_counter()
        output = mlx_vlm.generate(
            model,
            processor,
            prompt=prompt_formatted,
            image=t["image"],
            max_tokens=t["max_tokens"],
            verbose=False
        )
        t_infer_end = time.perf_counter()
        latency = t_infer_end - t_infer_start

        gen_text = output.text if hasattr(output, "text") else str(output)
        num_tokens = getattr(output, "prompt_tokens", 0) + getattr(output, "generation_tokens", 0)
        gen_tokens = getattr(output, "generation_tokens", len(gen_text.split()))
        tps = gen_tokens / latency if latency > 0 else 0

        print(f"Latency: {latency:.3f} s | Gen tokens: {gen_tokens} | TPS: {tps:.2f} tok/s")
        print(f"Output preview: {gen_text.strip()[:200]}...")

        results.append({
            "test_id": t["id"],
            "name": t["name"],
            "latency_s": round(latency, 3),
            "tokens": gen_tokens,
            "tokens_per_sec": round(tps, 2),
            "output": gen_text.strip()
        })

    benchmark_data = {
        "model": "qwen2.5-vl:3b-4bit",
        "model_path": MODEL_PATH,
        "cold_load_s": round(cold_load_time, 3),
        "peak_memory_mb": round(peak_mem / (1024*1024), 2),
        "tests": results
    }

    with open("qwen_vl_phase4_results.json", "w") as f:
        json.dump(benchmark_data, f, indent=2)

    print("\nBenchmark successfully completed and written to qwen_vl_phase4_results.json")

if __name__ == "__main__":
    main()
