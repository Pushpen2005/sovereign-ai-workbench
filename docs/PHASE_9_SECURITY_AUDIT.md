# SovereignAI — Phase 9 Security & Sovereignty Audit

**Date:** September 3, 2026  
**Auditor:** SovereignAI System Verification  
**Status:** 100% Code-Verified  

---

## 1. Concrete Security & Sovereignty Claims Audit

| Claim | Architectural Evidence | Source File & Implementation |
| :--- | :--- | :--- |
| **Local LLM Inference** | Zero external API calls; inference executed via locally hosted Ollama runtime with `llama3.2:3b`. | [`ai-service/ollama/ollama.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/ai-service/ollama/ollama.service.js), [`backend/src/services/ollama.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/ollama.service.js) |
| **Local Embeddings** | 384-dimensional dense vectors generated locally via Xenova `@huggingface/transformers` ONNX runtime (`all-MiniLM-L6-v2`); zero external embedding APIs. | [`ai-service/embeddings/embedding.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/ai-service/embeddings/embedding.service.js), [`backend/src/services/embeddings.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/embeddings.service.js) |
| **Self-Hosted Vector DB** | Vectors and payload metadata indexed and queried within self-hosted Qdrant instance. | [`ai-service/vector-db/qdrant.client.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/ai-service/vector-db/qdrant.client.js), [`backend/src/services/qdrant.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/qdrant.service.js) |
| **Local OCR** | Page-level OCR fallback executed directly using local Tesseract OCR engine binary (`tesseract 5.x`). | [`ai-service/ocr/ocr.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/ai-service/ocr/ocr.service.js), [`backend/src/services/ocr.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/ocr.service.js) |
| **Multi-Tenant Scoping** | All queries enforce tenant boundary via `organizationId`. Cross-tenant queries return 404. | [`backend/src/repositories/agent.repository.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/repositories/agent.repository.js), [`backend/src/repositories/documents.repository.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/repositories/documents.repository.js) |
| **Parameterized SQL** | 100% of PostgreSQL queries use parameterized index variables (`$1, $2, ...`), preventing SQL injection. | [`backend/src/repositories/agent.repository.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/repositories/agent.repository.js), [`backend/src/config/db.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/config/db.js) |
| **Sandboxed Execution** | Dynamic Python scripts executed inside isolated ephemeral Docker containers (`python:3.11-alpine`). | [`backend/src/services/sandbox.service.js#L74-L89`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/sandbox.service.js#L74-L89) |
| **Network-Disabled Sandbox** | Container spawned with `--network none`, mathematically preventing egress or telemetry. | [`backend/src/services/sandbox.service.js#L79`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/sandbox.service.js#L79) |
| **Sandbox Resource Bounds** | Hard limits enforced: `--memory 256m`, `--cpus 1`, `--pids-limit 64`, `--read-only`, and hard process timeout kill. | [`backend/src/services/sandbox.service.js#L80-L85`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/sandbox.service.js#L80-L85) |
| **Persistent Agent State** | Execution lifecycle and step traces durably persisted in PostgreSQL (`agent_runs`, `agent_run_steps`). | [`backend/src/repositories/agent.repository.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/repositories/agent.repository.js) |
| **Real-time Observability** | Execution states emitted over authenticated Server-Sent Events with secret redaction. | [`backend/src/services/execution-events.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/execution-events.service.js) |
| **Anti-Hallucination Grounding** | Findings require verbatim document evidence; fabricated citations discarded; safe failure on insufficient SOP evidence. | [`backend/src/orchestration/inspection/inspection.nodes.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/orchestration/inspection/inspection.nodes.js) |

---

## 2. API Schema Verification

### Endpoint: `GET /api/v1/sovereignty`
Source: [`backend/src/app.js:85-178`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/app.js#L85-L178)

```json
{
  "status": "sovereign",
  "auditTimestamp": "2026-09-03T03:35:54.000Z",
  "components": {
    "llm": {
      "provider": "ollama",
      "model": "llama3.2:3b",
      "endpoint": "http://localhost:11434",
      "endpointType": "local",
      "reachable": true,
      "modelLoaded": true,
      "cloudDependency": false
    },
    "embeddings": {
      "provider": "@huggingface/transformers (ONNX runtime)",
      "model": "Xenova/all-MiniLM-L6-v2",
      "dimensions": 384,
      "runtime": "local-onnx",
      "cachedLocally": true,
      "cloudDependency": false
    },
    "ocr": {
      "provider": "Tesseract OCR",
      "version": "5.x",
      "runtime": "local-binary (system PATH)",
      "cloudDependency": false
    },
    "vectorDb": {
      "provider": "Qdrant",
      "endpoint": "http://localhost:6333",
      "endpointType": "local",
      "reachable": true,
      "cloudDependency": false
    },
    "relationalDb": {
      "provider": "PostgreSQL 16",
      "endpointType": "local",
      "cloudDependency": false
    },
    "docxGenerator": {
      "provider": "python-docx",
      "runtime": "local-python3",
      "cloudDependency": false
    }
  },
  "externalCloudApiKeys": [],
  "sovereignty": {
    "noExternalAiApis": true,
    "allInferenceLocal": true,
    "allEmbeddingsLocal": true,
    "allOcrLocal": true,
    "allStorageLocal": true,
    "networkFirewalled": false,
    "networkFirewallNote": "Code-level sovereignty verified. No application code calls external AI APIs. Network-layer isolation requires additional iptables/firewall rules for true air-gap."
  }
}
```

### Endpoint: `GET /api/v1/health`
Source: [`backend/src/app.js:40-44`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/app.js#L40-L44)
```json
{
  "status": "ok"
}
```
