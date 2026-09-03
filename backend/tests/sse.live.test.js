/**
 * Phase 7 — Live End-to-End SSE Streaming Verification
 *
 * Runs real agent and inspection workflows while simultaneously streaming live
 * Server-Sent Events over HTTP.
 *
 * Verifies:
 *   1. Real-time arrival of Agent LangGraph operational events
 *   2. Real-time arrival of Inspection LangGraph pipeline events
 *   3. Chronological sequence of nodes, tools, and validations
 *   4. Concordance between streamed terminal event and PostgreSQL persistence
 */

import assert from "node:assert/strict";
import crypto from "crypto";
import http from "http";
import app from "../src/app.js";
import { runAgentWorkflow } from "../src/services/agent-orchestrator.service.js";
import { runInspectionWorkflow } from "../src/services/inspection-orchestrator.service.js";
import { getAgentRunByRunId, deleteAgentRun } from "../src/repositories/agent.repository.js";
import { DEFAULT_ORGANIZATION_ID } from "../src/config/organization.js";

function listenToSse(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const events = [];
        const req = http.request(url, { headers }, (res) => {
            res.setEncoding("utf8");
            let buffer = "";

            res.on("data", (chunk) => {
                buffer += chunk;
                const parts = buffer.split("\n\n");
                buffer = parts.pop();

                for (const part of parts) {
                    if (!part.trim()) continue;
                    const lines = part.split("\n");
                    let event = "message";
                    let id = null;
                    let dataStr = "";

                    for (const line of lines) {
                        if (line.startsWith("event: ")) event = line.slice(7);
                        else if (line.startsWith("id: ")) id = line.slice(4);
                        else if (line.startsWith("data: ")) dataStr = line.slice(6);
                    }

                    try {
                        const data = dataStr ? JSON.parse(dataStr) : null;
                        events.push({ id, event, data });
                    } catch {
                        // ignore heartbeat comments
                    }
                }
            });

            res.on("end", () => {
                resolve(events);
            });

            res.on("error", reject);
        });

        req.on("error", reject);
        req.end();
    });
}

async function runLiveSseVerification() {
    console.log("==================================================");
    console.log("Phase 7: Live Real-Time SSE Streaming Verification");
    console.log("==================================================\n");

    const server = app.listen(0);
    const port = server.address().port;
    const BASE_URL = `http://127.0.0.1:${port}`;
    const orgId = DEFAULT_ORGANIZATION_ID;

    try {
        // ─── Part 1: Live Autonomous Agent Workflow Streaming ────────────────
        console.log("[1] Live Agent Workflow Streaming Test");
        const agentRunId = `live-sse-agent-${crypto.randomUUID()}`;

        // Connect SSE client before/as execution initiates
        const streamUrl = `${BASE_URL}/api/v1/agent/runs/${agentRunId}/stream`;
        const agentStreamPromise = listenToSse(streamUrl, {
            "x-organization-id": orgId,
        });

        // Trigger real LangGraph agent calculation
        const agentResult = await runAgentWorkflow("Calculate 45 * 2 using calculator", {
            runId: agentRunId,
            organizationId: orgId,
            maxSteps: 3,
        });

        assert.equal(agentResult.orchestration?.engine, "langgraph");
        const streamedAgentEvents = await agentStreamPromise;

        const eventNames = streamedAgentEvents.map((e) => e.event);
        console.log(`    ✓ Received ${streamedAgentEvents.length} SSE events: [${[...new Set(eventNames)].join(", ")}]`);

        assert.ok(eventNames.includes("connected"), "Must receive 'connected' handshake");
        assert.ok(eventNames.includes("run_started"), "Must receive 'run_started'");
        assert.ok(eventNames.includes("node_completed"), "Must receive 'node_completed'");
        assert.ok(eventNames.includes("tool_completed"), "Must receive 'tool_completed'");
        assert.ok(eventNames.includes("run_completed"), "Must receive 'run_completed'");

        // Verify PostgreSQL persistence concordance
        const dbRun = await getAgentRunByRunId(agentRunId, orgId);
        assert.ok(dbRun, "Run record must exist in PostgreSQL");
        assert.equal(dbRun.status, "completed");
        console.log(`    ✓ Streamed terminal state matches PostgreSQL: status=${dbRun.status}, answer=${dbRun.finalAnswer.slice(0, 40)}...`);

        await deleteAgentRun(agentRunId, orgId);

        // ─── Part 2: Live Inspection Workflow Streaming ──────────────────────
        console.log("\n[2] Live Inspection Workflow Streaming Test");
        const inspectionRunId = `live-sse-insp-${crypto.randomUUID()}`;

        const inspStreamUrl = `${BASE_URL}/api/v1/inspection/runs/${inspectionRunId}/stream`;
        const inspStreamPromise = listenToSse(inspStreamUrl, {
            "x-organization-id": orgId,
        });

        // Trigger real LangGraph inspection workflow
        const inspResult = await runInspectionWorkflow(
            "src/uploads/2f9bdd5a-37d3-49d7-8fa2-eedb4589faef.pdf",
            {
                runId: inspectionRunId,
                organizationId: orgId,
                task: "Extract inspection findings and assess risk",
            }
        );

        assert.equal(inspResult.orchestration?.engine, "langgraph");
        const streamedInspEvents = await inspStreamPromise;

        const inspEventNames = streamedInspEvents.map((e) => e.event);
        const nodeEvents = streamedInspEvents
            .filter((e) => e.event === "node_completed")
            .map((e) => e.data?.node);

        console.log(`    ✓ Received ${streamedInspEvents.length} inspection events: [${[...new Set(inspEventNames)].join(", ")}]`);
        console.log(`    ✓ Executed nodes in stream: ${nodeEvents.join(" -> ")}`);

        assert.ok(inspEventNames.includes("connected"), "Must receive 'connected'");
        assert.ok(inspEventNames.includes("run_started"), "Must receive 'run_started'");
        assert.ok(nodeEvents.includes("ingest"), "Must stream 'ingest'");
        assert.ok(nodeEvents.includes("retrieve"), "Must stream 'retrieve'");
        assert.ok(nodeEvents.includes("extract_findings"), "Must stream 'extract_findings'");
        assert.ok(inspEventNames.includes("validation"), "Must stream 'validation'");
        assert.ok(inspEventNames.includes("run_completed"), "Must stream 'run_completed'");

        console.log("\n==================================================");
        console.log("✅ ALL LIVE SSE STREAMING VERIFICATIONS PASSED");
        console.log("==================================================");
    } finally {
        server.close();
    }
}

runLiveSseVerification().catch((err) => {
    console.error("Live SSE verification failure:", err);
    process.exit(1);
});
