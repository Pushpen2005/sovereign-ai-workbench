import time
import json
import os
import sys
import psutil
import mlx.core as mx
from mlx_lm import load, generate, stream_generate

MODEL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "models/gemma-2-2b-it-4bit"))

def get_mem_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / (1024 * 1024)

def format_gemma_chat(tokenizer, messages):
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    # Fallback chat format for Gemma:
    formatted = ""
    for m in messages:
        formatted += f"<start_of_turn>{m['role']}\n{m['content']}<end_of_turn>\n"
    formatted += "<start_of_turn>model\n"
    return formatted

def run_step_5_basic(model, tokenizer):
    print("\n--- STEP 5: BASIC LOCAL INFERENCE ---")
    prompt_text = "Explain in simple terms what a centrifugal pump does."
    formatted = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt_text}])
    
    t0 = time.time()
    response = generate(model, tokenizer, prompt=formatted, max_tokens=256, verbose=False)
    t1 = time.time()
    latency = t1 - t0
    tokens = len(tokenizer.encode(response))
    tps = tokens / latency if latency > 0 else 0
    
    print("Response:\n", response.strip())
    print(f"\nLatency: {latency:.3f}s | Output tokens: {tokens} | Tokens/sec: {tps:.2f}")
    return {
        "response": response.strip(),
        "latency": latency,
        "tokens": tokens,
        "tokens_per_sec": tps
    }

def run_step_6_industrial(model, tokenizer):
    print("\n--- STEP 6: INDUSTRIAL DOCUMENT TEST ---")
    context = (
        "Pump P-103 was inspected on 12 August 2026.\n"
        "Bearing temperature was measured at 87°C.\n"
        "The maintenance guideline specifies a maximum normal operating temperature of 80°C.\n"
        "The inspection also observed increased vibration."
    )
    user_prompt = f"Based on the following inspection context, what findings are present in this inspection?\n\nContext:\n{context}"
    formatted = format_gemma_chat(tokenizer, [
        {"role": "user", "content": user_prompt}
    ])
    
    t0 = time.time()
    response = generate(model, tokenizer, prompt=formatted, max_tokens=256, verbose=False)
    t1 = time.time()
    
    print("Response:\n", response.strip())
    print(f"\nLatency: {t1 - t0:.3f}s")
    
    resp_lower = response.lower()
    has_temp = "87" in response or "temperature" in resp_lower or "80" in response
    has_vib = "vibration" in resp_lower
    return {
        "response": response.strip(),
        "has_temperature_finding": has_temp,
        "has_vibration_finding": has_vib,
        "latency": t1 - t0
    }

def run_step_7_grounded_rag(model, tokenizer):
    print("\n--- STEP 7: GROUNDED RAG-STYLE TEST ---")
    system_instruction = (
        "Answer ONLY using the supplied reference context.\n"
        "If the information is not present in the context, say that it is not available.\n"
        "Do not use outside knowledge. Do not invent facts."
    )
    context = (
        "Pump P-103 bearing temperature was 87°C.\n"
        "The maintenance guideline specifies a maximum normal temperature of 80°C."
    )
    
    # Q1: Known
    q1 = "What was the bearing temperature?"
    prompt1 = f"{system_instruction}\n\nCONTEXT:\n{context}\n\nQUESTION:\n{q1}"
    formatted1 = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt1}])
    t0 = time.time()
    resp1 = generate(model, tokenizer, prompt=formatted1, max_tokens=128, verbose=False)
    t1 = time.time()
    print("Q1 (Known - Expected: 87°C):", resp1.strip())
    print(f"Latency: {t1 - t0:.3f}s")
    
    # Q2: Unknown
    q2 = "What is the pump manufacturer?"
    prompt2 = f"{system_instruction}\n\nCONTEXT:\n{context}\n\nQUESTION:\n{q2}"
    formatted2 = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt2}])
    t0 = time.time()
    resp2 = generate(model, tokenizer, prompt=formatted2, max_tokens=128, verbose=False)
    t1 = time.time()
    print("\nQ2 (Unknown - Expected: Not available):", resp2.strip())
    print(f"Latency: {t1 - t0:.3f}s")
    
    return {
        "q1_answer": resp1.strip(),
        "q2_answer": resp2.strip()
    }

