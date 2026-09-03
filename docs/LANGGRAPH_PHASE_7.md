# SovereignAI — LangGraph Phase 7: SSE Streaming & Real-Time Agent Observability

**Phase:** Phase 7 — LangGraph SSE Streaming & Real-Time Agent Observability  
**Date:** September 3, 2026  
**Status:** Completed, Verified & In Production  
**Transport:** Server-Sent Events (`text/event-stream`)  
**Endpoints:** `GET /api/v1/agent/runs/:runId/stream`, `GET /api/v1/inspection/runs/:runId/stream`  
**Durable System of Record:** PostgreSQL (`agent_runs`, `agent_run_steps`, `reports`)

---

## 1. Executive Summary & Purpose

Phase 7 implements real-time execution observability for both the **Autonomous Tool Agent** and the **Inspection Workflow** using standard Server-Sent Events (SSE).

In prior phases:
- **LangGraph** orchestrates execution state and cyclic decision routing.
- **PostgreSQL** provides permanent, durable state and step history.

Phase 7 adds the live event transport:
- As LangGraph executes transitions (node start, tool call, validation check, retry, completion, failure), operational events are pushed in real time to connected clients over an authorized, tenant-isolated SSE stream.
- The existing HTTP POST endpoints (`POST /api/v1/agent/run` and `POST /api/v1/inspection/workflow`) remain 100% untouched and continue returning their full JSON payloads upon completion.
- SSE failures or client disconnects are completely non-blocking: they never abort or compromise an active AI workflow.

---

## 2. SSE Architecture

```text
                      User / Client
                      │          ▲
                      │          │ Live SSE Event Stream
        1. POST /run  │          │ (GET /runs/:runId/stream)
                      ▼          │
             ┌───────────────────┴────────────────┐
             │       Express API Controller       │
             └───────────────────┬────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │    LangGraph Engine   │
                     │  (StateGraph.stream)  │
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
       PostgreSQL Persistence          Execution Events Broker
         (Authoritative DB)           (execution-events.service)
        ├── agent_runs                           │
        └── agent_run_steps                      ├── Replay Cache
                                                 ├── Tenant Scoping
                                                 ├── Data Sanitization
                                                 └── Heartbeat Timers
                                                         │
                                                         ▼
                                                text/event-stream
```

---

## 3. SSE Event Model & Types

Events emitted conform to standard SSE formatting (`event: <type>\nid: <id>\ndata: <json>\n\n`):

| Event Name | Emitter Source | Payload Contents | Description |
| :--- | :--- | :--- | :--- |
| `connected` | Event Broker | `{ runId, timestamp }` | Immediate handshake upon establishing stream |
| `run_started` | Orchestrator | `{ runId, engine: "langgraph", status: "in_progress", goal/documentId }` | Workflow initiated |
| `node_started` | LangGraph Stream | `{ runId, node, step }` | LangGraph node entered |
| `node_completed` | LangGraph Stream | `{ runId, node, step, durationMs, actionType }` | LangGraph node execution finished |
| `tool_started` | Agent Orchestrator | `{ runId, tool, step, arguments }` | Tool execution initiated with sanitized arguments |
| `tool_completed` | Agent Orchestrator | `{ runId, tool, status, durationMs, step }` | Tool execution finished with performance metrics |
| `validation` | Inspection Stream | `{ runId, validator, valid, ... }` | Finding schema, SOP evidence, or risk validation check |
| `run_completed` | Orchestrator | `{ runId, status: "completed", totalSteps, durationMs, answer/report }` | Successful workflow termination |
| `run_stopped` | Orchestrator | `{ runId, status, stoppedReason, totalSteps }` | Bounded exit (`max_steps_reached` or `insufficient_evidence`) |
| `run_failed` | Orchestrator | `{ runId, status: "failed", reason }` | Safe failure or error termination |
| `: heartbeat` | Event Broker | SSE comment (`: heartbeat\n\n`) | Periodic ping (every 15s) to prevent socket timeouts |

---

## 4. Endpoints & Tenant Isolation

### Endpoints
1. `GET /api/v1/agent/runs/:runId/stream`
2. `GET /api/v1/inspection/runs/:runId/stream`

