# SovereignAI Golden Path Verification

**Project:** SovereignAI — Sovereign On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 3 — Final Inspection Agent Golden Path  
**Date:** September 3, 2026  
**Status:** COMPLETE & VERIFIED  

---

## 1. Objective
Establish and verify the authoritative, end-to-end inspection pipeline from raw PDF ingestion to executive Approval Note DOCX delivery, ensuring strict multi-tenant authorization, evidence-grounded reasoning, and unbreachable human governance boundaries.

---

## 2. Demo Scenario
- **Industrial Asset:** `Pump-03` (Main Cooling Water Circulation Pump, CDU-II Section).
- **Observed Condition:** Bearing Temperature recorded at **92°C** with localized casing vibration.
- **Governing Standard:** `Demo_Maintenance_SOP.pdf` specifies continuous normal operating limit $\le$ **80°C**.
- **Expected Pipeline Output:**
  - Identifies a 12°C parameter exceedance.
  - Classifies operational risk as **HIGH** based on safety limits.
  - Formulates actionable corrective recommendations ("Immediate inspection and repair of bearing assembly; verify lubrication condition; do not return to service until inspection is complete").
  - Produces an audit-ready **Approval Note DOCX** deliverable with formal human review sign-off lines.

---

## 3. Documents Used
1. **Inspection Report:** `MRPL_CDU2_Pump03_Inspection.pdf` (Synthetic 2-page PDF with sensor readings and inspection notes).
2. **Maintenance SOP:** `Demo_Maintenance_SOP.pdf` (`documentType: "sop"`, Document ID: `SOP-MAINT-001`, Section 1: Bearing Temperature Monitoring, max continuous limit 80°C).
3. **Inspection Guidelines:** `Demo_Inspection_Guidelines.pdf` (`documentType: "sop"`, Document ID: `SOP-INSP-001`, Severity classification and reporting rules).

---

## 4. Authentication
- Authenticated via JWT bearer tokens signed using HMAC-SHA256 (`HS256`).
- Pre-seeded evaluation credentials (`engineer@example.com` / `DemoPassword123!`) resolve to `Demo Organization` (`0bd5dba2-05e1-4f5c-9047-25843d338622`).
- Identity context (`req.user.organizationId`, `req.user.id`) is injected into the initial LangGraph state and strictly checked on all document/report lookups.

---

## 5. Document Processing
- Text parsed using `pdfjs-dist` for vector-based documents with fallback to Tesseract OCR for scans.
- Documents are split into page-aware text chunks preserving `page`, `chunkIndex`, and start/end byte offsets.
- FastEmbed (`bge-small-en-v1.5`) embeds each chunk into a 384-dimensional dense vector.

---

## 6. Qdrant Retrieval
- Inspection chunks are queried using multi-aspect query resolution.
- SOP retrieval enforces strict metadata filtering directly in Qdrant:
  ```json
  {
    "filter": {
      "must": [
        { "key": "documentType", "match": { "value": "sop" } }
      ]
    }
  }
  ```
- Uncalibrated `0.50` threshold was calibrated to `0.35` (via `INSPECTION_SCORE_THRESHOLD` and `SOP_SCORE_THRESHOLD`), ensuring genuine SOP chunks scoring 0.40–0.64 are consistently matched.

---

## 7. LangGraph Workflow
- **Orchestrator:** `compiledInspectionGraph` with `InspectionAgentState`.
- **Authoritative Flow:**
  $$\text{START} \rightarrow \text{ingest} \rightarrow \text{retrieve} \rightarrow \text{extract\_findings} \rightarrow \text{validate\_findings} \rightarrow \text{retrieve\_sop} \rightarrow \text{check\_sop\_evidence} \rightarrow \text{assess\_risk} \rightarrow \text{validate\_risk} \rightarrow \text{validate\_citations} \rightarrow \text{generate\_report} \rightarrow \text{END}$$
- **State Channels:** `runId`, `documentId`, `organizationId`, `userId`, `findings`, `sopEvidence`, `riskAssessment`, `recommendation`, `citations`, `report`, `executionOrder`, `status`.

---

## 8. Findings
- Structured finding extracted:
  - **Equipment:** `Pump-03`
  - **Parameter:** `Bearing Temperature`
  - **Observed Value:** `92 degrees C`
  - **Limit:** `80 degrees C`
  - **Verbatim Evidence:** `"Temperature sensor PT-204 recorded 92 degrees C under normal load. Observation: Heavy casing vibration and localized overheating detected on bearing housing."`

