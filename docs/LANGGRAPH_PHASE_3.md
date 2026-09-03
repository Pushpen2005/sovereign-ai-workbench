# SovereignAI — LangGraph Phase 3: Production Cutover Documentation

**Phase:** Phase 3 — Production Cutover to LangGraph Orchestration  
**Date:** September 2, 2026  
**Status:** Completed, Fully Tested & Default in Production  
**Package:** `@langchain/langgraph` v1.4.x  
**Feature Flag:** `INSPECTION_ORCHESTRATOR=langgraph` (Default) | `legacy` (Rollback)

---

## 1. Executive Summary

Phase 3 transitions the SovereignAI confidential document inspection pipeline from an imperative Node.js promise chain to the compiled **LangGraph StateGraph**.

All underlying AI components remain completely untouched:
- Self-hosted Qdrant vector retrieval (cosine 384)
- Local ONNX embeddings (`all-MiniLM-L6-v2`)
- Local Ollama inference (`llama3.2:3b`)
- Tesseract OCR & page-aware PDF extraction
- Authoritative SOP knowledge base (`documentType="sop"`)
- Anti-hallucination citation validation
- Executive Approval Note DOCX artifact compilation (`python-docx`)
- PostgreSQL multi-tenant persistence
- Model router, isolated Docker coding sandbox, and local vision analysis

LangGraph acts solely as the **orchestrator and state machine**, managing execution sequencing, state propagation across 14 typed channels, error boundaries, and lifecycle status.

---

## 2. Old vs. New Inspection Architecture

### Old Architecture (Legacy Imperative Chain)
```
HTTP POST /api/v1/inspection/workflow
              │
              ▼
inspection.controller.js (runWorkflow)
              │
              ▼
inspection.service.js (runCompleteWorkflow)
  ├── 1. Ingestion: ingestInspectionFile()
  ├── 2. Analysis: runInspectionAnalysis()
  ├── 3. Risk Loop: for (const finding of findings) { assessFindingRisk() }
  ├── 4. Citations: Deduplicate array in memory
  └── 5. Deliverable: runApprovalNoteGeneration() -> Approval_Note.docx
```
*Limitations:* Imperative coordination, lack of observable execution checkpoints, tight coupling between pipeline steps, unstandardized state propagation.

### New Target Architecture (LangGraph StateGraph)
```
                  HTTP POST /api/v1/inspection/workflow
                                    │
                                    ▼
                 inspection.controller.js (runWorkflow)
                                    │
                                    ▼
       inspection.service.js (runCompleteWorkflow wrapper / dispatcher)
                                    │
                                    ▼
        inspection-orchestrator.service.js (runInspectionWorkflow)
                                    │
                                    ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │                      LangGraph StateGraph Execution                  │
 │                                                                      │
 │    [ START ]                                                         │
 │        │                                                             │
 │        ▼                                                             │
 │      ingest                 (ingestInspectionFile)                   │
 │        │                                                             │
 │        ▼                                                             │
 │      retrieve               (multi-aspect Qdrant domain retrieval)   │
 │        │                                                             │
 │        ▼                                                             │
 │  extract_findings           (structured JSON schema extraction)      │
 │        │                                                             │
 │        ▼                                                             │
 │    retrieve_sop             (authoritative SOP query, docType='sop') │
 │        │                                                             │
 │        ▼                                                             │
 │    assess_risk              (risk rating: HIGH/MEDIUM/LOW/null)      │
 │        │                                                             │
 │        ▼                                                             │
 │  validate_citations         (filterValidCitations anti-hallucination)│
 │        │                                                             │
 │        ▼                                                             │
 │   generate_report           (Approval Note DOCX deliverable)         │
 │        │                                                             │
 │        ▼                                                             │
 │     [ END ]                                                          │
 └──────────────────────────────────┬───────────────────────────────────┘
                                    │
                                    ▼
                     Existing SovereignAI Core Services
        (Qdrant, Local Ollama, ONNX Embeddings, PostgreSQL, python-docx)
```

