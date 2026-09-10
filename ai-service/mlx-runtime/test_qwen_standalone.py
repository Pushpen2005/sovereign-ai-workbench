import time
import os
import sys
import json
import psutil
import mlx.core as mx
from mlx_lm import load, generate

def get_process_memory():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / (1024 * 1024)

def main():
    model_path = os.path.abspath("models/qwen2.5-coder-3b-4bit")
    print(f"Loading model from: {model_path}")

    initial_mem = get_process_memory()
    print(f"Initial process memory: {initial_mem:.1f} MB")

    # Cold load
    t0 = time.perf_counter()
    model, tokenizer = load(model_path)
    cold_load_time = time.perf_counter() - t0
    post_load_mem = get_process_memory()
    mem_delta = post_load_mem - initial_mem

    print(f"Cold load time: {cold_load_time:.3f} s")
    print(f"Memory delta: {mem_delta:.1f} MB (Total: {post_load_mem:.1f} MB)")

    prompt = "Write a Python function that calculates the average of a list of numbers and handles an empty list safely."
    
    # We apply chat template if available
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        formatted_prompt = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True
        )
    else:
        formatted_prompt = prompt

    print("\n--- COLD INFERENCE ---")
    t1 = time.perf_counter()
    response = generate(model, tokenizer, prompt=formatted_prompt, max_tokens=256, verbose=False)
    cold_latency = time.perf_counter() - t1
    cold_tokens = len(tokenizer.encode(response))
    cold_tps = cold_tokens / cold_latency if cold_latency > 0 else 0
    print(f"Cold inference latency: {cold_latency:.3f} s | Tokens: {cold_tokens} | TPS: {cold_tps:.2f}")
    print("Generated code preview:\n", response[:200], "...\n")

    print("--- 3 WARM RUNS ---")
    warm_results = []
    for i in range(1, 4):
        t_start = time.perf_counter()
        resp = generate(model, tokenizer, prompt=formatted_prompt, max_tokens=256, verbose=False)
        dur = time.perf_counter() - t_start
        num_tokens = len(tokenizer.encode(resp))
        tps = num_tokens / dur if dur > 0 else 0
        print(f"Warm run #{i}: latency={dur:.3f}s | tokens={num_tokens} | tps={tps:.2f}")
        warm_results.append({
            "run": i,
            "latency": dur,
            "tokens": num_tokens,
            "tps": tps,
            "response": resp
        })

    avg_latency = sum(r["latency"] for r in warm_results) / len(warm_results)
    avg_tps = sum(r["tps"] for r in warm_results) / len(warm_results)
    print(f"\nAverage warm latency: {avg_latency:.3f} s")
    print(f"Average warm TPS: {avg_tps:.2f} tok/s")

    result_data = {
        "model_path": model_path,
        "cold_load_time_s": cold_load_time,
        "initial_memory_mb": initial_mem,
        "post_load_memory_mb": post_load_mem,
        "memory_delta_mb": mem_delta,
        "cold_run": {
            "latency": cold_latency,
            "tokens": cold_tokens,
            "tps": cold_tps,
            "response": response
        },
        "warm_runs": warm_results,
        "avg_warm_latency_s": avg_latency,
        "avg_warm_tps": avg_tps
    }

    with open("qwen_phase3_results.json", "w") as f:
        json.dump(result_data, f, indent=2)
    print("Results saved to qwen_phase3_results.json")

if __name__ == "__main__":
    main()
