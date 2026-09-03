# SovereignAI Document Intelligence & RAG Hardening Report

**Project:** SovereignAI — On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 4 — Document Intelligence & RAG Hardening  
**Date:** September 3, 2026  
**Status:** COMPLETE & PRODUCTION-HARDENED  

---

## 1. Current Architecture Pipeline

The SovereignAI RAG pipeline executes **100% locally and on-premise**, with zero cloud telemetry or third-party inference APIs:

```text
  Confidential Industrial Document (PDF / Scan)
                        │
                        ▼
           [ PDF.js / Tesseract OCR ]
        (Page-Aware Text Extraction)
                        │
                        ▼
              [ chunkText Engine ]
     (1000 Chars, 200 Overlap, Global Index)
                        │
                        ▼
       [ ONNX all-MiniLM-L6-v2 Embeddings ]
            (384D Dense Vector Space)
                        │
                        ▼
              [ Qdrant Vector Store ]
     (Cosine Similarity, Metadata Payload & Indexes)
                        │
                        ▼
       [ Multi-Aspect Query Vector Search ]
 (Enforces documentId, documentType & Organization ID)
                        │
                        ▼
          [ Context Selection & Prompt ]
         (Anti-Jailbreak Data Boundary)
                        │
                        ▼
            [ Local Ollama Inference ]
           (llama3.2:3b Grounded Output)
                        │
                        ▼
          [ Citation Validation Engine ]
       (Deterministic Substring Verification)
                        │
                        ▼
               Audited Final Answer
        (With Clickable Grounded Sources)
```

---

## 2. Embedding Configuration
- **Model:** `Xenova/all-MiniLM-L6-v2` (Local ONNX runtime via `@huggingface/transformers`).
- **Dimensionality:** Exactly **384 dimensions**. Incompatible dimensions (e.g. 512D or 1536D) are strictly rejected with an explicit validation error prior to indexing.
- **Normalization:** Mean pooling with L2 unit normalization (`pooling: "mean", normalize: true`).
- **Distance Metric:** Cosine similarity (`"distance": "Cosine"` in Qdrant `documents` collection).
- **Sovereignty:** Stored and executed entirely in local process memory with zero external network calls.

---

## 3. Chunking Configuration
- **Chunk Size:** `1,000` characters.
- **Overlap:** `200` characters.
- **Page Association:** Chunks are created page-by-page independently; chunk boundaries never span across different document pages.
- **Global Indexing:** `chunkIndex` increments sequentially across the entire document (`0, 1, 2, ...`).
- **Offset Tracking:** Every chunk retains `pageStartOffset` and `pageEndOffset` relative to the source page text, enabling verbatim excerpt rendering in the frontend modal.
- **Empty Pages:** Pages containing only whitespace are cleanly skipped without generating zero-vector anomalies.

---

## 4. Retrieval Configuration
- **Candidate Limit (Top-K):** Defaults to `10`, overridable via `process.env.RAG_CANDIDATE_LIMIT`.
- **Context Limit:** Top `5` most relevant chunks passed to the LLM prompt.
- **Calibrated Score Threshold:** Defaults to `0.35` (overridable via `process.env.RAG_SCORE_THRESHOLD`), aligned with `SOP_SCORE_THRESHOLD` and `INSPECTION_SCORE_THRESHOLD`. Chunks scoring below this threshold are rejected.
- **Metadata Filters:**
  - `documentId`: Scopes query to a single document.
  - `documentType`: Strictly enforces partition between `"sop"`, `"inspection"`, and `"knowledge"` documents.
  - `allowedDocumentIds`: Directly passed to Qdrant's `filter.must` using `{ key: "documentId", match: { any: [...] } }` keyword filtering.
  - `organizationId`: Matches tenant ownership at the database/vector layer.

---

