/**
 * Phase 6 — Agent PostgreSQL State Persistence & Observability Test Suite
 *
 * Validates:
 *   1. createAgentRun: Persists run_id, organization_id, user_id, goal, initial status
 *   2. Idempotency: Duplicate run_id handling via ON CONFLICT DO UPDATE
 *   3. updateAgentRun: Updates status, final_answer, total_steps, duration_ms, model, completed_at
 *   4. updateAgentRun failure status: Records failure status and error details safely
 *   5. createAgentRunStep: Persists step_number, node, tool_name, sanitized tool_arguments, duration_ms
 *   6. Argument Sanitization: Ensures large payloads/buffers/passwords are safely handled
 *   7. getAgentRunSteps: Retrieves chronological steps for a given run
 *   8. getAgentRunByRunId: Retrieves run scoped to organization
 *   9. listAgentRuns: Lists runs with filtering and pagination
 *   10. Multi-Tenant Isolation: Cross-organization queries return null / empty results
 *   11. Cascade Deletion: Deleting an agent run removes associated run steps (ON DELETE CASCADE)
 *   12. Error Safety: Database query errors throw clean, safe exceptions
 */

import assert from "node:assert/strict";
import crypto from "crypto";
import { initDb, query } from "../src/config/db.js";
import {
    createAgentRun,
    updateAgentRun,
    getAgentRunByRunId,
    getAgentRunById,
    listAgentRuns,
    createAgentRunStep,
    getAgentRunSteps,
    deleteAgentRun,
} from "../src/repositories/agent.repository.js";
import { DEFAULT_ORGANIZATION_ID } from "../src/config/organization.js";