def run_step_8_and_9_json(model, tokenizer):
    print("\n--- STEP 8 & 9: STRUCTURED JSON TESTS (5 RUNS) ---")
    system_msg = (
        "Return ONLY valid JSON. Do not use markdown. Do not add explanations outside JSON."
    )
    user_msg = (
        "Extract the inspection finding from this context:\n\n"
        "\"Pump P-103 bearing temperature was 87°C. The normal operating limit is 80°C.\"\n\n"
        "Output JSON matching this schema:\n"
        "{\n"
        "  \"findings\": [\n"
        "    {\n"
        "      \"finding\": string,\n"
        "      \"equipment\": string,\n"
        "      \"observedValue\": string,\n"
        "      \"limit\": string,\n"
        "      \"severity\": string,\n"
        "      \"evidence\": string\n"
        "    }\n"
        "  ]\n"
        "}"
    )
    
    formatted = format_gemma_chat(tokenizer, [
        {"role": "user", "content": f"{system_msg}\n\n{user_msg}"}
    ])
    
    runs = []
    for i in range(5):
        t0 = time.time()
        raw = generate(model, tokenizer, prompt=formatted, max_tokens=256, verbose=False).strip()
        t1 = time.time()
        
        # Check raw JSON validity
        cleaned = raw
        if cleaned.startswith("```"):
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
        
        is_valid = False
        parsed = None
        has_fences = raw.startswith("```")
        
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict) and "findings" in parsed and isinstance(parsed["findings"], list) and len(parsed["findings"]) > 0:
                is_valid = True
        except Exception:
            is_valid = False
            
        print(f"Run {i+1}: Valid={is_valid} | CodeFences={has_fences} | Latency={t1 - t0:.3f}s")
        if i == 0:
            print(f"Sample Output:\n{raw}\n")
            
        runs.append({
            "run": i + 1,
            "valid": is_valid,
            "has_code_fences": has_fences,
            "raw": raw,
            "parsed": parsed,
            "latency": t1 - t0
        })
        
    success_count = sum(1 for r in runs if r["valid"])
    success_rate = (success_count / len(runs)) * 100
    print(f"JSON Success Rate: {success_count}/{len(runs)} ({success_rate:.1f}%)")
    return {
        "runs": runs,
        "success_rate": success_rate,
        "success_count": success_count,
        "total_runs": len(runs)
    }

def run_step_10_long_context(model, tokenizer):
    print("\n--- STEP 10: LONG CONTEXT TEST ---")
    long_doc = """
INDUSTRIAL PLANT INSPECTION & OBSERVATION LOG - UNIT 4
Date of Inspection: September 2026

SECTION 1: ROTATING EQUIPMENT
1. Pump P-101 (Boiler Feed Pump):
   - Motor bearing temperature: 68°C (Normal, limit 80°C).
   - Discharge pressure: 42 bar (Target: 40-45 bar).
   - Vibration level: 1.8 mm/s RMS (Acceptable).

2. Pump P-102 (Condensate Extraction):
   - Motor bearing temperature: 74°C (Normal, limit 80°C).
   - Discharge pressure: 12 bar.
   - Oil level: Satisfactory.

3. Pump P-103 (Raw Water Supply):
   - Inboard bearing temperature: 89°C (CRITICAL EXCEEDANCE: limit 80°C).
   - Outboard bearing temperature: 72°C.
   - Vibration: 7.2 mm/s RMS (High, alarm trigger at 4.5 mm/s).
   - Notes: Cavitation noise audible near impeller casing. Immediate maintenance inspection recommended.

SECTION 2: HEAT EXCHANGERS & PIPING
4. Heat Exchanger HX-201:
   - Shell side inlet temperature: 115°C, outlet: 92°C.
   - Tube side inlet: 30°C, outlet: 48°C.
   - Differential pressure: 0.8 bar. No visible flange leaks.

5. Steam Header SH-01:
   - Steam temperature: 380°C.
   - Steam pressure: 64 bar.
   - Minor steam plume observed at valve V-402 packing gland.

SECTION 3: ELECTRICAL SYSTEMS
6. Transformer TR-01:
   - Winding temperature: 65°C.
   - Oil level indicator: Normal.
   - Silica gel condition: Blue (active).
"""
    questions = [
        "What was the inboard bearing temperature of Pump P-103 and does it exceed its limit?",
        "What is the steam pressure of Steam Header SH-01?",
        "Which pump showed abnormal vibration and what was the measured vibration value?"
    ]
    
    results = []
    for q in questions:
        prompt = f"Answer the question based strictly on the inspection log below.\n\nLOG:\n{long_doc}\n\nQUESTION:\n{q}\n\nANSWER:"
        formatted = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt}])
        t0 = time.time()
        ans = generate(model, tokenizer, prompt=formatted, max_tokens=150, verbose=False)
        t1 = time.time()
        print(f"Q: {q}")
        print(f"A: {ans.strip()}")
        print(f"Latency: {t1 - t0:.3f}s\n")
        results.append({
            "question": q,
            "answer": ans.strip(),
            "latency": t1 - t0
        })
    return results

