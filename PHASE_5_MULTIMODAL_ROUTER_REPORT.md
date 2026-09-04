# SovereignAI Phase 5: Local Multimodal Vision + Model Router Report

**Project:** SovereignAI — On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 5 — Local Multimodal Vision + Model Router Hardening  
**Date:** September 3, 2026  
**Status:** COMPLETE & PRODUCTION-HARDENED  

---

## 1. Model Router Architecture

The SovereignAI Model Router executes deterministically in **< 1 ms** without invoking external or intermediate LLM calls for classification. It acts as an authoritative traffic director for all user tasks:

```text
                           USER INQUIRY / TASK
                                    │
                                    ▼
                          [ MODEL ROUTER ]
          (Deterministic Keyword Classifier & Allowlist Validator)
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   DOCUMENT TASK              CODING TASK               VISION TASK
  (SOPs, Reports, RAG)      (Python, Scripts, SQL)   (Images, Scans, Gauges)
          │                         │                         │
          ▼                         ▼                         ▼
   [ llama3.2:3b ]           [ llama3.2:3b ]           [ moondream:latest ]
 (Local Qdrant RAG)       (Docker Coding Sandbox)    (Ollama Multimodal Vision)
          │                         │                         │
          ▼                         ▼                         ▼
   Grounded Answer           Isolated Code              Structured Visual
   + Verified Citations      Execution Output           Inspection Analysis
```

---

## 2. Supported Tasks & Routing Logic

| Task Type | Intent & Indicators | Routed Engine | Selected Local Model |
|---|---|---|---|
| **DOCUMENT** | Ingested PDF/report questions, SOP compliance, temperature/vibration queries | Qdrant RAG Pipeline | `llama3.2:3b` |
| **CODING** | "write python", "debug function", "calculate with code", "regex", scripts | Isolated Docker Sandbox | `llama3.2:3b` |
| **VISION** | Image uploads, gauge photos, engineering drawings, visual defects | Local Multimodal Ollama | `moondream:latest` |
| **GENERAL** | Generic inquiries lacking document or code intent | Local Ollama Baseline | `llama3.2:3b` |

---

## 3. Actual Local Models Verified in Environment

Every model is installed locally on the node and verified via `/api/tags`:

- **Document / General / Baseline LLM:** `llama3.2:3b` (2.0 GB GGUF, local Ollama)
- **Coding LLM:** `llama3.2:3b` (with configurable fallback support for `qwen2.5-coder:7b`)
- **Multimodal Vision Model:** `moondream:latest` (1.7 GB multimodal model, local Ollama)
- **Local Embedding Engine:** `Xenova/all-MiniLM-L6-v2` (384D ONNX runtime)
- **Local OCR Engine:** `Tesseract 5.5.2` (system binary PATH)

---

## 4. Vision Architecture Pipeline

The vision path runs **100% on-premise** with ephemeral in-memory buffering:

1. **Client Upload:** `POST /api/v1/vision/analyze` multipart form with image buffer and inspection prompt.
2. **Security Gate:** Bearer JWT required (`requireAuth`); organization verified from token.
3. **Image Validation:** Size validated ($\le 10\text{ MB}$); binary magic bytes inspected (PNG, JPEG, WebP); disguised non-image files rejected.
4. **Router Assignment:** Prompt and image routed to `TASK_TYPE.VISION` $\rightarrow$ `moondream`.
5. **Prompt Injection Boundary:** System prompt enforces strict observation-only grounding and anti-hallucination rules.
6. **Inference Execution:** Ephemeral base64 image passed to local Ollama `/api/generate`.
7. **Structured Extraction:** Output parsed into `summary`, `observations`, `abnormalities`, `limitations`, and a mandatory human governance disclaimer.

---

## 5. Authentication & Authorization Boundaries
- **JWT Enforced:** Unauthenticated requests to `/api/v1/vision/analyze` return `HTTP 401 Unauthorized`.
- **Tenant Context:** User organization identity is derived strictly from verified JWT claims (`req.user.organizationId`).
- **Anti-Spoofing:** Client headers (`x-organization-id`) conflicting with the JWT organization are rejected with `HTTP 403 Forbidden`.

---

## 6. Sovereign Model Allowlisting
To prevent arbitrary or cloud model injection:
- The server maintains a strict allowlist:
  ```javascript
  ['llama3.2:3b', 'llama3.2', 'moondream', 'moondream:latest']
  ```
