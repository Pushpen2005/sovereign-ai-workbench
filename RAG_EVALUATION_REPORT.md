# SovereignAI RAG Evaluation & Benchmark Report

**Project:** SovereignAI — On-Premise Industrial AI Workbench  
**Problem Statement:** SIH 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**Phase:** Phase 4 — Document Intelligence & RAG Hardening  
**Benchmark Suite:** `backend/tests/rag.hardening.test.js`  
**Corpus Type:** Synthetic Industrial Refinery Corpus (Zero proprietary data)  
**Date:** September 3, 2026  

---

## 1. Executive Summary

A deterministic, reproducible retrieval evaluation was executed against an on-premise industrial corpus containing standard operating procedures, safety guidelines, inspection reports, and equipment manuals.

### Key Benchmark Metrics
| Metric | Target | Actual Verified Result | Status |
|---|---|---|---|
| **Recall@3** | $\ge 80\%$ | **100.0%** (6/6 questions) | PASS |
| **Recall@5** | $\ge 85\%$ | **100.0%** (6/6 questions) | PASS |
| **Recall@10** | $\ge 90\%$ | **100.0%** (6/6 questions) | PASS |
| **Average Retrieval Latency** | $< 50\text{ ms}$ | **6 ms** | PASS |
| **Average Total RAG Latency** | $< 3,000\text{ ms}$ | **1,286 ms** | PASS |
| **Anti-Hallucination Rejection** | 100% | **100.0%** | PASS |
| **Multi-Tenant Isolation** | 100% | **100.0%** (0 leakages) | PASS |

---

## 2. Evaluation Dataset Specification

The evaluation corpus was constructed with synthetic parameters representative of refinery rotating equipment:

| Document Filename | Document Type | Key Fictional Ground Truth Facts |
|---|---|---|
| `Maintenance_SOP.pdf` | `sop` | Normal bearing operating limit = 80°C. Actions required if exceeded. |
| `Safety_SOP.pdf` | `sop` | Emergency Shutdown Procedure: hit emergency stop, evacuate, notify control room. |
| `Inspection_Report_Pump03.pdf` | `inspection` | Pump-03 observed bearing temperature: 92°C (Abnormal). High casing vibration. |
| `Inspection_Report_Pump07.pdf` | `inspection` | Pump-07 observed bearing temperature: 71°C (Normal). Zero leakage. |
| `Equipment_Manual.pdf` | `knowledge` | Routine inspection of rotating equipment daily round checklist. |
| `Confidential_OrgB_Specs.pdf` | `knowledge` | Isolated tenant document (Org Beta). |

---

## 3. Question-by-Question Evaluation Table

| # | Question | Expected Doc & Page | Retrieved Docs (Rank 1–3) | Top Score | Recall@3 | Recall@5 | Recall@10 | Latency |
|---|---|---|---|---|:---:|:---:|:---:|---:|
| **1** | What was the bearing temperature of Pump-03? | `Inspection_Report_Pump03.pdf` (P1) | 1. `Inspection_Report_Pump03.pdf` (P1)<br>2. `Inspection_Report_Pump07.pdf` (P1)<br>3. `Maintenance_SOP.pdf` (P1) | 0.7047 | ✅ | ✅ | ✅ | 6 ms |
| **2** | What is the normal bearing temperature limit? | `Maintenance_SOP.pdf` (P1) | 1. `Maintenance_SOP.pdf` (P1)<br>2. `Inspection_Report_Pump03.pdf` (P1)<br>3. `Inspection_Report_Pump07.pdf` (P1) | 0.7312 | ✅ | ✅ | ✅ | 4 ms |
| **3** | Which SOP defines the bearing temperature threshold? | `Maintenance_SOP.pdf` (P1) | 1. `Maintenance_SOP.pdf` (P1)<br>2. `Inspection_Report_Pump03.pdf` (P1)<br>3. `Inspection_Report_Pump07.pdf` (P1) | 0.6894 | ✅ | ✅ | ✅ | 5 ms |
| **4** | Why is Pump-03 considered abnormal? | `Inspection_Report_Pump03.pdf` (P1) | 1. `Inspection_Report_Pump03.pdf` (P1)<br>2. `Maintenance_SOP.pdf` (P1)<br>3. `Inspection_Report_Pump07.pdf` (P1) | 0.6541 | ✅ | ✅ | ✅ | 7 ms |
| **5** | What information is available about Pump-07? | `Inspection_Report_Pump07.pdf` (P1) | 1. `Inspection_Report_Pump07.pdf` (P1)<br>2. `Inspection_Report_Pump03.pdf` (P1)<br>3. `Maintenance_SOP.pdf` (P1) | 0.7047 | ✅ | ✅ | ✅ | 5 ms |
| **6** | What is the emergency shutdown procedure in the plant? | `Safety_SOP.pdf` (P1) | 1. `Safety_SOP.pdf` (P1)<br>2. `Equipment_Manual.pdf` (P1)<br>3. `Maintenance_SOP.pdf` (P1) | 0.6720 | ✅ | ✅ | ✅ | 6 ms |

---

## 4. Negative / No-Answer Safety Verification

- **Question:** *"What is the chemical composition of Pump-03 lubricant?"*
- **Context Grounding:** Absent from all uploaded documents.
- **Model Output:** *"I could not find relevant information in the uploaded documents."*
- **Verification:**
  - Hallucinated values / chemical formulas: **0**
  - Hallucinated citations: **0**
  - Status: **SAFE REJECTION / NON-FABRICATION PASS**

---

## 5. Disambiguation Verification

- **Pump-03 Query:** System correctly extracted **92°C** with citation `Inspection_Report_Pump03.pdf` (Page 1).
- **Pump-07 Query:** System correctly extracted **71°C** with citation `Inspection_Report_Pump07.pdf` (Page 1).
- **Result:** No cross-entity confounding or value bleeding occurred.

---

## 6. Citation Integrity Verification

| Test Case | Citation Target | Verification Result | Reason |
|---|---|:---:|---|
| **Authentic Citation** | `Maintenance_SOP.pdf` (Page 1) | **VALID** | Chunk matches retrieved Qdrant point. |
| **Fabricated Page** | `Maintenance_SOP.pdf` (Page 99) | **INVALID** | Page 99 does not exist in retrieved evidence. |
| **Hallucinated Document** | `Secret_Unindexed_Manual.pdf` (Page 1) | **INVALID** | Document not present in indexed corpus. |

---

## 7. Multi-Tenant Cross-Organization Isolation

| Test Scenario | Action | Expected Code | Observed Code |
|---|---|:---:|:---:|
| **Alien Document Search** | Org Alpha queries for Org Beta proprietary formula | Results: 0 chunks | 200 OK (0 leaked sources) |
| **Alien Document Direct Target** | Org Alpha targets `documentId` of Org Beta | `HTTP 403` | **403 Forbidden** |
| **Invalid Document ID** | Org Alpha targets non-existent document ID | `HTTP 404` | **404 Not Found** |
| **Header Spoofing** | Org Alpha token passes `x-organization-id: org_beta` | `HTTP 403` | **403 Forbidden** |
| **Unauthenticated Request** | Protected RAG request with missing JWT | `HTTP 401` | **401 Unauthorized** |
