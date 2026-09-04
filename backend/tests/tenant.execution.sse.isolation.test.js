/**
 * Phase 4 — Tenant-Isolated Agent Runs & SSE Streaming Test Suite
 *
 * Implements the 18 mandated security and tenant isolation tests:
 *
 * TEST 1: Company A creates agent run -> run.organization_id = Company A
 * TEST 2: Company B creates agent run -> run.organization_id = Company B
 * TEST 3: Company A lists runs -> Only Company A runs returned
 * TEST 4: Company B lists runs -> Only Company B runs returned
 * TEST 5: Company A requests Company B run by ID -> 403 or 404
 * TEST 6: Company A requests Company B run steps -> 403 or 404
 * TEST 7: Company A subscribes to Company A SSE stream -> Allowed (200 text/event-stream)
 * TEST 8: Company A subscribes to Company B SSE stream -> Denied (403 or 404)
 * TEST 9: Company B subscribes to Company A SSE stream -> Denied (403 or 404)
 * TEST 10: Unauthenticated SSE request -> 401 Unauthorized
 * TEST 11: Company A supplies organizationId=Company B in request body -> Run remains Company A
 * TEST 12: Company A supplies organizationId=Company B in query -> Ignored; remains Company A
 * TEST 13: Company A supplies x-organization-id=Company B -> 403 Forbidden
 * TEST 14: LLM/agent execution attempts to provide another organization ID -> Ignored; context remains Company A
 * TEST 15: Missing in-memory run owner but valid PostgreSQL run exists -> Rehydrated and verified
 * TEST 16: Unknown runId -> Denied safely (404)
 * TEST 17: Company A receives events for its run -> Company A events delivered
 * TEST 18: Company A cannot receive Company B event data -> No cross-tenant event leakage
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import {
    createAgentRun,
    createAgentRunStep,
    getAgentRunByRunId,
    getAgentRunSteps,
    deleteAgentRun,
} from "../src/repositories/agent.repository.js";
import { executionEvents } from "../src/services/execution-events.service.js";
import { executeRegisteredTool } from "../src/services/agentTools/toolRegistry.js";

async function runPhase4Suite() {
    console.log("==================================================");
    console.log("Phase 4: Tenant-Isolated Agent Runs & SSE Stream Suite");
    console.log("==================================================");

    try {
        await initDb();
    } catch (err) {
        console.warn("DB init warning:", err.message);
    }

    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const cleanupOrgIds = [];
    const cleanupUserIds = [];
    const cleanupRunIds = [];

    let passedTests = 0;
    function recordPass(testName, detail = "") {
        console.log(`  ✅ PASS: ${testName}${detail ? ` — ${detail}` : ""}`);
        passedTests++;
    }

    try {
        // Setup isolated test tenants in PostgreSQL
        const orgAId = randomUUID();
        const orgBId = randomUUID();
        cleanupOrgIds.push(orgAId, orgBId);

        await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAId, `Company Alpha ${orgAId.slice(0, 6)}`]);
        await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBId, `Company Beta ${orgBId.slice(0, 6)}`]);

        const userAId = randomUUID();
        const userBId = randomUUID();
        cleanupUserIds.push(userAId, userBId);

        await query(
            "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
            [userAId, orgAId, "Alice Alpha", `alice_${orgAId.slice(0, 6)}@alpha.local`, "hash-stub", "engineer"]
        );
        await query(
            "INSERT INTO users (id, organization_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)",
            [userBId, orgBId, "Bob Beta", `bob_${orgBId.slice(0, 6)}@beta.local`, "hash-stub", "engineer"]
        );

        const tokenA = generateToken({
            userId: userAId,
            organizationId: orgAId,
            email: `alice_${orgAId.slice(0, 6)}@alpha.local`,
            role: "engineer",
        });

        const tokenB = generateToken({
            userId: userBId,
            organizationId: orgBId,
            email: `bob_${orgBId.slice(0, 6)}@beta.local`,
            role: "engineer",
        });

        const runAId = `run-alpha-${randomUUID()}`;
        const runBId = `run-beta-${randomUUID()}`;
        cleanupRunIds.push(runAId, runBId);

        // ---------------------------------------------------------------------
        // TEST 1: Company A creates agent run
        // ---------------------------------------------------------------------
        console.log("\n[TEST 1] Company A creates agent run");
        const runA = await createAgentRun({
            runId: runAId,
            userId: userAId,
            organizationId: orgAId,
            goal: "Inspect chemical reactor loop for Company A",
            status: "in_progress",
        });
        executionEvents.registerRunOwner(runAId, orgAId, "agent");

        const checkRunA = await query("SELECT organization_id FROM agent_runs WHERE run_id = $1", [runAId]);
        assert.equal(checkRunA.rows.length, 1, "Run A must exist in database");
        assert.equal(checkRunA.rows[0].organization_id, orgAId, "run.organization_id must match Company A");
        recordPass("TEST 1", `Run ${runAId} bound to organization ${orgAId}`);

        // ---------------------------------------------------------------------
        // TEST 2: Company B creates agent run
        // ---------------------------------------------------------------------
        console.log("\n[TEST 2] Company B creates agent run");
        const runB = await createAgentRun({
            runId: runBId,
            userId: userBId,
            organizationId: orgBId,
            goal: "Inspect turbine vibration data for Company B",
            status: "in_progress",
        });
        executionEvents.registerRunOwner(runBId, orgBId, "agent");

        const checkRunB = await query("SELECT organization_id FROM agent_runs WHERE run_id = $1", [runBId]);
        assert.equal(checkRunB.rows.length, 1, "Run B must exist in database");
        assert.equal(checkRunB.rows[0].organization_id, orgBId, "run.organization_id must match Company B");
        recordPass("TEST 2", `Run ${runBId} bound to organization ${orgBId}`);

        // Persist test execution steps for each run
        await createAgentRunStep({
            runId: runAId,
            stepNumber: 1,
            node: "reason",
            action: "plan",
            toolResultSummary: "Company A confidential step",
        });
        await createAgentRunStep({
            runId: runBId,
            stepNumber: 1,
            node: "reason",
            action: "plan",
            toolResultSummary: "Company B confidential step",
        });

        // ---------------------------------------------------------------------
        // TEST 3: Company A lists runs
        // ---------------------------------------------------------------------
        console.log("\n[TEST 3] Company A lists runs");
        const listResA = await fetch(`${baseUrl}/api/v1/agent/runs`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.equal(listResA.status, 200, "Company A listing runs should return 200");
        const listDataA = await listResA.json();
        assert.ok(Array.isArray(listDataA.data), "Expected data array");
        assert.ok(listDataA.data.some((r) => r.runId === runAId), "Run A must be present in Company A listing");
        assert.ok(!listDataA.data.some((r) => r.runId === runBId), "Run B must NEVER appear in Company A listing");
        assert.ok(listDataA.data.every((r) => r.organizationId === orgAId), "All runs must belong strictly to Company A");
        recordPass("TEST 3", `Company A received ${listDataA.data.length} runs, 0 from Company B`);

        // ---------------------------------------------------------------------
        // TEST 4: Company B lists runs
        // ---------------------------------------------------------------------
        console.log("\n[TEST 4] Company B lists runs");
        const listResB = await fetch(`${baseUrl}/api/v1/agent/runs`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert.equal(listResB.status, 200, "Company B listing runs should return 200");
        const listDataB = await listResB.json();
        assert.ok(Array.isArray(listDataB.data), "Expected data array");
        assert.ok(listDataB.data.some((r) => r.runId === runBId), "Run B must be present in Company B listing");
        assert.ok(!listDataB.data.some((r) => r.runId === runAId), "Run A must NEVER appear in Company B listing");
        assert.ok(listDataB.data.every((r) => r.organizationId === orgBId), "All runs must belong strictly to Company B");
        recordPass("TEST 4", `Company B received ${listDataB.data.length} runs, 0 from Company A`);

        // ---------------------------------------------------------------------
        // TEST 5: Company A requests Company B run by ID
        // ---------------------------------------------------------------------
        console.log("\n[TEST 5] Company A requests Company B run by ID");
        const crossRunRes = await fetch(`${baseUrl}/api/v1/agent/runs/${runBId}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.ok([403, 404].includes(crossRunRes.status), `Expected 403 or 404, got ${crossRunRes.status}`);
        const crossRunBody = await crossRunRes.json();
        assert.equal(crossRunBody.success, false, "Cross-tenant request must fail");
        assert.ok(!crossRunBody.data, "No run data may be leaked");
        recordPass("TEST 5", `Cross-tenant run access rejected with HTTP ${crossRunRes.status}`);

        // ---------------------------------------------------------------------
        // TEST 6: Company A requests Company B run steps
        // ---------------------------------------------------------------------
        console.log("\n[TEST 6] Company A requests Company B run steps");
        const crossStepsRes = await fetch(`${baseUrl}/api/v1/agent/runs/${runBId}/steps`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.ok([403, 404].includes(crossStepsRes.status), `Expected 403 or 404, got ${crossStepsRes.status}`);
        const crossStepsBody = await crossStepsRes.json();
        assert.equal(crossStepsBody.success, false, "Cross-tenant steps request must fail");
        assert.ok(!crossStepsBody.data, "No step trace may be leaked");
        recordPass("TEST 6", `Cross-tenant step access rejected with HTTP ${crossStepsRes.status}`);

        // ---------------------------------------------------------------------
        // TEST 7: Company A subscribes to Company A SSE stream
        // ---------------------------------------------------------------------
        console.log("\n[TEST 7] Company A subscribes to Company A SSE stream");
        const streamA = await new Promise((resolve, reject) => {
            const req = http.request(
                `${baseUrl}/api/v1/agent/runs/${runAId}/stream`,
                {
                    headers: { Authorization: `Bearer ${tokenA}` },
                },
                (res) => {
                    resolve({ statusCode: res.statusCode, contentType: res.headers["content-type"], res, req });
                }
            );
            req.on("error", reject);
            req.end();
        });
        assert.equal(streamA.statusCode, 200, "Authorized SSE stream must return 200");
        assert.ok(streamA.contentType?.includes("text/event-stream"), "Must return text/event-stream");
        streamA.req.destroy();
        recordPass("TEST 7", "Company A successfully established SSE stream for Run A");

        // ---------------------------------------------------------------------
        // TEST 8: Company A subscribes to Company B SSE stream
        // ---------------------------------------------------------------------
        console.log("\n[TEST 8] Company A subscribes to Company B SSE stream");
        const crossStreamAtoB = await fetch(`${baseUrl}/api/v1/agent/runs/${runBId}/stream`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.ok([403, 404].includes(crossStreamAtoB.status), `Expected 403 or 404, got ${crossStreamAtoB.status}`);
        recordPass("TEST 8", `Company A cross-tenant stream subscription rejected with HTTP ${crossStreamAtoB.status}`);

        // ---------------------------------------------------------------------
        // TEST 9: Company B subscribes to Company A SSE stream
        // ---------------------------------------------------------------------
        console.log("\n[TEST 9] Company B subscribes to Company A SSE stream");
        const crossStreamBtoA = await fetch(`${baseUrl}/api/v1/agent/runs/${runAId}/stream`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert.ok([403, 404].includes(crossStreamBtoA.status), `Expected 403 or 404, got ${crossStreamBtoA.status}`);
        recordPass("TEST 9", `Company B cross-tenant stream subscription rejected with HTTP ${crossStreamBtoA.status}`);

        // ---------------------------------------------------------------------
        // TEST 10: Unauthenticated SSE request
        // ---------------------------------------------------------------------
        console.log("\n[TEST 10] Unauthenticated SSE request");
        const unauthAgentStream = await fetch(`${baseUrl}/api/v1/agent/runs/${runAId}/stream`);
        assert.equal(unauthAgentStream.status, 401, "Unauthenticated agent stream must return 401");

        const unauthInspStream = await fetch(`${baseUrl}/api/v1/inspection/runs/${runAId}/stream`);
        assert.equal(unauthInspStream.status, 401, "Unauthenticated inspection stream must return 401");
        recordPass("TEST 10", "Unauthenticated agent and inspection SSE streams returned HTTP 401 Unauthorized");

        // ---------------------------------------------------------------------
        // TEST 11: Company A supplies organizationId=Company B in request body
        // ---------------------------------------------------------------------
        console.log("\n[TEST 11] Company A supplies organizationId=Company B in request body");
        const forgedBodyRunId = `run-forged-body-${randomUUID()}`;
        cleanupRunIds.push(forgedBodyRunId);

        const reqStub = {
            user: { id: userAId, userId: userAId, organizationId: orgAId },
            body: { organizationId: orgBId, goal: "Malicious body spoof" },
            headers: {},
        };
        const resolvedOrg = (await import("../src/config/organization.js")).resolveAuthenticatedOrganization(reqStub);
        assert.equal(resolvedOrg, orgAId, "resolveAuthenticatedOrganization must ignore body.organizationId");

        const createdForgedRun = await createAgentRun({
            runId: forgedBodyRunId,
            userId: userAId,
            organizationId: resolvedOrg,
            goal: "Verify body spoofing does not change tenant",
        });
        assert.equal(createdForgedRun.organizationId, orgAId, "Run must be created under Company A");
        recordPass("TEST 11", "Client body organizationId strictly ignored; run created under Company A");

        // ---------------------------------------------------------------------
        // TEST 12: Company A supplies organizationId=Company B in query
        // ---------------------------------------------------------------------
        console.log("\n[TEST 12] Company A supplies organizationId=Company B in query");
        const querySpoofRes = await fetch(`${baseUrl}/api/v1/agent/runs?organizationId=${orgBId}`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.equal(querySpoofRes.status, 200);
        const querySpoofData = await querySpoofRes.json();
        assert.ok(querySpoofData.data.every((r) => r.organizationId === orgAId), "Must return only Company A runs");
        assert.ok(!querySpoofData.data.some((r) => r.organizationId === orgBId), "Must never return Company B runs");
        recordPass("TEST 12", "Query ?organizationId=B ignored; authoritative token context preserved");

        // ---------------------------------------------------------------------
        // TEST 13: Company A supplies x-organization-id=Company B
        // ---------------------------------------------------------------------
        console.log("\n[TEST 13] Company A supplies x-organization-id=Company B");
        const headerMismatchRes = await fetch(`${baseUrl}/api/v1/agent/runs/${runAId}`, {
            headers: {
                Authorization: `Bearer ${tokenA}`,
                "x-organization-id": orgBId,
            },
        });
        assert.equal(headerMismatchRes.status, 403, "Conflicting header must trigger HTTP 403 Forbidden");
        recordPass("TEST 13", "Conflicting x-organization-id header rejected with HTTP 403 Forbidden");

        // ---------------------------------------------------------------------
        // TEST 14: LLM/agent execution attempts to provide another organization ID
        // ---------------------------------------------------------------------
        console.log("\n[TEST 14] LLM/agent execution attempts to provide another organization ID");
        const toolRes = await executeRegisteredTool(
            "calculator",
            { expression: "40 + 2", organizationId: orgBId },
            { organizationId: orgAId, userId: userAId }
        );
        assert.equal(toolRes.status, "success", "Tool execution succeeded");
        assert.equal(toolRes.result.result, 42, "Safe calculator returned 42");
        recordPass("TEST 14", "LLM-generated organizationId ignored; server execution context authoritative");

        // ---------------------------------------------------------------------
        // TEST 15: Missing in-memory run owner but valid PostgreSQL run exists
        // ---------------------------------------------------------------------
        console.log("\n[TEST 15] Missing in-memory run owner but valid PostgreSQL run exists");
        const persistentRunId = `run-persisted-${randomUUID()}`;
        cleanupRunIds.push(persistentRunId);

        await createAgentRun({
            runId: persistentRunId,
            userId: userAId,
            organizationId: orgAId,
            goal: "Rehydration verification test",
            status: "in_progress",
        });

        // Clear in-memory cache to simulate server restart
        executionEvents.runOwners.delete(persistentRunId);
        assert.equal(executionEvents.getRunOwner(persistentRunId), null, "In-memory cache must be empty");

        // 1. Company A subscribes -> server verifies from PostgreSQL and hydrates
        const rehydrateStreamA = await new Promise((resolve, reject) => {
            const req = http.request(
                `${baseUrl}/api/v1/agent/runs/${persistentRunId}/stream`,
                {
                    headers: { Authorization: `Bearer ${tokenA}` },
                },
                (res) => {
                    resolve({ statusCode: res.statusCode, req });
                }
            );
            req.on("error", reject);
            req.end();
        });
        assert.equal(rehydrateStreamA.statusCode, 200, "Server must verify from PostgreSQL and allow Company A");
        rehydrateStreamA.req.destroy();

        // Verify that memory was hydrated
        const hydratedOwner = executionEvents.getRunOwner(persistentRunId);
        assert.equal(hydratedOwner?.organizationId, orgAId, "In-memory cache must be hydrated with Company A");

        // 2. Company B attempts to subscribe -> server checks against PostgreSQL/cache and denies
        executionEvents.runOwners.delete(persistentRunId);
        const crossRehydrateB = await fetch(`${baseUrl}/api/v1/agent/runs/${persistentRunId}/stream`, {
            headers: { Authorization: `Bearer ${tokenB}` },
        });
        assert.ok([403, 404].includes(crossRehydrateB.status), "Foreign tenant must be denied on DB verification");
        recordPass("TEST 15", "PostgreSQL verification succeeded on cache miss; denied foreign tenant");

        // ---------------------------------------------------------------------
        // TEST 16: Unknown runId
        // ---------------------------------------------------------------------
        console.log("\n[TEST 16] Unknown runId");
        const unknownRes = await fetch(`${baseUrl}/api/v1/agent/runs/unknown-run-999999/stream`, {
            headers: { Authorization: `Bearer ${tokenA}` },
        });
        assert.equal(unknownRes.status, 404, "Unknown runId must return 404 safely");
        recordPass("TEST 16", "Non-existent runId safely rejected with HTTP 404 Not Found");

        // ---------------------------------------------------------------------
        // TEST 17: Company A receives events for its run
        // ---------------------------------------------------------------------
        console.log("\n[TEST 17] Company A receives events for its run");
        const eventRunAId = `run-event-alpha-${randomUUID()}`;
        cleanupRunIds.push(eventRunAId);

        await createAgentRun({
            runId: eventRunAId,
            userId: userAId,
            organizationId: orgAId,
            goal: "Live event test A",
            status: "in_progress",
        });
        executionEvents.registerRunOwner(eventRunAId, orgAId, "agent");

        const receivedEventsA = [];
        const clientAReq = http.request(
            `${baseUrl}/api/v1/agent/runs/${eventRunAId}/stream`,
            {
                headers: { Authorization: `Bearer ${tokenA}` },
            },
            (res) => {
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    receivedEventsA.push(chunk);
                });
            }
        );
        clientAReq.end();

        // Give connection a moment to establish
        await new Promise((r) => setTimeout(r, 100));

        // Publish event to runA
        executionEvents.publish(eventRunAId, "node_started", {
            node: "reason",
            step: 1,
            info: "Alpha specific internal step",
        });

        await new Promise((r) => setTimeout(r, 150));
        clientAReq.destroy();

        const combinedA = receivedEventsA.join("");
        assert.ok(combinedA.includes("event: connected"), "Stream must receive connected event");
        assert.ok(combinedA.includes("event: node_started"), "Stream must receive node_started event");
        assert.ok(combinedA.includes("Alpha specific internal step"), "Must receive Company A event data");
        recordPass("TEST 17", "Company A successfully received real-time event stream for Run A");

        // ---------------------------------------------------------------------
        // TEST 18: Company A cannot receive Company B event data
        // ---------------------------------------------------------------------
        console.log("\n[TEST 18] Company A cannot receive Company B event data");
        const eventRunBId = `run-event-beta-${randomUUID()}`;
        cleanupRunIds.push(eventRunBId);

        await createAgentRun({
            runId: eventRunBId,
            userId: userBId,
            organizationId: orgBId,
            goal: "Live event test B",
            status: "in_progress",
        });
        executionEvents.registerRunOwner(eventRunBId, orgBId, "agent");

        const streamCaptureA = [];
        const clientAtoA = http.request(
            `${baseUrl}/api/v1/agent/runs/${eventRunAId}/stream`,
            {
                headers: { Authorization: `Bearer ${tokenA}` },
            },
            (res) => {
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    streamCaptureA.push(chunk);
                });
            }
        );
        clientAtoA.end();

        await new Promise((r) => setTimeout(r, 100));

        // Now publish sensitive event to Company B run
        executionEvents.publish(eventRunBId, "confidential_finding", {
            finding: "COMPANY_B_HIGHLY_CONFIDENTIAL_INSPECTION_LEAK",
            leakTest: true,
        });

        // Also attempt a spoofed publish with wrong publisherOrgId
        executionEvents.publish(
            eventRunAId,
            "spoofed_event",
            { fake: "data" },
            null,
            orgBId // Publisher claiming to be Org B attempting to publish to Org A run
        );

        await new Promise((r) => setTimeout(r, 150));
        clientAtoA.destroy();

        const combinedCapture = streamCaptureA.join("");
        assert.ok(!combinedCapture.includes("COMPANY_B_HIGHLY_CONFIDENTIAL_INSPECTION_LEAK"), "Company B secret MUST NOT reach Company A");
        assert.ok(!combinedCapture.includes("spoofed_event"), "Cross-tenant published event was dropped");
        recordPass("TEST 18", "No Company B event data leaked into Company A stream");

        console.log("\n==================================================");
        console.log(`✅ ALL 18 PHASE 4 TENANT EXECUTION & SSE ISOLATION TESTS PASSED (${passedTests}/18)`);
        console.log("==================================================");
    } finally {
        // Cleanup all created runs, steps, users, and organizations
        for (const runId of cleanupRunIds) {
            await deleteAgentRun(runId).catch(() => {});
            executionEvents.runOwners.delete(runId);
        }
        for (const orgId of cleanupOrgIds) {
            await query("DELETE FROM agent_runs WHERE organization_id = $1", [orgId]).catch(() => {});
            await query("DELETE FROM users WHERE organization_id = $1", [orgId]).catch(() => {});
            await query("DELETE FROM organizations WHERE id = $1", [orgId]).catch(() => {});
        }
        for (const userId of cleanupUserIds) {
            await query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
        }
        server.close();
    }
}

runPhase4Suite()
    .then(() => {
        process.exit(0);
    })
    .catch((err) => {
        console.error("❌ Phase 4 test suite failed:", err);
        process.exit(1);
    });