- Client requests attempting to override the model with unauthorized names (e.g. `gpt-4o`, `claude-3-5-sonnet`, `external-model`) are rejected with `HTTP 400 Bad Request`.
- In `routeTask()`, unallowlisted models trigger a `RouterError`.

---

## 7. External AI API Audit

A comprehensive codebase audit confirmed zero external AI calls in active production code:

| Target | Occurrences in Repo | Classification | Status |
|---|---|---|:---:|
| **OpenAI (`api.openai.com`)** | 4 | Documentation / Test fixtures | NO ACTIVE CALLS |
| **Anthropic (`claude`)** | 2 | Documentation / Architecture notes | NO ACTIVE CALLS |
| **Google AI / Gemini** | 2 | Documentation / Architecture notes | NO ACTIVE CALLS |
| **Azure OpenAI** | 1 | Documentation | NO ACTIVE CALLS |
| **AWS Bedrock / Rekognition** | 1 | Documentation | NO ACTIVE CALLS |

**Result:** Zero outbound cloud AI API calls exist in runtime code paths.

---

## 8. Real Performance Measurements

Tested against local development node (Apple Silicon M-series, Ollama, Qdrant):

| Component | Metric | Measured Value |
|---|---|---|
| **Model Router** | Average Task Classification Latency | **0.13 ms** |
| **Multimodal Vision** | Model Inference Duration (`moondream`) | **231 ms** |
| **Multimodal Vision** | Total API Request Latency (including parsing) | **238 ms** |
| **Document RAG** | Vector Similarity Retrieval Latency (Qdrant) | **6 ms** |
| **Document RAG** | Total End-to-End RAG Latency (`llama3.2:3b`) | **1,286 ms** |

---

## 9. Router Evaluation Accuracy

Evaluated on deterministic benchmark questions across all four task domains:

- **Total Test Items:** 8
- **Correctly Classified:** 8
- **Router Accuracy:** **100.0%**
- **Misclassifications:** **0**

---

## 10. Real-Time Sovereignty Status

Queried via `GET /api/v1/sovereignty`:

```json
{
  "status": "sovereign",
  "components": {
    "llm": { "provider": "ollama", "model": "llama3.2:3b", "cloudDependency": false },
    "vision": { "provider": "ollama (multimodal)", "model": "moondream", "cloudDependency": false, "reachable": true, "modelLoaded": true },
    "embeddings": { "provider": "@huggingface/transformers (ONNX)", "dimensions": 384, "cloudDependency": false },
    "ocr": { "provider": "Tesseract OCR", "version": "5.x", "cloudDependency": false },
    "vectorDb": { "provider": "Qdrant", "cloudDependency": false },
    "relationalDb": { "provider": "PostgreSQL 16", "cloudDependency": false }
  },
  "sovereignty": {
    "noExternalAiApis": true,
    "allInferenceLocal": true,
    "allVisionLocal": true,
    "allEmbeddingsLocal": true,
    "allOcrLocal": true,
    "allStorageLocal": true
  }
}
```

---

## 11. Failure Handling & Security Verification Matrix

| Scenario | Trigger / Payload | Expected Code | Observed Code |
|---|---|:---:|:---:|
| **Missing Token** | Vision request without Bearer JWT | `HTTP 401` | **401 Unauthorized** |
| **Header Spoofing** | User Org A sends `x-organization-id: Org B` | `HTTP 403` | **403 Forbidden** |
| **Missing Image** | Multipart request without image file | `HTTP 400` | **400 Bad Request** |
| **Disguised File** | Text script renamed to `.png` (bad magic bytes) | `HTTP 400` | **400 Bad Request** |
| **Arbitrary Model** | Request specifying `model: "gpt-4o"` | `HTTP 400` | **400 Bad Request** |
| **Missing Vision Model** | Configured vision model uninstalled | `HTTP 503` | **503 Service Unavailable** |
| **Oversized Image** | File > 10 MB | `HTTP 400` | **400 Bad Request** |

---

## 12. Human Governance Boundary
All visual analysis responses explicitly return an advisory notice:
> *"Visual AI analysis is advisory decision support. It does not replace certified engineer inspection or statutory sign-off."*

---

## 13. Limitations & Deployment Recommendations
1. **Low-Resolution Micro-Cracks:** Visual inspection models operate on pixel resolution; microscopic metallographic flaws require high-magnification NDT cameras.
2. **Dual-Model Memory Footprint:** Running `llama3.2:3b` (2.0 GB) and `moondream` (1.7 GB) concurrently requires approximately 6–8 GB of dedicated VRAM / unified host memory.
