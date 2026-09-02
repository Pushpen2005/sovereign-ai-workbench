# SovereignAI — LangGraph Orchestration Architecture

**Phase:** Phase 1 — Orchestration Foundation & State Model  
**Date:** September 1, 2026  
**Status:** Graph Foundation Implemented & Verified  
**Package:** `@langchain/langgraph` v1.4.x (in `backend/package.json`)  
**Core Rule:** LangGraph is an **orchestrator only**. Existing RAG, vector retrieval, embeddings, OCR, and persistence services remain intact.

---

## 1. Why LangGraph is Being Introduced

In the initial implementation of the SovereignAI workbench, multi-step workflows were coordinated imperatively:
1. **Inspection Workflow (`backend/src/services/inspection.service.js`):** Coordinated via an imperative promise chain inside `runCompleteWorkflow()`.
2. **Autonomous Tool Agent (`backend/src/services/agent.service.js`):** Coordinated via an ad-hoc `while`-loop (`runAgentLoop()`) with regex-based JSON action parsing.

While functionally effective for early milestones, imperative orchestration introduces limitations as system complexity grows:
- **Lack of Explicit State Machine:** Step progression is implicit in promise flows rather than governed by a deterministic, inspectable state schema.
- **Inflexible Error Recovery:** Handling failures, partial retries, or branching requires nested `try/catch` logic across multiple functions rather than edge-based routing.
- **Observability & Auditability:** Industrial confidential documents require strict audit trails. A state graph provides native execution order tracing (`executionOrder`), run identifiers (`runId`), and granular node-level error boundaries.
- **Future Human-in-the-Loop & Checkpointing:** LangGraph natively supports state checkpointing (via `MemorySaver` or PostgreSQL savers) and interrupt signals for executive approvals prior to final DOCX report emission.

---

## 2. Why Existing RAG and AI Services Remain Unchanged

A critical architectural principle of SovereignAI is **strict air-gapped sovereignty**:
- All vector search is executed via a self-hosted Qdrant instance (`@qdrant/js-client-rest`).
- All embeddings are computed locally using `@huggingface/transformers` (ONNX runtime with `Xenova/all-MiniLM-L6-v2`, 384 dimensions).
- All OCR uses local binary Tesseract 5.x via Node child process.
- All LLM inference executes locally via Ollama (`llama3.2:3b`).
- All document reporting uses local `python-docx`.

**LangGraph does not replace, wrap, or rewrite any of these services.**  
LangGraph does **not** provide vector indexing, does not alter prompt formats, and does not alter the Qdrant schema. Instead, LangGraph acts purely as the **workflow director**, invoking existing production service functions at designated node steps.

---

## 3. LangGraph's Architectural Role

```
   ┌─────────────────────────────────────────────────────────────┐
   │                   LangGraph StateGraph                      │
   │               (Orchestrator & State Machine)                │
   └───────────────┬─────────────────────────────┬───────────────┘
                   │                             │
                   ▼                             ▼
       ┌───────────────────────┐     ┌───────────────────────┐
       │     State Schema      │     │    Node Transitions   │
       │ InspectionAgentState  │     │   START -> ... -> END │
       └───────────────────────┘     └───────────┬───────────┘
                                                 │ Delegates to
                                                 ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                    Existing SovereignAI Service Layer                         │
│  - ingestInspectionFile()           [backend/src/services/inspection.service] │
│  - searchSimilarChunks()            [ai-service/retrieval/retrieval.service]  │
│  - analyzeInspectionReport()        [ai-service/inspection/inspection.service]│
│  - searchSop()                      [ai-service/knowledge/sop.service]        │
│  - assessFindingRisk()              [ai-service/risk/risk.service]            │
│  - filterValidCitations()           [ai-service/risk/risk.schema]             │
│  - generateApprovalNote()           [ai-service/reports/approval-note.service]│
└───────────────────────────────────────────────────────────────────────────────┘
```