def run_step_11_streaming(model, tokenizer):
    print("\n--- STEP 11: STREAMING TEST ---")
    prompt = "Provide a concise 3-bullet summary of preventive maintenance best practices for industrial slurry pumps."
    formatted = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt}])
    
    t0 = time.time()
    first_token_time = None
    tokens = 0
    collected_text = ""
    
    for chunk in stream_generate(model, tokenizer, prompt=formatted, max_tokens=150):
        if first_token_time is None:
            first_token_time = time.time()
        tokens += 1
        collected_text += chunk.text
        
    t_end = time.time()
    ttft = (first_token_time - t0) if first_token_time else (t_end - t0)
    total_gen_time = t_end - t0
    tps = tokens / (t_end - first_token_time) if (first_token_time and t_end > first_token_time) else 0
    
    print(f"Collected stream:\n{collected_text.strip()}")
    print(f"\nTTFT (Time To First Token): {ttft*1000:.2f} ms")
    print(f"Total generation time: {total_gen_time:.3f} s")
    print(f"Total tokens generated: {tokens}")
    print(f"Streaming token rate: {tps:.2f} tokens/sec")
    
    return {
        "supported": True,
        "ttft_ms": ttft * 1000,
        "total_time_s": total_gen_time,
        "tokens": tokens,
        "tokens_per_sec": tps
    }

def run_step_13_benchmark(model, tokenizer):
    print("\n--- STEP 13: PERFORMANCE BENCHMARK (5 WARM RUNS) ---")
    prompt_text = "Summarize the primary purpose of an industrial vibration sensor on rotating equipment in two sentences."
    formatted = format_gemma_chat(tokenizer, [{"role": "user", "content": prompt_text}])
    
    warm_latencies = []
    tokens_list = []
    tps_list = []
    ttft_list = []
    
    for i in range(5):
        t0 = time.time()
        first_token_t = None
        tokens = 0
        text = ""
        for chunk in stream_generate(model, tokenizer, prompt=formatted, max_tokens=100):
            if first_token_t is None:
                first_token_t = time.time()
            tokens += 1
            text += chunk.text
        t_end = time.time()
        
        latency = t_end - t0
        ttft = (first_token_t - t0) if first_token_t else latency
        tps = tokens / (t_end - first_token_t) if (first_token_t and t_end > first_token_t) else 0
        
        warm_latencies.append(latency)
        tokens_list.append(tokens)
        tps_list.append(tps)
        ttft_list.append(ttft * 1000)
        print(f"Warm run #{i+1}: Latency={latency:.3f}s | TTFT={ttft*1000:.1f}ms | Tokens={tokens} | TPS={tps:.2f}")
        
    avg_latency = sum(warm_latencies) / len(warm_latencies)
    avg_tps = sum(tps_list) / len(tps_list)
    avg_ttft = sum(ttft_list) / len(ttft_list)
    
    print(f"\nAverage warm latency: {avg_latency:.3f}s")
    print(f"Average tokens/sec: {avg_tps:.2f}")
    print(f"Average TTFT: {avg_ttft:.1f}ms")
    
    return {
        "warm_runs": warm_latencies,
        "avg_latency": avg_latency,
        "avg_tps": avg_tps,
        "avg_ttft_ms": avg_ttft,
        "tokens": tokens_list
    }

def main():
    print("==================================================")
    print("PHASE 1: NATIVE GEMMA + MLX RUNTIME VALIDATION")
    print(f"Model Path: {MODEL_PATH}")
    print("==================================================")
    
    mem_before = get_mem_mb()
    print(f"Initial process memory: {mem_before:.1f} MB")
    
    # 1. Cold Load
    print("\nLoading model weights and tokenizer into MLX unified memory...")
    t_load_0 = time.time()
    model, tokenizer = load(MODEL_PATH)
    t_load_1 = time.time()
    cold_load_time = t_load_1 - t_load_0
    mem_after = get_mem_mb()
    mem_delta = mem_after - mem_before
    print(f"Cold model load time: {cold_load_time:.3f} seconds")
    print(f"Process memory after load: {mem_after:.1f} MB (Delta: {mem_delta:.1f} MB)")
    
    # Steps
    s5 = run_step_5_basic(model, tokenizer)
    s6 = run_step_6_industrial(model, tokenizer)
    s7 = run_step_7_grounded_rag(model, tokenizer)
    s8_9 = run_step_8_and_9_json(model, tokenizer)
    s10 = run_step_10_long_context(model, tokenizer)
    s11 = run_step_11_streaming(model, tokenizer)
    s13 = run_step_13_benchmark(model, tokenizer)
    
    final_results = {
        "cold_load_time_s": cold_load_time,
        "memory_delta_mb": mem_delta,
        "final_process_memory_mb": get_mem_mb(),
        "step_5": s5,
        "step_6": s6,
        "step_7": s7,
        "step_8_9": s8_9,
        "step_10": s10,
        "step_11": s11,
        "step_13": s13
    }
    
    out_file = os.path.join(os.path.dirname(__file__), "phase1_results.json")
    with open(out_file, "w") as f:
        json.dump(final_results, f, indent=2)
    print(f"\nAll validation results saved to: {out_file}")

if __name__ == "__main__":
    main()