---

## 3. `runCompleteWorkflow()` Migration & Compatibility

The public export `runCompleteWorkflow(input, options)` in [`backend/src/services/inspection.service.js`](file:///Users/pushpentiwari/sovereign-ai-workbench/backend/src/services/inspection.service.js) has been refactored into a backward-compatible dispatcher:

```javascript
export async function runCompleteWorkflow(input, options = {}) {
    const orchestratorMode = (
        process.env.INSPECTION_ORCHESTRATOR || "langgraph"
    ).trim().toLowerCase();

    if (orchestratorMode === "legacy") {
        return runLegacyCompleteWorkflow(input, options);
    }

    return runInspectionWorkflow(input, options);
}
```

### Guarantees:
1. **Zero Caller Disruption:** Callers importing `runCompleteWorkflow` require zero modifications.
2. **Identical Response Shape:** Returns `{ documentId, filename, chunksStored, findings, riskAssessments, recommendations, citations, approvalNote: { filename, filePath } }` plus extended non-breaking telemetry `{ orchestration: { engine: "langgraph", runId, executionOrder, status } }`.
3. **Legacy Preservation:** The original imperative logic is preserved as `runLegacyCompleteWorkflow` for immediate rollback or comparative benchmarking.

---

## 4. Operation → Node Mapping

| Legacy Operation | LangGraph StateGraph Node | Adapter Function | Underlying Production Service |
| :--- | :--- | :--- | :--- |
| Ingestion & Chunking | `ingest` | `runIngestion` | `ingestInspectionFile` in `inspection.service.js` |
| Multi-aspect Candidate Retrieval | `retrieve` | `runRetrieval` | `resolveInspectionRetrievalQueries` + `searchSimilarChunks` in `inspection.service.js` |
| Structured Findings Extraction | `extract_findings` | `runFindingsExtraction` | `analyzeInspectionReport` in `inspection.service.js` |
| Authoritative SOP Retrieval | `retrieve_sop` | `runSopRetrieval` | `searchSop` (`documentType="sop"`) in `sop.service.js` |
| Finding Risk & Recommendation | `assess_risk` | `runRiskAssessment` | `assessFindingRisk` in `risk.service.js` |
| Anti-Hallucination Verification | `validate_citations` | `runCitationValidation` | `filterValidCitations` in `risk.schema.js` |
| Approval Note DOCX Generation | `generate_report` | `runReportGeneration` | `runApprovalNoteGeneration` in `inspection.service.js` |

---

## 5. State Mapping (`InspectionAgentState`)

The state schema maps directly to the inspection pipeline lifecycle:

```typescript
interface InspectionAgentState {
    runId: string;                     // Unique run UUID
    documentId: string;                 // Inspection document UUID
    task: string;                       // Prompt instruction / analysis task
    filePath: string | null;            // Local PDF file path
    organizationId: string | null;      // Multi-tenant organization UUID
    ingestionResult: object;            // { documentId, filename, chunksStored }
    retrievalResults: Array<Chunk>;     // Multi-aspect Qdrant chunks
    findings: Array<Finding>;           // PR #13 validated findings
    sopEvidence: Array<Chunk>;          // Authoritative SOP chunks (documentType='sop')
    riskAssessment: object;             // Primary risk rating & reason
    riskAssessments: Array<object>;     // Evaluation records for each finding
    recommendation: string;             // Primary actionable recommendation
    recommendations: Array<string>;     // List of all recommendations
    citations: Array<Citation>;         // Verified, grounded SOP citations
    report: object;                     // { filename, filePath, downloadUrl }
    currentNode: string;                // Current or most recent node
    executionOrder: Array<string>;      // Chronological execution list
    status: string;                     // "pending" | "in_progress" | "completed" | "failed"
    errors: Array<object>;              // Handled failure records [{ node, message, timestamp }]
    metadata: object;                   // Execution options and input parameters
}
```

---

## 6. Error Handling & Fail-Closed Safety

1. **Node-Level Error Boundaries:** Every node is wrapped in a try/catch boundary that records `{ node, message, timestamp }` into the `errors` channel and flags `status: "failed"`.
2. **Downstream Halting:** If any prior node fails, downstream nodes safely skip execution without invoking downstream services on invalid/empty data.
3. **Fail-Closed API Response:** `runInspectionWorkflow()` checks `finalState.status === "failed"` and throws the primary error. The HTTP controller catches this and forwards it to Express `next(error)`, returning HTTP 400 or 500 cleanly.
4. **Zero-Findings Safety:** If 0 findings are extracted from a clean inspection report, `assess_risk` provides safe defaults (`level: null`, scheduled maintenance recommendation) and empty citations without calling the LLM to hallucinate false risks.
5. **Authoritative SOP Isolation:** `retrieve_sop` strictly enforces `documentType="sop"`. Inspection documents are never retrieved as SOP standards.
6. **Citation Integrity:** `validate_citations` strips any citation returned by the LLM that does not match an actual retrieved chunk in `state.sopEvidence`.

---

## 7. Multi-Tenant Isolation

- `organizationId` is resolved by the controller from session headers (`x-organization-id`) and passed into `options.ingestOptions.organizationId` and `initialState.organizationId`.
- Ingestion, retrieval, document catalog records, and generated report records in PostgreSQL enforce `organizationId`.
- Verified in `reports.test.js`: requests with differing organization IDs yield 0 leaked reports.

---

## 8. Rollback Strategy

The cutover includes a feature flag switch requiring no code edits:

### To roll back to Legacy Orchestration:
Set the environment variable:
```bash
export INSPECTION_ORCHESTRATOR=legacy
```
Or in `backend/.env`:
```env
INSPECTION_ORCHESTRATOR=legacy
```
The application will immediately route all inspection workflow calls to `runLegacyCompleteWorkflow()` without restarting PostgreSQL or Qdrant.

### To return to LangGraph Orchestration:
```bash
export INSPECTION_ORCHESTRATOR=langgraph
```
(Or remove the variable, as `langgraph` is the built-in default).

---

## 9. Test Verification Results

All 10 test suites executed and passed with **0 regressions**:

| Test Suite | Command | Result | Coverage |
| :--- | :--- | :--- | :--- |
| **LangGraph Unit & Adapters** | `npm run test:graph` | **30/30 PASSED** | All 7 adapters, state channels, sequential order, failure handling |
| **Migration & Equivalence** | `node tests/inspection.migration.test.js` | **15/15 PASSED** | Feature flag switching, schema parity, tenant isolation, zero findings |
| **Structured Output Extraction** | `node tests/inspection.structured.test.js` | **6/6 PASSED** | JSON parsing, retry prompt, schema validation |
| **Model Router** | `node tests/router.test.js` | **14/14 PASSED** | Task classification, model routing, fallback behavior |
| **Coding Sandbox** | `node tests/sandbox.test.js` | **7/7 PASSED** | Docker container execution, timeout, network isolation |
| **Multimodal Vision** | `node tests/vision.test.js` | **14/14 PASSED** | Magic bytes, vision model routing, structured image findings |
| **Inspection Workflow & Reports** | `node tests/reports.test.js` | **PASSED** | Live HTTP POST `/api/v1/inspection/workflow`, PostgreSQL report persistence, organization scoping |
| **Chat Persistence & RAG** | `node tests/chat.test.js` | **PASSED** | Multi-turn chat persistence, Qdrant grounding |
| **Autonomous Tool Loop Agent** | `node tests/agent.test.js` | **25/25 PASSED** | Multi-step agent loop, tool whitelist, safe calculator, file bounds |
| **Backend Integration E2E** | `node tests/backend.e2e.test.js` | **PASSED** | Full end-to-end HTTP lifecycle from PDF upload to DOCX download |