LangGraph's responsibilities:
1. Initialize and maintain the strongly-typed `InspectionAgentState`.
2. Sequentially route data through the 7 designated workflow steps.
3. Collect output updates through channel reducers without mutating state in place.
4. Capture any execution errors into the `errors` channel without crashing the process.
5. Provide a standardized contract for future checkpointing and human-in-the-loop approvals.

---

## 4. Target Graph Architecture

The inspection workflow is modeled as a linear, deterministic `StateGraph`:

```
                 [ START ]
                     │
                     ▼
                 ┌────────┐
                 │ ingest │
                 └───┬────┘
                     ▼
                ┌──────────┐
                │ retrieve │
                └────┬─────┘
                     ▼
             ┌──────────────────┐
             │ extract_findings │
             └───────┬──────────┘
                     ▼
               ┌──────────────┐
               │ retrieve_sop │
               └──────┬───────┘
                      ▼
               ┌─────────────┐
               │ assess_risk │
               └──────┬──────┘
                      ▼
            ┌────────────────────┐
            │ validate_citations │
            └─────────┬──────────┘
                      ▼
              ┌─────────────────┐
              │ generate_report │
              └───────┬─────────┘
                      ▼
                  [  END  ]
```

### Node Sequence:
1. `ingest`: Validates input and registers document ingestion metadata.
2. `retrieve`: Gathers multi-aspect candidate inspection chunks from Qdrant.
3. `extract_findings`: Runs structured extraction against domain findings schema with automatic retry.
4. `retrieve_sop`: Searches authoritative SOP documents using `documentType: "sop"` filtering.
5. `assess_risk`: Evaluates findings against SOP evidence to determine risk rating and recommendations.
6. `validate_citations`: Removes hallucinated citations by cross-verifying against retrieved chunks.
7. `generate_report`: Assembles validated data and compiles the executive Approval Note DOCX.

---

## 5. State Structure (`InspectionAgentState`)

Located in [`backend/src/orchestration/inspection/inspection.state.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/orchestration/inspection/inspection.state.js).

Implemented using LangGraph's `Annotation.Root({ ... })` with explicit channel reducers:

| State Field | Type | Reducer Semantics | Purpose |
| :--- | :--- | :--- | :--- |
| `runId` | String (UUID) | Replace | Unique invocation tracking ID |
| `documentId` | String (UUID) | Replace | Target inspection document ID |
| `task` | String | Replace | Prompt instruction / analysis task |
| `filePath` | String | Replace | Optional filesystem path to PDF |
| `organizationId` | String (UUID) | Replace | Multi-tenant organization scope |
| `ingestionResult` | Object | Replace | `{ documentId, filename, chunksStored }` |
| `retrievalResults` | Array\<Chunk\> | List Replace | Relevant candidate chunks from Qdrant |
| `findings` | Array\<Finding\> | List Replace | Validated inspection findings (PR #13 format) |
| `sopEvidence` | Array\<Chunk\> | List Replace | Authoritative SOP reference excerpts |
| `riskAssessment` | Object | Replace | Primary risk level (`HIGH`, `MEDIUM`, `LOW`, `null`) and reason |
| `riskAssessments` | Array\<Object\> | List Replace | Individual risk ratings for each finding |
| `recommendation` | String | Replace | Primary actionable recommendation |
| `recommendations` | Array\<String\> | List Replace | List of all finding recommendations |
| `citations` | Array\<Citation\>| List Replace | Verified citations (`documentId`, `filename`, `page`, `chunkIndex`) |
| `report` | Object | Replace | Generated DOCX metadata (`filename`, `downloadUrl`) |
| `currentNode` | String | Replace | Last executed node identifier |
| `executionOrder` | Array\<String\> | Accumulate | Chronological list of completed nodes |
| `status` | String | Replace | Lifecycle status (`pending`, `in_progress`, `completed`, `failed`) |
| `errors` | Array\<Object\> | Accumulate | Safe error tracking (`{ node, message, timestamp }`) |
| `metadata` | Object | Merge | Context parameters and run configuration |

---

## 6. Node Structure & Adapter Design

Located in [`backend/src/orchestration/inspection/inspection.nodes.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/orchestration/inspection/inspection.nodes.js).

