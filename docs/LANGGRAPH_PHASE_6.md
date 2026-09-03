# SovereignAI — LangGraph Phase 6: Persistent Agent State & Observability

**Phase:** Phase 6 — Persistent Agent State & Observability  
**Date:** September 3, 2026  
**Status:** Completed, Verified & In Production  
**Persistence Layer:** PostgreSQL (`agent_runs`, `agent_run_steps`)  
**Feature Flag:** `AGENT_ORCHESTRATOR=langgraph` (Default) | `legacy` (Rollback)

---

## 1. Executive Summary & Purpose

Phase 6 implements durable PostgreSQL persistence and step-by-step observability for SovereignAI's general-purpose autonomous tool agent.

While LangGraph manages transient state and cyclic decision routing during execution, PostgreSQL serves as the permanent system of record. Every agent execution now persists:
1. High-level run metadata (status, duration, model, step count, outcome, final answer).
2. Granular chronological trace steps (actions, sanitized tool arguments, execution summaries, step durations).
3. Strict multi-tenant isolation enforcing organization boundaries.

---

## 2. Architecture Diagram

```text
                    User
                      │
                      ▼
             POST /api/v1/agent/run
                      │
                      ▼
              Agent Orchestrator
                      │
                      ▼
             ┌─────────────────┐
             │    LangGraph    │
             │                 │
             │ initialize      │
             │ reason          │
             │ execute_tool    │
             │ validate        │
             │ reason ↺        │
             │ final/failure   │
             └────────┬────────┘
                      │
             ┌────────┴─────────┐
             ▼                  ▼
       Runtime State       PostgreSQL
      (Transient Memory)        │
                        ┌───────┴────────┐
                        ▼                ▼
                    agent_runs      agent_run_steps
                 (Execution Meta)  (Timeline Trace)
```

---

## 3. PostgreSQL Schema Definition