### Authorization & Multi-Tenant Security
1. **Tenant Identification:** `resolveOrganizationId(req)` resolves the requesting tenant via `x-organization-id` header (or auth context).
2. **Pre-Handshake Verification:**
   - For agent runs: queries PostgreSQL `agent_runs` matching `run_id` AND `organization_id`. Also checks active broker owner cache.
   - For inspection runs: checks broker owner registry for tenant ownership.
3. **Cross-Tenant Blocking:**
   - If Organization B requests a stream for an Organization A run, the backend immediately returns `404 Not Found` without establishing the SSE stream.
4. **Data Sanitization (`sanitizePayload`):**
   - Strips passwords, authorization tokens, secrets, and API keys (`"[REDACTED]"`).
   - Replaces raw binary buffers with length summaries (`"<Buffer of N bytes>"`).
   - Truncates oversized strings (>2000 characters) to prevent bandwidth saturation.
   - Never exposes internal chain-of-thought tokens or private prompts.

---

## 5. Race Conditions, Replay, & Reconnection

- **Late-Connecting Clients:** Because client connections might race slightly behind the initial `POST` request, `executionEvents.service.js` maintains an in-memory ring buffer (up to 100 events per `runId` with 5-minute TTL). Upon subscription, all historical events are replayed immediately before live events stream.
- **Reconnection with `Last-Event-ID`:** When reconnecting after a network interruption, clients passing `Last-Event-ID: <id>` only receive events emitted *after* that ID, avoiding duplicate event handling.
- **PostgreSQL Fallback:** If memory cache has expired, `agent_run_steps` from PostgreSQL are replayed chronologically.

---

## 6. Disconnect Handling & Non-Blocking Isolation

- **Clean Disconnects:** Handled via `req.on("close")`. Periodic heartbeat timers and subscriber references are immediately purged, preventing memory or socket leaks.
- **AI Workflow Independence:** SSE publishing is entirely non-blocking. If an SSE client disconnects, experiences high latency, or throws an EPIPE socket error:
  - The subscriber is cleanly removed.
  - LangGraph and PostgreSQL continue executing normally.
  - The `POST` API request returns the final result successfully.

---

## 7. Verification & Regression Test Results

All 14 test suites passed with **0 regressions**:

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| **Phase 7 SSE Observability Suite** | `node tests/sse.test.js` | **27/27 PASSED** |
| **Phase 7 Live SSE End-to-End Verification** | `node tests/sse.live.test.js` | **PASSED (Agent + Inspection Streams)** |
| **Agent PostgreSQL Persistence Suite** | `node tests/agent.persistence.test.js` | **33/33 PASSED** |
| **Agent HTTP Endpoint Live Integration** | `node tests/agent.endpoint.test.js` | **PASSED (POST /run + Observability APIs)** |
| **Autonomous Agent LangGraph Suite** | `node tests/agent.graph.test.js` | **46/46 PASSED** |
| **Inspection LangGraph State Machine** | `npm run test:graph` | **36/36 PASSED** |
| **Inspection Migration Equivalence** | `node tests/inspection.migration.test.js` | **15/15 PASSED** |
| **Structured Output & Retry Logic** | `node tests/inspection.structured.test.js` | **6/6 PASSED** |
| **Model Router Classification & Fallback** | `node tests/router.test.js` | **14/14 PASSED** |
| **Secure Coding Sandbox** | `node tests/sandbox.test.js` | **7/7 PASSED** |
| **Local Multimodal Vision** | `node tests/vision.test.js` | **14/14 PASSED** |
| **Reports Persistence & API** | `node tests/reports.test.js` | **PASSED** |
| **Chat Conversations & Persistence** | `node tests/chat.test.js` | **PASSED** |
| **Backend Full Integration E2E** | `node tests/backend.e2e.test.js` | **PASSED** |

---

## 8. Known Limitations & Next Steps

- **Frontend Integration:** The backend SSE streaming interface is complete and live-verified. Building UI components in the React/Next.js frontend to consume these streams is reserved for the frontend phase.
- **No WebSockets or Message Queues:** By design, SSE uses standard HTTP and in-process Node.js pub/sub, keeping deployment lightweight without Redis or Kafka dependencies.
