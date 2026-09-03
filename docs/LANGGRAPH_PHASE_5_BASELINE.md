# SovereignAI — LangGraph Phase 5: Autonomous Agent Baseline Audit

**Document:** Baseline Analysis of Bespoke `runAgentLoop()`  
**Date:** September 3, 2026  
**Status:** Audit Complete  
**Source File:** `backend/src/services/agent.service.js`

---

## 1. Executive Summary

This document captures the line-by-line operational behavior of the general-purpose autonomous tool agent in `backend/src/services/agent.service.js` prior to migrating its orchestration runtime to LangGraph.

The agent coordinates multi-step investigations across local on-premise tools (Qdrant semantic document retrieval, file reading, deterministic safe AST arithmetic, isolated Docker Python execution, DOCX generation, and local multimodal vision).

---

## 2. Operation Mapping & Loop Flow

```
runAgentLoop(input)
  │
  ├─► 1. Input Validation: Verify `goal` is a non-empty string (raises `AgentRuntimeError`)
  ├─► 2. Model Routing: Query `routeTask(cleanGoal)` to select local model (default: `llama3.2:3b`)
  │
  ▼
  [WHILE loop: stepCount < maxSteps && duration < timeoutMs]
  │
  ├─► 3. Prompt Construction: `buildAgentPlannerPrompt(cleanGoal, stepHistory)`
  │     - Injects registered tool signatures from `TOOL_REGISTRY`
  │     - Formats historical execution trace with summaries and details
  │     - Enforces JSON contract: Option A (`tool_call`) vs Option B (`final`)
  │
  ├─► 4. Local Inference: `generateAnswer(prompt, model, { format: "json" })`
  │
  ├─► 5. Action Parsing: `parseActionJSON(llmResponse)`
  │     - Strips markdown code blocks (` ```json ... ``` `)
  │     - Substrings between first `{` and last `}`
  │     - Single-attempt repair retry prompt if initial parse fails
  │
  ├─► 6. Action Decision Branching:
  │     ├─► Case A: `type === "final"`
  │     │     - Assigns `finalAnswer = action.answer`
  │     │     - Records final step in trace
  │     │     - Sets `stoppedReason = "completed"`
  │     │     - BREAK loop
  │     │
  │     ├─► Case B: `type === "tool_call"`
  │     │     - Validates tool against `TOOL_REGISTRY` whitelist
  │     │     - Executes `executeRegisteredTool(toolName, toolArgs)`
  │     │     - Summarizes output via `summarizeToolResult()`
  │     │     - Sanitizes arguments via `sanitizeArgsForDisplay()`
  │     │     - Collects sources if `document_search`
  │     │     - Captures deliverable if `document_generate`
  │     │     - Appends trace step to `steps` and execution history to `stepHistory`
  │     │     - CONTINUE loop
  │     │
  │     └─► Case C: Unknown action type / unrecoverable parse failure
  │           - Sets `stoppedReason` (`"invalid_json"` / `"unknown_action_type"`)
  │           - Generates error explanation
  │           - BREAK loop
  │
  ▼
  [Post-Loop Synthesis & Formatting]
  │
  ├─► 7. Boundary Enforcements:
  │     - If `stepCount >= maxSteps` and no `finalAnswer`, synthesizes answer from step history
  │     - If `duration >= timeoutMs`, sets `stoppedReason = "timeout"`
  ├─► 8. Source Deduplication: Deduplicates `collectedSources` by `filename:page:chunkIndex`
  └─► 9. Final Contract: Returns `{ success, goal, model, answer, steps, sources, deliverable, stoppedReason, totalSteps, durationMs }`
```

---

## 3. Tool Allowlist & Security Boundaries

The agent executes local tools strictly through `backend/src/services/agentTools/toolRegistry.js`:

| Tool Name | Underlying Module | Security Boundary |
| :--- | :--- | :--- |
| `document_search` | `documentSearch.tool.js` | Vector search in Qdrant (cosine 384). Validates query string; limit capped at 10. |
| `file_read` | `fileRead.tool.js` | Disallows path traversal (`..`, `/etc/passwd`). Reads only indexed catalog chunks. |
| `calculator` | `calculator.tool.js` | Deterministic AST math parser. Zero `eval()`, zero code execution. Only math functions. |
| `execute_sandbox_code` | `sandboxCode.tool.js` | Executes inside isolated Docker container with network disabled, CPU/RAM caps, 2s timeout. |
| `document_generate` | `documentGenerate.tool.js`| Compiles structured sections into audit-ready `.docx` deliverable in `/generated`. |
| `analyze_image` | `toolRegistry.js` | Multimodal visual inspection using local vision model via Ollama. |

Arbitrary tool names or commands (e.g. `bash`, `rm`, `eval`) are rejected by `executeRegisteredTool()` with HTTP-safe errors.

---

## 4. Hard Constraints & State Invariants to Preserve in LangGraph

1. **Step Boundary:** Default `maxSteps = 8`.
2. **Timeout Boundary:** Default `timeoutMs = 60,000ms`.
3. **No Unbounded Loops:** The graph must strictly terminate if `currentStep >= maxSteps`.
4. **Local Sovereignty:** 100% on-premise inference via local Ollama (`llama3.2:3b`). External cloud AI APIs = 0.
5. **No Direct Sandbox Shell:** The agent calls `executeSandboxCode` as a tool, preserving container isolation.
6. **API Response Compatibility:** Callers of `POST /api/v1/agent/run` must receive the exact response structure with `{ success, goal, model, answer, steps, sources, deliverable, stoppedReason, totalSteps, durationMs }` plus non-breaking `orchestration: { engine: "langgraph", ... }`.
7. **Rollback Mechanism:** Feature flag `AGENT_ORCHESTRATOR=langgraph` (default) with zero-downtime rollback to `AGENT_ORCHESTRATOR=legacy`.