---

## 9. SOP Evidence
- Retrieved chunks from `Demo_Maintenance_SOP.pdf`:
  - *Page 1:* `"Normal bearing operating temperature is up to 80 degrees C. If bearing temperature exceeds 80 degrees C: 1. Record the observed temperature. 2. Inspect the bearing assembly. 3. Check lubrication condition. 4. Check for abnormal vibration. 5. Do not return equipment to service until inspection is complete."*

---

## 10. Risk Assessment
- **Risk Level:** `HIGH`
- **Reasoning:** *"Observed temperature of 92 degrees C exceeds the maximum allowed limit of 80 degrees C continuous operating temperature, indicating active bearing distress and potential imminent failure."*

---

## 11. Recommendation
- **AI Corrective Action:** *"Immediate inspection and repair of the bearing assembly, lubrication condition check, and vibration analysis. Do not return equipment to service until inspection is complete."*
- Explicitly flagged in UI and DOCX as an **advisory AI recommendation requiring human review**.

---

## 12. Citation Validation
- Tested with mixed candidate citations containing authentic and fabricated sources:
  - Valid: `Demo_Maintenance_SOP.pdf (Page 1)` $\rightarrow$ **PRESERVED**
  - Fabricated: `Fabricated_Imaginary_SOP.pdf (Page 99)` $\rightarrow$ **DISCARDED**
- `filterValidCitations()` ensures zero hallucinated citations reach the final deliverable.

---

## 13. DOCX Generation
- Compiled via `python-docx` (`generate_docx.py`).
- **File size:** ~39,776 bytes.
- **Signature verification:** Valid OpenXML ZIP magic bytes (`50 4B 03 04`).
- **Sections generated:**
  1. Subject
  2. Background
  3. Inspection Findings (Structured table)
  4. Technical Analysis
  5. Risk Assessment (Color-coded callout table)
  6. Corrective Recommendation (Styled highlight block)
  7. References (Verified citation table)
  8. Approval (Sign-off signature table)

---

## 14. Human Review
- Boundary explicitly demarcated across backend and frontend:
  - Deliverable is labeled `PENDING HUMAN APPROVAL`.
  - Approval block includes blank signature lines:
    - *Prepared By:* SovereignAI Decision Support System
    - *Reviewed By:* [____________________] (Plant Maintenance Lead)
    - *Approved By:* [____________________] (Chief Operations Engineer)
    - *Date:* [____________________]
  - Prevents the AI system from asserting organizational authority.

---

## 15. SSE Activity
- Emits fine-grained, real-time Server-Sent Events to `/api/v1/inspection/runs/:runId/stream`:
  - `connected`
  - `run_started`
  - `node_started` / `node_completed` (per StateGraph node)
  - `validation` (findings & SOP status)
  - `run_completed`
- Frontend `useInspectionExecution` hook renders live progress badges without fake timers.

---

## 16. PostgreSQL Persistence
- Generated Approval Notes are automatically indexed in `reports` table:
  - `document_id`: Links to source inspection report
  - `organization_id`: Scoped to tenant
  - `risk_level`: Primary evaluated risk
  - `status`: `GENERATED`
- Download URL: `/api/v1/inspection/download/:filename`

---

## 17. Authorization
- Multi-tenant isolation verified:
  - User A (Org A) can inspect Document A and download Report A.
  - User B (Org B) cannot inspect Document A (`403 Forbidden`).
  - User B cannot download Report A (`403 Forbidden`).
  - User A sending `x-organization-id: Org B` header is strictly blocked (`403 Forbidden`).

---

## 18. Negative Tests
- Empty workflow request $\rightarrow$ `400 Bad Request`
- Non-existent document analysis $\rightarrow$ `404 Not Found`
- Non-existent report download $\rightarrow$ `404 Not Found`
- Fabricated citation injection $\rightarrow$ Discarded safely
- Zero-finding inspection reports $\rightarrow$ Handled gracefully without crash

---

## 19. Performance
- **Total Workflow Time:** ~26.5 seconds (end-to-end on local Ollama CPU/GPU).
- **LLM Reasoning:** ~24.2 seconds (Finding Extraction + Risk Reasoning).
- **DOCX Generation:** ~1.8 seconds.
- **Embeddings & Vector Search:** ~0.3 seconds.

---

## 20. Final Result
The SovereignAI Inspection Agent Golden Path is **100% verified, evidence-grounded, sovereign, and judge-ready**.
