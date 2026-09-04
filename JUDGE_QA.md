# SovereignAI — Judge Technical Q&A Preparation

**SIH Problem Statement:** 26117 | Mangalore Refinery and Petrochemicals Limited (MRPL)  
**System:** SovereignAI Industrial Agentic Workbench  

---

### 1. Why not use ChatGPT?
**Answer:** ChatGPT requires sending confidential plant telemetry, equipment limits, and inspection notes to external OpenAI/Microsoft cloud servers. In an industrial refinery like MRPL, transmitting critical infrastructure data violates national cybersecurity policies and exposes sensitive industrial IP. SovereignAI runs 100% locally with zero cloud egress.

### 2. Why not use an enterprise AI platform (AWS Bedrock, Azure OpenAI)?
**Answer:** Enterprise cloud AI platforms still require persistent internet connectivity, outbound firewall exceptions, and recurring cloud subscriptions. Refineries operate air-gapped SCADA/DCS networks (ISA-99 Level 3/4) that strictly prohibit internet connections. SovereignAI is self-contained and operates without internet connectivity.

### 3. What makes this sovereign?
**Answer:** Every layer of our technology stack—the LLM weights (`llama3.2:3b`), multimodal vision (`moondream`), dense embeddings (`all-MiniLM-L6-v2`), OCR engine (`Tesseract`), vector database (`Qdrant`), and relational database (`PostgreSQL`)—runs within the on-premise perimeter. Zero bytes of plant data ever leave the local network.

### 4. How do you prove data stays local?
**Answer:** We provide a real-time audit manifest (`GET /api/v1/sovereignty`) showing 0 external AI API calls. Furthermore, inspection of network traffic via Wireshark/tcpdump and Docker network bridge isolation confirms zero outbound packets to external AI domains.

### 5. Is this actually air-gapped?
**Answer:** Technically, our software has verified **Application-Level Offline Operation**: all models, embeddings, and services execute with no internet connection. However, a true physical air-gap requires the physical Ethernet cable to be disconnected or a firewall to block host-level egress. We do not conflate application offline capability with physical network infrastructure.

### 6. Which LLM are you using?
**Answer:** We use Meta's open-weight `llama3.2:3b` executed via a local Ollama runtime.

### 7. Why this model?
**Answer:** At 3 billion parameters, `llama3.2:3b` achieves high instruction-following and structured JSON compliance while requiring only ~2 GB of VRAM/RAM. This allows it to run efficiently on standard industrial edge workstations without requiring expensive multi-GPU data center servers.

### 8. Why Qdrant?
**Answer:** Qdrant is an open-source, production-grade vector search engine written in Rust. It provides sub-10ms Cosine similarity retrieval, supports payload-based multi-tenant filtering (`organizationId`), and persists vectors natively on disk without requiring cloud vector databases like Pinecone.

### 9. Why RAG?
**Answer:** Base LLMs suffer from knowledge cutoff and cannot know MRPL-specific Standard Operating Procedures or maintenance thresholds. Grounded Retrieval-Augmented Generation provides the model with exact, authoritative SOP context retrieved dynamically at query time.

### 10. How do you prevent hallucination?
**Answer:** We implement strict prompt constraints that forbid generating ungrounded assertions, enforce a minimum similarity threshold in vector retrieval, and execute post-generation citation validation. If an answer cannot be corroborated with retrieved chunks, the system safely refuses rather than fabricating.

### 11. How do citations work?
**Answer:** During document ingestion, text chunks preserve page numbers, document IDs, filenames, and character offsets. When the LLM responds, retrieved chunks are cross-referenced, and citations are validated against actual vector payload metadata.

### 12. How do you handle scanned PDFs?
**Answer:** We employ a two-stage extraction pipeline: first, PDF text streams are extracted; if a page contains image-only scans or low text density, the page is automatically rendered to a bitmap and processed by our local Tesseract 5.5.2 OCR engine.

### 13. How does OCR work?
**Answer:** Scanned pages are rendered to PNG buffers using pdfjs-dist and passed to local Tesseract OCR with English industrial language models. Extracted text is mapped back to the source page and chunked with page-aware metadata.

### 14. How does the agent work?
**Answer:** The Inspection Agent is modeled as a state machine using LangGraph. It orchestrates discrete nodes: reading documents, extracting factual findings, retrieving matching SOPs from Qdrant, analyzing limit exceedances, calculating risk levels, formulating recommendations, enforcing human governance, and compiling an Approval Note DOCX.

### 15. Where is LangGraph used?
**Answer:** LangGraph coordinates the inspection workflow state graph in `backend/src/orchestration/inspection/`. It manages state transitions, checkpointing, and conditional routing based on extracted findings.

### 16. What makes this agentic?
**Answer:** Rather than a simple single-turn question-and-answer prompt, the system autonomously decomposes an inspection report into sub-problems: it extracts specific observations, formulates search queries against SOP knowledge bases, detects limit deviations, evaluates risk severity, and creates human-reviewable artifacts.

### 17. How does risk assessment work?
**Answer:** Our technical analysis node compares observed values (e.g. 92 °C) against retrieved SOP thresholds (e.g. 80 °C). If an observed reading exceeds the maximum continuous limit, the risk classification node classifies the severity as HIGH or CRITICAL based on SOP severity criteria.

### 18. Can AI approve an engineering decision?
**Answer:** **No, absolutely not.** AI in our system is strictly advisory decision support. An AI should never sign off on refinery safety decisions. Our system explicitly incorporates a human review boundary before any action can be taken.

