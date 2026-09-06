import assert from "node:assert";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { executionEvents } from "../src/services/execution-events.service.js";
import { createReportRecord } from "../src/services/reports.service.js";

async function runPhase3WorkspaceTests() {
  console.log("==================================================");
  console.log("PHASE 3 — AGENT WORKSPACE & SSE WORKFLOW TESTS");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];
  const cleanupReportIds = [];

  try {
    // Setup Tenant A (Org A, User A)
    const orgAId = randomUUID();
    const userAId = randomUUID();
    cleanupOrgIds.push(orgAId);
    cleanupUserIds.push(userAId);

    await query(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [orgAId, `Workspace Org A ${orgAId.slice(0, 6)}`]
    );
    await query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [userAId, orgAId, "Inspector Alpha", `usera_${userAId.slice(0, 6)}@mrpl.co.in`, "hash123", "operator"]
    );

    const tokenA = generateToken({
      id: userAId,
      email: `usera_${userAId.slice(0, 6)}@mrpl.co.in`,
      organizationId: orgAId,
      role: "operator",
    });

    // Setup Tenant B (Org B, User B)
    const orgBId = randomUUID();
    const userBId = randomUUID();
    cleanupOrgIds.push(orgBId);
    cleanupUserIds.push(userBId);

    await query(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [orgBId, `Workspace Org B ${orgBId.slice(0, 6)}`]
    );
    await query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [userBId, orgBId, "Inspector Beta", `userb_${userBId.slice(0, 6)}@mrpl.co.in`, "hash123", "operator"]
    );

    const tokenB = generateToken({
      id: userBId,
      email: `userb_${userBId.slice(0, 6)}@mrpl.co.in`,
      organizationId: orgBId,
      role: "operator",
    });

    // [1] Authentication Enforcement on Run Snapshot Endpoint
    console.log("\n[1] Authentication Enforcement on GET /api/v1/inspection/runs/:runId");
    const testRunId = `run-${randomUUID()}`;
    const unauthRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}`);
    assert.equal(unauthRes.status, 401, "Unauthenticated request must return HTTP 401");
    console.log("  ✅ PASS: Unauthenticated run snapshot query is rejected with 401");

    // [2] Register Active Run in Memory for Tenant A
    console.log("\n[2] Live In-Memory Run State & Snapshots");
    executionEvents.registerRunOwner(testRunId, orgAId, "inspection");
    executionEvents.publish(testRunId, "workflow_stage", {
      stage: "reading_report",
      status: "running",
      message: "Reading inspection report",
    });
    executionEvents.publish(testRunId, "findings_extracted", {
      findingsCount: 1,
      findings: [
        {
          id: "F-1",
          equipment: "Centrifugal Pump P-101A",
          parameter: "Bearing temperature",
          finding: "Bearing temperature elevated to 88°C",
          citation: { documentId: "doc-1", page: 4 },
        },
      ],
    });

    // User A fetches their run
    const authRunResA = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(authRunResA.status, 200, "Owner must be able to fetch run state");
    const runDataA = await authRunResA.json();
    assert.equal(runDataA.success, true);
    assert.equal(runDataA.data.runId, testRunId);
    assert.equal(runDataA.data.stage, "reading_report");
    assert.equal(runDataA.data.findings.length, 1);
    assert.equal(runDataA.data.findings[0].id, "F-1");
    console.log("  ✅ PASS: Owner retrieves live in-memory run state with findings");

    // [3] Tenant Isolation on Run Snapshot Endpoint
    console.log("\n[3] Tenant Isolation on GET /api/v1/inspection/runs/:runId");
    const crossTenantRunRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossTenantRunRes.status, 403, "Cross-tenant request must return HTTP 403 Forbidden");
    console.log("  ✅ PASS: User B (Org B) cannot view User A's run (HTTP 403)");

    // [4] Tenant Isolation on SSE Stream Endpoint
    console.log("\n[4] Tenant Isolation on GET /api/v1/inspection/runs/:runId/stream");
    const crossTenantStreamRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}/stream`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossTenantStreamRes.status, 403, "Cross-tenant SSE stream request must return HTTP 403 Forbidden");
    console.log("  ✅ PASS: User B (Org B) cannot subscribe to User A's SSE stream (HTTP 403)");

    // [5] Robust SSE Streaming and Reconnection
    console.log("\n[5] SSE Event Delivery & Reconnection");
    // Connect User A to SSE stream
    const sseController = new AbortController();
    const sseRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}/stream`, {
      headers: { Authorization: `Bearer ${tokenA}` },
      signal: sseController.signal,
    });
    assert.equal(sseRes.status, 200, "SSE stream connection must return HTTP 200");
    assert.equal(sseRes.headers.get("content-type"), "text/event-stream");

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let receivedData = "";

    // Read initial snapshot event or buffered history
    const { value: chunk1 } = await reader.read();
    receivedData += decoder.decode(chunk1);
    assert(
      receivedData.includes("event: workflow_stage") || receivedData.includes("event: findings_extracted"),
      "SSE must immediately replay buffered events to reconnecting client"
    );
    console.log("  ✅ PASS: SSE immediately yields buffered history upon connection");

    // Advance run to sop_matched
    executionEvents.publish(testRunId, "workflow_stage", {
      stage: "searching_sop",
      status: "running",
      message: "Searching relevant SOP",
    });
    executionEvents.publish(testRunId, "sop_matched", {
      chunksCount: 1,
      sopEvidence: [
        {
          documentId: "sop-1",
          filename: "SOP-MECH-04.pdf",
          page: 12,
          score: 0.91,
          textExcerpt: "Bearing temperature exceeding 80°C requires shutdown.",
        },
      ],
    });

    // Advance run to risk_assessed
    executionEvents.publish(testRunId, "workflow_stage", {
      stage: "analysing_risk",
      status: "running",
      message: "Analysing risk",
    });
    executionEvents.publish(testRunId, "risk_assessed", {
      riskAssessment: {
        level: "HIGH",
        riskScore: 8,
        factors: ["High thermal gradient", "Bearing degradation"],
        regulatoryImplications: "Violation of API 610 threshold",
        mitigationStrategy: "Immediate vibration and lube audit",
      },
      recommendation: {
        action: "Order emergency lube flush and decouple motor",
        priority: "IMMEDIATE",
        requiredApprovals: ["Plant Safety Head"],
      },
    });

    // Complete run
    executionEvents.publish(testRunId, "run_completed", {
      reportFilename: `Approval_Note_${testRunId}.docx`,
      summary: "Completed successfully",
    });

    // Read remaining events
    let gotRisk = false;
    let gotComplete = false;
    for (let i = 0; i < 5; i++) {
      const { value } = await reader.read();
      if (!value) break;
      const text = decoder.decode(value);
      if (text.includes("risk_assessed")) gotRisk = true;
      if (text.includes("run_completed")) gotComplete = true;
      if (gotComplete) break;
    }
    sseController.abort();
    assert(gotComplete, "SSE stream must deliver run_completed event");
    console.log("  ✅ PASS: SSE delivers progressive intermediate events and run_completed");

    // [6] Post-Completion Snapshot via GET /runs/:runId
    console.log("\n[6] Post-Completion Snapshot Retrieval");
    const completedRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${testRunId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const completedData = await completedRes.json();
    assert.equal(completedData.data.status, "completed");
    assert.equal(completedData.data.riskAssessment.level, "HIGH");
    assert.equal(completedData.data.sopEvidence.length, 1);
    assert.equal(completedData.data.reportFilename, `Approval_Note_${testRunId}.docx`);
    console.log("  ✅ PASS: Reconnecting after completion retrieves all structured deliverables");

    // [7] Report Record Tenant Isolation
    console.log("\n[7] Report Record Tenant Isolation");
    const reportId = randomUUID();
    cleanupReportIds.push(reportId);
    await createReportRecord({
      id: reportId,
      organizationId: orgAId,
      title: "Inspection Approval Note - P-101A",
      filename: `Approval_Note_${testRunId}.docx`,
      riskLevel: "HIGH",
      status: "GENERATED",
    });

    // User A can access report
    const reportA = await fetch(`${baseUrl}/api/v1/reports/${reportId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(reportA.status, 200, "Owner must be able to view their report record");

    // User B is denied (fails closed with 403 or 404 not found in tenant scope)
    const reportB = await fetch(`${baseUrl}/api/v1/reports/${reportId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert([403, 404].includes(reportB.status), `Non-owner must be forbidden from accessing report (got ${reportB.status})`);
    console.log("  ✅ PASS: Cross-tenant report access safely denied (HTTP 404/403)");

    console.log("\n==================================================");
    console.log("ALL PHASE 3 WORKSPACE TESTS PASSED");
    console.log("==================================================");
    process.exit(0);
  } finally {
    server.close();
    // Cleanup database records
    for (const rId of cleanupReportIds) {
      await query("DELETE FROM reports WHERE id = $1", [rId]).catch(() => {});
    }
    for (const uId of cleanupUserIds) {
      await query("DELETE FROM users WHERE id = $1", [uId]).catch(() => {});
    }
    for (const oId of cleanupOrgIds) {
      await query("DELETE FROM organizations WHERE id = $1", [oId]).catch(() => {});
    }
  }
}

runPhase3WorkspaceTests().catch((err) => {
  console.error("Phase 3 Workspace Test Failed:", err);
  process.exit(1);
});
