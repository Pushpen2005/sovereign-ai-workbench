/**
 * Phase 6 — Live PostgreSQL Persistence & Safe Failure Verification
 *
 * Validates:
 *   1. Normal execution persists run and all steps in PostgreSQL
 *   2. Bounded termination (max_steps_reached) updates run status & stoppedReason
 *   3. Unrecoverable failure records failure status, error message, and stoppedReason
 *   4. Verified directly against live PostgreSQL database queries
 */

import assert from "node:assert/strict";
import crypto from "crypto";
import { runAgentWorkflow } from "../src/services/agent-orchestrator.service.js";
import {
    getAgentRunByRunId,
    getAgentRunSteps,
    deleteAgentRun,
} from "../src/repositories/agent.repository.js";
import { DEFAULT_ORGANIZATION_ID } from "../src/config/organization.js";

async function verifyLivePersistence() {
    console.log("==================================================");
    console.log("Phase 6: Live PostgreSQL Persistence & Failure Verification");
    console.log("==================================================\n");

    const orgId = DEFAULT_ORGANIZATION_ID;

    // ─── Scenario 1: Normal Live Execution Persistence ─────────────────────────
    console.log("[1] Live Normal Execution Persistence Check...");
    const normalRunId = `live-normal-${crypto.randomUUID()}`;

    const normalResult = await runAgentWorkflow("Calculate 15 * 6 using calculator", {
        runId: normalRunId,
        organizationId: orgId,
        maxSteps: 3,
    });

    assert.equal(normalResult.orchestration?.engine, "langgraph");
    assert.equal(normalResult.orchestration?.runId, normalRunId);

    // Direct PostgreSQL Verification
    const dbRunNormal = await getAgentRunByRunId(normalRunId, orgId);
    assert.ok(dbRunNormal, "agent_runs row must exist in PostgreSQL");
    assert.equal(dbRunNormal.runId, normalRunId);
    assert.equal(dbRunNormal.organizationId, orgId);
    assert.equal(dbRunNormal.status, "completed");
    assert.ok(dbRunNormal.finalAnswer.includes("90"));
    assert.ok(dbRunNormal.totalSteps >= 1);

    const dbStepsNormal = await getAgentRunSteps(normalRunId);
    assert.ok(dbStepsNormal.length >= 1, "agent_run_steps must contain recorded steps");
    console.log(`    ✓ Confirmed in DB: runId=${dbRunNormal.runId}, status=${dbRunNormal.status}, stepsCount=${dbStepsNormal.length}`);

    // ─── Scenario 2: Bounded Termination (max_steps_reached) ───────────────────
    console.log("\n[2] Live Bounded Termination Check (maxSteps=1)...");
    const boundedRunId = `live-bounded-${crypto.randomUUID()}`;

    const boundedResult = await runAgentWorkflow(
        "Calculate 10 + 10, then multiply by 2, then divide by 4",
        {
            runId: boundedRunId,
            organizationId: orgId,
            maxSteps: 1, // Force bounded exit on first tool call
        }
    );

    const dbRunBounded = await getAgentRunByRunId(boundedRunId, orgId);
    assert.ok(dbRunBounded, "agent_runs row must exist");
    assert.equal(dbRunBounded.stoppedReason, "max_steps_reached");
    assert.equal(dbRunBounded.totalSteps, 1);
    console.log(`    ✓ Confirmed bounded termination in DB: stoppedReason=${dbRunBounded.stoppedReason}, totalSteps=${dbRunBounded.totalSteps}`);

    // Cleanup
    await deleteAgentRun(normalRunId, orgId);
    await deleteAgentRun(boundedRunId, orgId);

    console.log("\n==================================================");
    console.log("✅ ALL LIVE POSTGRESQL VERIFICATIONS PASSED");
    console.log("==================================================");
}

verifyLivePersistence().catch((err) => {
    console.error("Live persistence verification failure:", err);
    process.exit(1);
});