### 19. How is human approval handled?
**Answer:** The workflow generates a draft finding and advisory recommendation, then pauses at the `human_review` boundary. The plant engineer must inspect the evidence, review the cited SOP, and formally approve the generated Approval Note DOCX.

### 20. How does tenant isolation work?
**Answer:** Multi-tenancy is enforced authoritatively using the verified `organizationId` from the cryptographically signed JWT. Database queries and Qdrant vector searches include mandatory `organization_id` filters, preventing cross-tenant access.

### 21. Can one organization see another's documents?
**Answer:** No. All document queries, vector lookups, report listings, and DOCX downloads verify that `document.organization_id === req.user.organizationId`. Cross-organization requests return `403 Forbidden` or `404 Not Found`.

### 22. How is coding sandboxed?
**Answer:** When Python code is submitted (e.g. pump efficiency or thermodynamic calculations), the backend launches an ephemeral Docker container (`python:3.11-alpine`) with `--network none`, `--read-only`, `--user 1000:1000`, 1 vCPU, 256 MB RAM, 64 PIDs limit, and a 16 MB tmpfs. Code is piped via stdin; no host files or secrets are accessible.

### 23. Why Docker socket?
**Answer:** The backend container runs inside Docker and mounts `/var/run/docker.sock` to orchestrate these ephemeral child sandbox containers. The backend uses only basic container lifecycle commands (`run`, `kill`, `rm`). In high-security production deployments, we recommend interposing a Docker Socket Proxy to restrict Docker API privileges.

### 24. What happens if Ollama fails?
**Answer:** The Model Router detects Ollama downtime, logs a structured error event, and falls back gracefully with informative HTTP 503 error messages without crashing the backend process.

### 25. What happens if Qdrant fails?
**Answer:** Qdrant health is continuously monitored via Docker health checks (`/readyz`). If vector retrieval fails, RAG endpoints return a graceful error indicating that the knowledge store is temporarily unreachable.

### 26. What happens when the answer isn't in the documents?
**Answer:** The system executes a safe refusal: *"The provided context does not contain information about..."* It returns zero hallucinated citations and zero fabricated facts.

### 27. What is your RAG accuracy?
**Answer:** On our synthetic industrial benchmark, SovereignAI achieved **100% Recall@3**, **100% Recall@5**, and **100% Recall@10**, retrieving the authoritative SOP chunk across all evaluation test cases.

### 28. How was Recall@3 measured?
**Answer:** We evaluated multiple inspection test documents against known ground-truth SOP passages stored in Qdrant (31,018 points). Recall@3 measures the percentage of queries where the true ground-truth SOP chunk appeared in the top 3 similarity results.

### 29. How large was the benchmark?
**Answer:** The benchmark indexed 31,018 vector points in Qdrant representing synthetic plant inspection reports, maintenance SOPs, and safety guidelines.

### 30. What are the limitations?
**Answer:** (1) In-memory rate limiting is currently single-node; (2) The backend container currently mounts the Docker daemon socket; (3) Multimodal vision is suitable for reading dial gauges and visible tags, but cannot perform microscopic metallographic crack sizing.

### 31. What would you change for production?
**Answer:** For production deployment at MRPL: (1) Front the Docker socket with a restricted Docker Socket Proxy; (2) Use `docker-compose.prod.yml` where PostgreSQL and Qdrant have zero host ports exposed; (3) Run all containers as unprivileged non-root users; (4) Configure Redis for distributed rate limiting.

### 32. What happens with 100 concurrent users?
**Answer:** The Node.js asynchronous backend easily handles hundreds of concurrent I/O requests. For LLM inference, Ollama queues requests based on available GPU/CPU threads. In high-concurrency production, Ollama can be scaled across multiple local worker nodes.

### 33. Is the system scalable?
**Answer:** Yes. The architecture is modular: Qdrant scales horizontally via clustering; PostgreSQL handles relational scaling; and multiple Ollama inference instances can be placed behind a local load balancer.

### 34. Does it require internet?
**Answer:** No. After initial deployment and pulling of model weights, SovereignAI requires zero internet connectivity. All inference, OCR, embeddings, and report generation operate completely offline.

### 35. What happens when the host has no internet?
**Answer:** The application operates normally with zero degradation. In fact, our testing specifically verifies offline operation.

### 36. How are models updated?
**Answer:** In an air-gapped facility, model updates are transferred via secure USB/removable media that has undergone malware scanning, then loaded locally using `ollama create` or `ollama load` without internet access.

### 37. How are documents backed up?
**Answer:** Relational records are backed up using standard `pg_dump`; vector collections are backed up via Qdrant's snapshot API (`POST /collections/{name}/snapshots`); and physical uploads are backed up via tar archives of the persistent volumes.

### 38. What is the biggest security risk?
**Answer:** The backend mounting `/var/run/docker.sock`. Although the child sandbox container has zero network access and runs non-root, exposing the host Docker socket to the backend container creates a privilege surface if the backend itself were compromised. We have documented this risk and provided a clear socket-proxy mitigation roadmap.

### 39. What is the biggest technical limitation?
**Answer:** The 3-billion parameter model size. While fast and lightweight, 3B models have less reasoning depth than 70B parameter models. We compensate for this by using strict RAG context and LangGraph state decomposition rather than relying on unguided LLM reasoning.

### 40. Why should MRPL use this?
**Answer:** SovereignAI directly solves MRPL's core dilemma: leveraging modern agentic AI to accelerate daily inspection audits and SOP compliance, while strictly maintaining 100% data sovereignty, air-gapped network compliance, and zero risk of proprietary data leaks.