To prevent breaking existing production flows during foundation setup, nodes are constructed via a factory pattern `createInspectionNodes(adapters)`:
- Each node accepts the current immutable `state`.
- Performs its designated orchestration task.
- Catches internal exceptions and returns `{ errors: [...], status: "failed" }` rather than throwing unhandled exceptions.
- Returns only the updated channels, allowing LangGraph reducers to merge updates cleanly.

### Existing Production Services Mapped to Nodes:

| Node Name | Production Service Invoked (Phase 2 Migration) | Existing File Location |
| :--- | :--- | :--- |
| `ingest` | `ingestInspectionFile(target, options)` | `backend/src/services/inspection.service.js` |
| `retrieve` | `resolveInspectionRetrievalQueries()` + `searchSimilarChunks()` | `ai-service/inspection/inspection.service.js`<br>`ai-service/retrieval/retrieval.service.js` |
| `extract_findings` | `analyzeInspectionReport(input, options)` | `ai-service/inspection/inspection.service.js` |
| `retrieve_sop` | `searchSop(sopQuery, options)` | `ai-service/knowledge/sop.service.js` |
| `assess_risk` | `assessFindingRisk(finding, options)` | `ai-service/risk/risk.service.js` |
| `validate_citations` | `filterValidCitations(citations, chunks)` | `ai-service/risk/risk.schema.js` |
| `generate_report` | `generateApprovalNote(data, options)` + `createReportRecord()` | `ai-service/reports/approval-note.service.js`<br>`backend/src/services/reports.service.js` |

---

## 7. Planned Phase 2 Migration Roadmap

Phase 1 establishes the compiled, tested state graph foundation. Phase 2 will wire production service invocations into the graph:

1. **Adapter Wiring:** Replace the thin stub adapters with direct calls to `ingestInspectionFile`, `analyzeInspectionReport`, `searchSop`, `assessFindingRisk`, and `generateApprovalNote`.
2. **Backward-Compatible Service Wrapper:** Update `runCompleteWorkflow(input, options)` in `backend/src/services/inspection.service.js` to execute `compiledInspectionGraph.invoke(initialState)` internally.
3. **HTTP Controller Integration:** Keep `POST /api/v1/inspection/workflow` response schema unchanged so frontend dashboards and existing E2E tests continue operating without modification.
4. **Tool Agent Graph (Phase 3):** Migrate `runAgentLoop()` from `backend/src/services/agent.service.js` to a LangGraph cyclical graph with tool-calling edges and safe AST calculator routing.

---

## 8. Verification & Test Coverage

The foundation is fully tested via [`backend/tests/inspection.graph.test.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/tests/inspection.graph.test.js):
- **Compilation:** Validates `createInspectionGraph()` compiles without errors.
- **State Passing:** Validates that `runId`, `documentId`, `task`, `organizationId`, and `metadata` initialize properly.
- **Graph Execution:** Validates end-to-end traversal from `START` to `END`.
- **Node Execution Ordering:** Strictly verifies `executionOrder` matches `['ingest', 'retrieve', 'extract_findings', 'retrieve_sop', 'assess_risk', 'validate_citations', 'generate_report']`.
- **State Propagation:** Verifies data flowing across all intermediate channels.
- **Safe Error Representation:** Verifies that validation failures or downstream exceptions populate the `errors` channel with `{ node, message }` and set `status: "failed"` without crashing the Node.js runtime.
- **Extensibility:** Verifies custom adapter injection for testing and Phase 2 migration.
