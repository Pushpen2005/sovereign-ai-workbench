import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import app from "../src/app.js";
import { ingestInspectionFile } from "../src/services/inspection.service.js";
import { createDocument } from "../src/repositories/documents.repository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildMinimalPdf(pages) {
  const parts = [];
  const offsets = {};
  let pos = 0;

  function write(str) {
    const buf = Buffer.from(str, "latin1");
    parts.push(buf);
    pos += buf.length;
  }
  function writeObj(id, str) {
    offsets[id] = pos;
    write(`${id} 0 obj\n${str}\nendobj\n`);
  }

  write("%PDF-1.4\n");
  const pageObjectIds = [];
  const contentObjectIds = [];
  let nextId = 3;

  for (const lines of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageObjectIds.push(pageId);
    contentObjectIds.push(contentId);

    const content = lines
      .map((line, i) => `1 0 0 1 50 ${750 - i * 22} Tm (${line.replace(/[()\\]/g, "\\$&")}) Tj`)
      .join("\n");
    const stream = `BT\n/F1 10 Tf\n${content}\nET`;

    writeObj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`
    );
    writeObj(contentId, `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }

  writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObj(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  const xrefOffset = pos;
  const totalObjs = nextId;
  write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjs; id++) {
    const offsetStr = String(offsets[id]).padStart(10, "0");
    write(`${offsetStr} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}

async function runDemoE2E() {
  console.log("==================================================");
  console.log("PHASE 3 — LIVE END-TO-END DEMONSTRATION WORKFLOW");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // [1] Authentication Context & Demo Engineer Login
    console.log("\n[1] Authenticating Pre-Seeded MRPL Demo Engineer");
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "engineer@example.com",
        password: "DemoPassword123!",
      }),
    });
    assert.equal(loginRes.status, 200, "Demo login must return 200");
    const loginData = await loginRes.json();
    const token = loginData.data.token;
    const orgId = loginData.data.user.organizationId;
    const userId = loginData.data.user.id;

    console.log(`  Organization: MRPL Refinery Section (${orgId})`);
    console.log(`  User: MRPL Reliability Engineer (${userId})`);
    console.log("  JWT Token Generated & Active");

    // [2] Generate & Ingest Synthetic Inspection Report
    const docId = `mrpl_demo_${randomUUID().slice(0, 8)}`;
    const pdfFilename = `${docId}.pdf`;
    const pdfPath = path.resolve(__dirname, `../src/uploads/${pdfFilename}`);

    const pdfBuffer = buildMinimalPdf([
      [
        "MANGALORE REFINERY AND PETROCHEMICALS LIMITED (MRPL)",
        "EQUIPMENT INSPECTION REPORT",
        `Document ID: ${docId}`,
        "Unit: CDU-II Cracking & Pumping Section",
        "Date: 2026-09-05",
        "",
        "Equipment: Pump-03 Main Cooling Water Circulation Pump",
        "Parameter: Bearing Temperature",
        "Observed Value: 92 degrees C",
        "Operational Limit: 80 degrees C max continuous",
        "Condition: Abnormal heating observed during routine daily round.",
        "Evidence: Temperature sensor PT-204 recorded 92 degrees C under normal load.",
        "Observation: Heavy casing vibration and localized overheating detected on bearing housing.",
      ],
    ]);

    fs.writeFileSync(pdfPath, pdfBuffer);

    console.log("\n[2] Document Ingestion (Inspection Report PDF)");
    console.log(`  Target: Pump-03 Cooling Water Pump (92°C observed temperature)`);
    console.log(`  Document ID: ${docId}`);

    const ingestResult = await ingestInspectionFile(pdfPath, {
      documentId: docId,
      filename: pdfFilename,
      organizationId: orgId,
    });
    assert(ingestResult.chunksStored > 0, "Ingestion must store vector chunks");

    await createDocument({
      id: docId,
      organizationId: orgId,
      filename: pdfFilename,
      originalFilename: "MRPL_CDU2_Pump03_Inspection.pdf",
      status: "Indexed",
      chunksStored: ingestResult.chunksStored,
    });
    console.log(`  ✓ Report Ingested: ${ingestResult.chunksStored} chunk(s) stored in Qdrant with documentType='inspection'`);

    // [3] Start Inspection Agent Workflow with Live SSE Streaming
    const runId = `demo-run-${randomUUID()}`;
    console.log(`\n[3] Initiating Inspection Agent Workflow (Run ID: ${runId})`);

    // Connect to SSE stream in background before triggering workflow
    const sseReceivedEvents = [];
    const sseController = new AbortController();

    const ssePromise = (async () => {
      try {
        const sseRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${runId}/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: sseController.signal,
        });
        if (sseRes.status !== 200) return;

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n\n");
          buffer = lines.pop(); // retain incomplete block

          for (const block of lines) {
            if (!block.trim()) continue;
            let eventName = "message";
            let data = null;

            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                try {
                  data = JSON.parse(line.slice(6));
                } catch {
                  data = line.slice(6);
                }
              }
            }
            if (data) {
              const eventRecord = { event: eventName, data, receivedAt: new Date().toISOString() };
              sseReceivedEvents.push(eventRecord);
              console.log(`  ⚡ [LIVE SSE] Event: ${eventName.padEnd(20)} | Stage: ${(data.stage || data.node || "—").padEnd(24)} | Status: ${data.status || "—"}`);
              if (eventName === "findings_extracted") {
                console.log(`     -> Structured Findings: ${data.findingsCount} finding(s) extracted`);
              } else if (eventName === "sop_matched") {
                console.log(`     -> SOP Evidence Matched: ${data.chunksCount} chunk(s) found`);
              } else if (eventName === "risk_assessed") {
                console.log(`     -> Risk Level: ${data.riskAssessment?.level} (Score: ${data.riskAssessment?.riskScore || "N/A"})`);
                console.log(`     -> Recommendation: ${data.recommendation?.action || data.recommendation}`);
              } else if (eventName === "report_generated") {
                console.log(`     -> Deliverable Note: ${data.reportFilename}`);
              }
            }
          }
        }
      } catch (err) {
        // stream abort on complete is expected
      }
    })();

    // Give SSE listener 200ms head start
    await new Promise((r) => setTimeout(r, 200));

    // Execute full workflow
    const startTime = Date.now();
    const workflowRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentId: docId,
        runId,
        task: "Analyze this inspection report, extract all significant findings, evaluate against maintenance SOPs, and prepare approval note.",
      }),
    });

    const elapsedTotalMs = Date.now() - startTime;
    assert.equal(workflowRes.status, 200, "Workflow execution must return HTTP 200");
    const workflowData = await workflowRes.json();
    assert.equal(workflowData.success, true);

    // Stop SSE stream reader
    sseController.abort();
    await ssePromise.catch(() => {});

    console.log("\n[4] Workflow Execution Complete");
    console.log(`  Total End-to-End Elapsed Time: ${(elapsedTotalMs / 1000).toFixed(2)} seconds`);
    console.log(`  Workflow Status: ${workflowData.data.orchestration.status}`);
    console.log(`  Workflow Outcome: ${workflowData.data.orchestration.workflowOutcome}`);
    console.log(`  Nodes Executed: ${workflowData.data.orchestration.executionOrder.join(" -> ")}`);

    console.log("\n[5] Deliverables Extraction Validation");
    const findings = workflowData.data.findings || [];
    assert(findings.length > 0, "Workflow must extract at least 1 structured finding");
    console.log(`  ✓ Findings Extracted (${findings.length}):`);
    findings.forEach((f, i) => {
      console.log(`    #${i + 1}: ${f.finding || f.description || f.parameter}`);
      console.log(`       Evidence: ${f.evidence} (Page ${f.citation?.page || f.page || 1})`);
    });

    console.log("\n[6] Risk Assessment & Recommendation");
    const risk = workflowData.data.riskAssessment;
    const rec = workflowData.data.recommendation;
    assert(risk, "Risk assessment must be populated");
    console.log(`  ✓ Risk Level: ${risk.level}`);
    console.log(`  ✓ Risk Factors / Reason: ${risk.reason || JSON.stringify(risk.factors)}`);
    console.log(`  ✓ Recommendation: ${rec?.action || rec}`);

    console.log("\n[7] Approval Note DOCX Generation & Verification");
    const reportFilename = workflowData.data.approvalNote.filename;
    assert(reportFilename, "Generated Approval Note must have a valid filename");
    console.log(`  Generated File: ${reportFilename}`);

    // Download DOCX file via authenticated endpoint
    const downloadRes = await fetch(`${baseUrl}/api/v1/inspection/download/${encodeURIComponent(reportFilename)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(downloadRes.status, 200, "Download must succeed with HTTP 200");
    const docxArrayBuffer = await downloadRes.arrayBuffer();
    const docxBuffer = Buffer.from(docxArrayBuffer);

    // Verify DOCX ZIP magic bytes: PK\x03\x04
    assert(docxBuffer.length > 1000, "DOCX file must have substantial content (> 1KB)");
    assert.equal(docxBuffer[0], 0x50, "Byte 0 must be 'P'");
    assert.equal(docxBuffer[1], 0x4b, "Byte 1 must be 'K'");
    assert.equal(docxBuffer[2], 0x03, "Byte 2 must be 0x03");
    assert.equal(docxBuffer[3], 0x04, "Byte 3 must be 0x04");
    console.log(`  ✓ Valid DOCX Binary Downloaded (${docxBuffer.length} bytes, PK ZIP signature verified)`);

    console.log("\n[8] SSE Event Stream Audit Summary");
    console.log(`  Total Live Events Received: ${sseReceivedEvents.length}`);
    const eventTypesReceived = [...new Set(sseReceivedEvents.map((e) => e.event))];
    console.log(`  Unique Event Types: ${eventTypesReceived.join(", ")}`);

    // Clean up temporary file
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    console.log("\n==================================================");
    console.log("PHASE 3 END-TO-END DEMONSTRATION: PASS");
    console.log("==================================================");
    process.exit(0);
  } finally {
    server.close();
  }
}

runDemoE2E().catch((err) => {
  console.error("End-to-End Demo Failed:", err);
  process.exit(1);
});