Both tables are managed through:
- Migration: [`backend/src/db/migrations/001_agent_runs.sql`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/db/migrations/001_agent_runs.sql)
- Verification/Bootstrap: [`backend/src/config/db.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/config/db.js)

### Table: `agent_runs`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(255)` | `PRIMARY KEY` | Internal UUID |
| `run_id` | `VARCHAR(255)` | `UNIQUE NOT NULL` | Execution UUID from LangGraph state |
| `user_id` | `VARCHAR(255)` | `REFERENCES users(id) ON DELETE SET NULL` | Requesting analyst identifier |
| `organization_id` | `VARCHAR(255)` | `NOT NULL REFERENCES organizations(id)` | Multi-tenant scoping foreign key |
| `goal` | `TEXT` | `NOT NULL` | User problem statement or query |
| `model` | `VARCHAR(255)` | | Ollama model utilized for planning |
| `status` | `VARCHAR(50)` | `NOT NULL DEFAULT 'pending'` | `'in_progress'` \| `'completed'` \| `'failed'` |
| `stopped_reason` | `VARCHAR(50)` | | `'completed'` \| `'max_steps_reached'` \| `'timeout'` \| `'safe_failure'` |
| `total_steps` | `INTEGER` | `DEFAULT 0` | Total tool and reasoning steps executed |
| `duration_ms` | `INTEGER` | `DEFAULT 0` | Total end-to-end execution time in ms |
| `final_answer` | `TEXT` | | Synthesized final response |
| `error` | `TEXT` | | Error description if status is failed |
| `started_at` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Initiation timestamp |
| `completed_at` | `TIMESTAMPTZ`| | Completion or failure timestamp |
| `created_at` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Last updated timestamp |

**Indexes:**
- `idx_agent_runs_run_id` ON `agent_runs (run_id)` (`UNIQUE`)
- `idx_agent_runs_organization_id` ON `agent_runs (organization_id)`
- `idx_agent_runs_user_id` ON `agent_runs (user_id)`
- `idx_agent_runs_org_created_at` ON `agent_runs (organization_id, created_at DESC)`

---

### Table: `agent_run_steps`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | `VARCHAR(255)` | `PRIMARY KEY` | Internal step UUID |
| `run_id` | `VARCHAR(255)` | `NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE` | Link to parent run |
| `step_number` | `INTEGER` | `NOT NULL` | 1-based sequential step index |
| `node` | `VARCHAR(100)` | `NOT NULL` | LangGraph node (`'execute_tool'`, `'final_answer'`, `'reason'`) |
| `action` | `VARCHAR(50)` | | `'tool_call'`, `'final'`, or `'step'` |
| `tool_name` | `VARCHAR(100)` | | Name of invoked tool (e.g. `'calculator'`, `'document_search'`) |
| `tool_arguments` | `JSONB` | | Sanitized parameters (no secrets or raw binaries) |
| `tool_result_summary` | `TEXT` | | Condensed output summary |
| `status` | `VARCHAR(50)` | | `'success'` \| `'error'` |
| `duration_ms` | `INTEGER` | `DEFAULT 0` | Tool execution duration in ms |
| `created_at` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Step recording timestamp |

**Indexes:**
- `idx_agent_run_steps_run_id` ON `agent_run_steps (run_id)`
- `idx_agent_run_steps_run_step` ON `agent_run_steps (run_id, step_number ASC)`

---

## 4. LangGraph $\rightarrow$ PostgreSQL Lifecycle

The lifecycle is orchestrated in [`backend/src/services/agent-orchestrator.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/agent-orchestrator.service.js):

1. **Initiation (`status: "in_progress"`):**
   - When `runAgentWorkflow()` begins, an initial row is inserted into `agent_runs` with `runId`, `organizationId`, `userId`, `goal`, and `started_at`.
2. **LangGraph Execution:**
   - Graph iterates through `initialize` $\rightarrow$ `reason` $\rightarrow$ `execute_tool` $\rightarrow$ `validate_tool_result` $\rightarrow$ `final_answer`.
3. **Step Persistence:**
   - Upon completion, each recorded trace step is inserted into `agent_run_steps` with sanitized arguments, output summaries, and durations.
4. **Completion (`status: "completed"` or `"failed"`):**
   - `agent_runs` is updated with `stoppedReason`, `totalSteps`, `durationMs`, `finalAnswer`, and `completedAt`.
5. **Non-Blocking Observability:**
   - Observability writes are wrapped in safe error handlers. A database logging glitch will never compromise or abort a successful AI agent run.

---

## 5. Security & Multi-Tenant Isolation

- **Tenant Scoping:** All queries in [`backend/src/repositories/agent.repository.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/repositories/agent.repository.js) enforce `organization_id` matching:
  ```sql
  SELECT * FROM agent_runs WHERE run_id = $1 AND organization_id = $2
  ```
- **Cross-Tenant Blocking:** A request from Organization B requesting a run belonging to Organization A receives an HTTP 404.
- **SQL Injection Prevention:** 100% of queries use parameterized queries (`$1, $2, ...`). Zero string interpolation.
- **Data Sanitization:** Raw base64 buffers and large file streams are filtered or summarized before storing in `tool_arguments` JSONB.

---

## 6. Observability HTTP Endpoints

Exposed in [`backend/src/controllers/agent.controller.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/controllers/agent.controller.js) and [`backend/src/routes/agent.routes.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/routes/agent.routes.js):

- `POST /api/v1/agent/run`: Initiates bounded agent workflow and persists records.
- `GET /api/v1/agent/runs`: Lists runs for the requesting organization (supports `limit`, `offset`, `status`).
- `GET /api/v1/agent/runs/:runId`: Fetches details of a specific execution run.
- `GET /api/v1/agent/runs/:runId/steps`: Fetches the chronological execution timeline steps for a run.

---

## 7. Verification & Regression Test Results

All 12 test suites passed with **0 regressions**:

| Test Suite | Command | Result |
| :--- | :--- | :--- |
| **Agent PostgreSQL Persistence Suite** | `node tests/agent.persistence.test.js` | **33/33 PASSED** |
| **Agent Live PostgreSQL Verification** | `node tests/agent.live.verify.js` | **PASSED (Normal + Bounded Exit)** |
| **Agent HTTP Endpoint Live Integration** | `node tests/agent.endpoint.test.js` | **PASSED (HTTP E2E + Observability APIs)** |
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

## 8. Known Limitations & Future Work

- **Inspection Persistence Separation:** Inspection reports continue using the existing `reports` table; general agent executions use `agent_runs`. They remain decoupled.
- **No SSE / Streaming Yet:** Execution results and step records are written and retrieved via REST APIs. Live streaming will be added in a future phase.
- **Frontend Agent Workspace:** A UI dashboard to view the timeline from `GET /api/v1/agent/runs/:runId/steps` can be implemented in frontend phases.