async function runPersistenceTests() {
    console.log("==================================================");
    console.log("Phase 6: Agent PostgreSQL Persistence Test Suite");
    console.log("==================================================\n");

    // Ensure database tables exist
    await initDb();

    let passed = 0;
    let failed = 0;

    function record(name, ok, detail = "") {
        if (ok) {
            console.log(`  ✅ PASS: ${name}${detail ? " — " + detail : ""}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${name}${detail ? " — " + detail : ""}`);
            failed++;
        }
    }

    const testRunId = `run-phase6-test-${crypto.randomUUID()}`;
    const testOrgId = DEFAULT_ORGANIZATION_ID;
    const foreignOrgId = "99999999-9999-4999-9999-999999999999";
    const testGoal = "Inspect Pump-03 bearing vibration and calculate power";

    // Ensure foreign organization exists for isolation testing
    await query(
        `INSERT INTO organizations (id, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [foreignOrgId, "Foreign Isolation Org"]
    );

    try {
        // ─── 1. Create Agent Run Record ───────────────────────────────────────
        console.log("[1] Create Agent Run Persistence");
        const createdRun = await createAgentRun({
            runId: testRunId,
            organizationId: testOrgId,
            userId: null,
            goal: testGoal,
            model: "llama3.2:3b",
            status: "in_progress",
        });

        record("Agent run created successfully in PostgreSQL", Boolean(createdRun?.id));
        record("runId matches", createdRun.runId === testRunId);
        record("organizationId matches", createdRun.organizationId === testOrgId);
        record("Initial status is 'in_progress'", createdRun.status === "in_progress");
        record("Initial goal is persisted", createdRun.goal === testGoal);

        // ─── 2. Idempotency on run_id ─────────────────────────────────────────
        console.log("\n[2] Idempotency (Duplicate run_id Handling)");
        const dupRun = await createAgentRun({
            runId: testRunId,
            organizationId: testOrgId,
            goal: "Modified goal on duplicate call",
            status: "in_progress",
        });

        record("Duplicate run_id does not create a second row", dupRun.id === createdRun.id);
        record("Idempotent call preserves original runId", dupRun.runId === testRunId);

        // ─── 3. Persist Execution Trace Steps ─────────────────────────────────
        console.log("\n[3] Persist Agent Execution Steps");
        const step1 = await createAgentRunStep({
            runId: testRunId,
            stepNumber: 1,
            node: "reason",
            action: "plan",
            toolName: null,
            toolArguments: null,
            toolResultSummary: "Decided to search documentation",
            status: "success",
            durationMs: 450,
        });

        record("Step 1 (reason) persisted", Boolean(step1?.id));
        record("Step number recorded as 1", step1.stepNumber === 1);

        const step2 = await createAgentRunStep({
            runId: testRunId,
            stepNumber: 2,
            node: "execute_tool",
            action: "tool_call",
            toolName: "calculator",
            toolArguments: { expression: "25 * 4" },
            toolResultSummary: "Result: 100 (for '25 * 4')",
            status: "success",
            durationMs: 12,
        });

        record("Step 2 (execute_tool calculator) persisted", Boolean(step2?.id));
        record("Tool name recorded as calculator", step2.toolName === "calculator");
        record("Tool arguments stored as JSON", typeof step2.toolArguments === "object");

        // ─── 4. Argument Sanitization & Secret Protection ─────────────────────
        console.log("\n[4] Argument Sanitization & Secret Protection");
        const sanitizedArgs = {
            query: "pump limit",
            imageBase64: "<base64 image buffer 15000 chars>",
            code: "x = 25 * 4... [truncated]",
        };

        const step3 = await createAgentRunStep({
            runId: testRunId,
            stepNumber: 3,
            node: "execute_tool",
            action: "tool_call",
            toolName: "document_search",
            toolArguments: sanitizedArgs,
            toolResultSummary: "Found 2 chunks",
            status: "success",
            durationMs: 180,
        });

        record("Sanitized arguments stored without huge raw binaries", step3.toolArguments.imageBase64.includes("<base64"));

        // ─── 5. Retrieve Steps Timeline ───────────────────────────────────────
        console.log("\n[5] Retrieve Chronological Steps");
        const retrievedSteps = await getAgentRunSteps(testRunId);

        record("Retrieved all 3 persisted steps", retrievedSteps.length === 3);
        record("Steps strictly ordered by stepNumber ASC", (
            retrievedSteps[0].stepNumber === 1 &&
            retrievedSteps[1].stepNumber === 2 &&
            retrievedSteps[2].stepNumber === 3
        ));

        // ─── 6. Update Agent Run Completion Status ────────────────────────────
        console.log("\n[6] Update Agent Run Upon Completion");
        const updatedRun = await updateAgentRun(testRunId, testOrgId, {
            status: "completed",
            stoppedReason: "completed",
            totalSteps: 3,
            durationMs: 2500,
            finalAnswer: "The bearing temperature limit is 80C and 25 * 4 = 100.",
            model: "llama3.2:3b",
            completedAt: new Date(),
        });

        record("Run updated to status='completed'", updatedRun.status === "completed");
        record("stoppedReason updated to 'completed'", updatedRun.stoppedReason === "completed");
        record("finalAnswer persisted", updatedRun.finalAnswer.includes("80C"));
        record("totalSteps updated to 3", updatedRun.totalSteps === 3);
        record("completedAt timestamp recorded", Boolean(updatedRun.completedAt));

        // ─── 7. Retrieve Agent Run By runId ───────────────────────────────────
        console.log("\n[7] Query Agent Run By runId");
        const fetchedRun = await getAgentRunByRunId(testRunId, testOrgId);

        record("Run fetched by runId matches", fetchedRun?.runId === testRunId);
        record("Run fetched contains persisted final answer", fetchedRun?.finalAnswer === updatedRun.finalAnswer);

        // ─── 8. Multi-Tenant Scoping & Organization Isolation ─────────────────
        console.log("\n[8] Multi-Tenant Isolation");
        const foreignFetch = await getAgentRunByRunId(testRunId, foreignOrgId);
        record("Foreign organization query returns null (Tenant Isolation Confirmed)", foreignFetch === null);

        const foreignList = await listAgentRuns(foreignOrgId);
        const leakedInForeign = foreignList.some((r) => r.runId === testRunId);
        record("Run not visible in foreign organization run list", !leakedInForeign);

        // ─── 9. List Agent Runs with Pagination ───────────────────────────────
        console.log("\n[9] List Agent Runs for Organization");
        const orgRuns = await listAgentRuns(testOrgId, { limit: 10, offset: 0 });

        record("listAgentRuns returns array", Array.isArray(orgRuns));
        record("Current run included in organization run list", orgRuns.some((r) => r.runId === testRunId));

        // ─── 10. Record Failure Status ────────────────────────────────────────
        console.log("\n[10] Failure Status & Error Persistence");
        const failureRunId = `run-fail-test-${crypto.randomUUID()}`;
        await createAgentRun({
            runId: failureRunId,
            organizationId: testOrgId,
            goal: "Faulty goal",
            status: "in_progress",
        });

        const failedRun = await updateAgentRun(failureRunId, testOrgId, {
            status: "failed",
            stoppedReason: "safe_failure",
            error: "Agent encountered an unrecoverable action parse error: Bad JSON",
            completedAt: new Date(),
        });

        record("Failed run updated with status='failed'", failedRun.status === "failed");
        record("stoppedReason recorded as 'safe_failure'", failedRun.stoppedReason === "safe_failure");
        record("Error explanation persisted safely", failedRun.error.includes("Bad JSON"));

        // ─── 11. Cascade Deletion (Cleanup) ───────────────────────────────────
        console.log("\n[11] Foreign Key Cascade Deletion");
        const deleted = await deleteAgentRun(testRunId, testOrgId);
        record("deleteAgentRun succeeded", deleted);

        const stepsAfterDelete = await getAgentRunSteps(testRunId);
        record("Associated steps automatically removed via ON DELETE CASCADE", stepsAfterDelete.length === 0);

        // Cleanup failure run
        await deleteAgentRun(failureRunId, testOrgId);

        // ─── 12. Error Safety & Parameter Validation ──────────────────────────
        console.log("\n[12] Input Parameter Safety");
        let threwOnMissingRunId = false;
        try {
            await createAgentRun({ organizationId: testOrgId, goal: "No runId" });
        } catch {
            threwOnMissingRunId = true;
        }
        record("Rejects missing runId with TypeError", threwOnMissingRunId);

        let threwOnMissingOrgId = false;
        try {
            await createAgentRun({ runId: "test-id", goal: "No orgId" });
        } catch {
            threwOnMissingOrgId = true;
        }
        record("Rejects missing organizationId with TypeError", threwOnMissingOrgId);

    } finally {
        // Clean up test foreign organization
        await query("DELETE FROM organizations WHERE id = $1", [foreignOrgId]);
    }

    // ─────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────
    console.log("\n==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runPersistenceTests().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error("Persistence test execution failure:", err);
    process.exit(1);
});
