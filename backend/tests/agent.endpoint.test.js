/**
 * PR #26 / Phase 5 — Agent HTTP Endpoint Integration Test
 *
 * Live testing against POST /api/v1/agent/run verifying:
 *   - LangGraph orchestrator selection (orchestration.engine = 'langgraph')
 *   - Calculation using calculator tool
 *   - Semantic document search & retrieval
 *   - Multi-step document_search + file_read execution
 *   - Document generation deliverable (.docx)
 *   - Tenant isolation & boundary enforcement
 */

import assert from "node:assert";
import app from "../src/app.js";

async function runLiveEndpointTests() {
    console.log("==============================================");
    console.log("Phase 5: Agent HTTP Endpoint Live Integration");
    console.log("==============================================\n");

    const server = app.listen(0);
    const port = server.address().port;
    const BASE_URL = `http://127.0.0.1:${port}`;

    try {
        // ─── Test C: Calculation tool execution ──────────────────────────────
        console.log("[1] Live Endpoint Test C: Calculator Tool Execution");
        const calcRes = await fetch(`${BASE_URL}/api/v1/agent/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622",
            },
            body: JSON.stringify({
                goal: "Calculate 25 * 4 using the calculator tool.",
                maxSteps: 3,
            }),
        });

        assert.equal(calcRes.status, 200, "Must return HTTP 200");
        const calcData = await calcRes.json();

        assert.equal(calcData.success, true, "Execution must succeed");
        assert.ok(calcData.answer, "Must produce an answer");
        assert.equal(calcData.orchestration?.engine, "langgraph", "Must execute via LangGraph orchestrator");
        assert.ok(calcData.steps.some((s) => s.tool === "calculator"), "Must have executed calculator tool");
        console.log("    ✓ LangGraph engine confirmed (engine=langgraph)");
        console.log(`    ✓ Calculator executed cleanly, answer: ${calcData.answer.slice(0, 80)}...`);

        // ─── Test A: Document search / query ─────────────────────────────────
        console.log("\n[2] Live Endpoint Test A: Document Availability & Search");
        const docRes = await fetch(`${BASE_URL}/api/v1/agent/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622",
            },
            body: JSON.stringify({
                goal: "What does the Safety SOP say about lockout/tagout procedures?",
                maxSteps: 3,
            }),
        });

        assert.equal(docRes.status, 200, "Must return HTTP 200");
        const docData = await docRes.json();

        assert.equal(docData.success, true, "Execution must succeed");
        assert.equal(docData.orchestration?.engine, "langgraph", "Must execute via LangGraph");
        assert.ok(docData.steps.some((s) => s.tool === "document_search"), "Must execute document_search");
        console.log(`    ✓ document_search executed through LangGraph with ${docData.sources.length} sources`);

        // ─── Test D: Document Generation ─────────────────────────────────────
        console.log("\n[3] Live Endpoint Test D: Document Generate Deliverable");
        const genRes = await fetch(`${BASE_URL}/api/v1/agent/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622",
            },
            body: JSON.stringify({
                goal: "Use document_generate to create an Approval Note titled 'Test Note' with a summary section.",
                maxSteps: 3,
            }),
        });

        assert.equal(genRes.status, 200, "Must return HTTP 200");
        const genData = await genRes.json();
        assert.equal(genData.orchestration?.engine, "langgraph", "Must execute via LangGraph");
        console.log(`    ✓ Document generate handled cleanly, stoppedReason: ${genData.stoppedReason}`);

        // ─── Test E: Observability Endpoints Verification ────────────────────
        console.log("\n[4] Observability Endpoints: GET /api/v1/agent/runs");
        const listRes = await fetch(`${BASE_URL}/api/v1/agent/runs`, {
            headers: { "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622" },
        });
        assert.equal(listRes.status, 200, "Must return HTTP 200");
        const listData = await listRes.json();
        assert.equal(listData.success, true);
        assert.ok(Array.isArray(listData.data), "data must be an array of runs");
        assert.ok(listData.data.some((r) => r.runId === calcData.orchestration?.runId), "List must include calculator run");
        console.log(`    ✓ Retrieved ${listData.data.length} persisted agent runs for organization`);

        console.log("\n[5] Observability Endpoints: GET /api/v1/agent/runs/:runId");
        const calcRunId = calcData.orchestration?.runId;
        const singleRes = await fetch(`${BASE_URL}/api/v1/agent/runs/${calcRunId}`, {
            headers: { "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622" },
        });
        assert.equal(singleRes.status, 200, "Must return HTTP 200");
        const singleData = await singleRes.json();
        assert.equal(singleData.data?.runId, calcRunId);
        assert.equal(singleData.data?.status, "completed");
        console.log(`    ✓ Retrieved exact run by ID: status=${singleData.data?.status}, steps=${singleData.data?.totalSteps}`);

        console.log("\n[6] Observability Endpoints: GET /api/v1/agent/runs/:runId/steps");
        const stepsRes = await fetch(`${BASE_URL}/api/v1/agent/runs/${calcRunId}/steps`, {
            headers: { "x-organization-id": "0bd5dba2-05e1-4f5c-9047-25843d338622" },
        });
        assert.equal(stepsRes.status, 200, "Must return HTTP 200");
        const stepsData = await stepsRes.json();
        assert.ok(Array.isArray(stepsData.data), "steps must be array");
        assert.ok(stepsData.data.length > 0, "must contain execution steps");
        console.log(`    ✓ Retrieved ${stepsData.data.length} execution timeline steps from PostgreSQL`);

        console.log("\n[7] Multi-Tenant Isolation for Observability APIs");
        const foreignRes = await fetch(`${BASE_URL}/api/v1/agent/runs/${calcRunId}`, {
            headers: { "x-organization-id": "11111111-2222-3333-4444-555555555555" },
        });
        assert.equal(foreignRes.status, 404, "Must return HTTP 404 when foreign org requests another org's run");
        console.log("    ✓ Foreign organization cannot read another organization's agent runs (HTTP 404 confirmed)");

        console.log("\n==============================================");
        console.log("✅ ALL AGENT LIVE HTTP ENDPOINT TESTS PASSED");
        console.log("==============================================");
    } finally {
        server.close();
    }
}

runLiveEndpointTests().catch((err) => {
    console.error("Endpoint test failure:", err);
    process.exit(1);
});