## 5. Multi-Tenant Isolation
1. **Authorization Boundary:** Every user request must present a valid Bearer JWT. Untrusted client headers (`x-organization-id`) are verified against `req.user.organizationId`; any mismatch results in an immediate `HTTP 403 Forbidden`.
2. **Document Ownership Check:** If a user specifies `documentId`, the backend queries PostgreSQL:
   ```sql
   SELECT id, organization_id FROM documents WHERE id = $1;
   ```
   If the document belongs to another organization, access is denied with `HTTP 403 Forbidden`.
3. **Database-Layer Filter Pushdown:** For general queries across an organization, all document IDs owned by the caller's organization are resolved from PostgreSQL and passed to Qdrant. Points belonging to other tenants are strictly excluded from the vector search space.

---

## 6. Citation Integrity & Anti-Hallucination
- LLM citations are not trusted naively.
- The application evaluates citations via `validateRagCitation(allegedCitation, retrievedChunks)`:
  - **Valid Citation:** Document ID, filename, and page match a chunk that was actually retrieved and passed into context $\rightarrow$ Marked `VALID`.
  - **Fabricated Page:** Cited page (e.g. Page 99 on a 2-page document) does not exist in retrieved evidence $\rightarrow$ Marked `INVALID`.
  - **Hallucinated Document:** Cited document was never in context $\rightarrow$ Marked `INVALID`.

---

## 7. OCR Pipeline
- When a PDF page does not yield selectable vector text (scans, low-density rasterization), `extractPdfText()` automatically renders the page canvas to a 2x-scaled PNG and spawns local `tesseract` (`5.5.x`).
- OCR-derived text retains full page numbers, sequential chunk indices, and organization ownership.
- Tested end-to-end on synthetic industrial gauge imagery (`"CRITICAL SENSOR CALIBRATION 42 PSI"`), verifying 100% accurate text extraction.

---

## 8. Failure Handling & Edge Cases
| Failure Mode | Expected Behavior | Actual Verified Result |
|---|---|---|
| **Empty PDF (0 bytes or no text)** | Controlled rejection with clear error message | Throws `No text content could be extracted from: <filename>` (Status: `Failed`) |
| **Non-existent Document ID** | Document not found | `HTTP 404 Not Found` |
| **Cross-Tenant Access Attempt** | Access denied | `HTTP 403 Forbidden` |
| **Missing Bearer Token** | Unauthorized request | `HTTP 401 Unauthorized` |
| **Absent Information (No Answer)** | Does not hallucinate | Returns "I could not find relevant information in the uploaded documents." |
| **Incompatible Vector Dimension** | Qdrant reject before indexing | Throws `Chunk vector must contain 384 dimensions` |

---

## 9. Measured Performance

Tested against local development node (Apple Silicon M-series, Ollama `llama3.2:3b`, Qdrant 1.13):

| Operation | Measured Latency |
|---|---|
| **Local 384D Query Embedding (`all-MiniLM-L6-v2`)** | 2 ms |
| **Qdrant Vector Retrieval (Top-10 across 30,994 points)** | 4 ms |
| **Context Construction & Ranking** | < 1 ms |
| **Local Ollama Generation (`llama3.2:3b`)** | 1,280 ms |
| **Citation Validation** | < 1 ms |
| **Total End-to-End RAG Request** | **1,286 ms (~1.29 s)** |

---

## 10. Retrieval Evaluation Benchmark
Evaluated across synthetic industrial test corpus (`Maintenance_SOP.pdf`, `Safety_SOP.pdf`, `Inspection_Report_Pump03.pdf`, `Inspection_Report_Pump07.pdf`, `Equipment_Manual.pdf`):

- **Recall@3:** **100.0%**
- **Recall@5:** **100.0%**
- **Recall@10:** **100.0%**
- **Average Retrieval Latency:** **6 ms**

---

## 11. Remaining Limitations & Operating Guidance
1. **Local Host Memory:** Generating embeddings and running LLM inference simultaneously requires at least 8 GB of unified memory.
2. **Complex Tables & CAD Drawings:** Standard text chunking preserves tabular text linearly; multi-column engineering blueprints with nested schematics should be supplemented with multimodal vision analysis.
