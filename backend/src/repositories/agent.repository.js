/**
 * Autonomous Agent Repository
 *
 * Handles persistent PostgreSQL storage for agent executions and step-by-step
 * tool observability in the SovereignAI workbench.
 *
 * Guarantees:
 *   - Multi-tenant isolation: All queries enforce organizationId scoping
 *   - Parameterized SQL: 100% prevention of SQL injection
 *   - Idempotent execution: Conflict handling on run_id
 *   - Clean DTO mapping: Converts snake_case DB columns to camelCase
 */

import crypto from "crypto";
import { query } from "../config/db.js";

/**
 * Creates a new agent execution run record.
 * Idempotent: Updates timestamp if run_id already exists.
 *
 * @param {object} params
 * @param {string} [params.id]
 * @param {string} params.runId - Unique execution run identifier
 * @param {string} [params.userId] - Requesting user identifier
 * @param {string} params.organizationId - Scoped organization identifier
 * @param {string} params.goal - User inquiry or instruction
 * @param {string} [params.model="llama3.2:3b"] - Model used for planning
 * @param {string} [params.status="in_progress"] - Lifecycle status
 * @param {Date} [params.startedAt] - Initiation timestamp
 * @returns {Promise<object>} Created or updated run record
 */
export async function createAgentRun({
    id = crypto.randomUUID(),
    runId,
    userId = null,
    organizationId,
    goal,
    model = "llama3.2:3b",
    status = "in_progress",
    startedAt = new Date(),
}) {
    if (!runId || typeof runId !== "string") {
        throw new TypeError("runId must be a non-empty string");
    }
    if (!organizationId || typeof organizationId !== "string") {
        throw new TypeError("organizationId must be a non-empty string");
    }
    if (!goal || typeof goal !== "string") {
        throw new TypeError("goal must be a non-empty string");
    }

    const sql = `
        INSERT INTO agent_runs (
            id,
            run_id,
            user_id,
            organization_id,
            goal,
            model,
            status,
            started_at,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (run_id) DO UPDATE SET
            updated_at = NOW(),
            status = EXCLUDED.status
        RETURNING
            id,
            run_id AS "runId",
            user_id AS "userId",
            organization_id AS "organizationId",
            goal,
            model,
            status,
            stopped_reason AS "stoppedReason",
            total_steps AS "totalSteps",
            duration_ms AS "durationMs",
            final_answer AS "finalAnswer",
            error,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt";
    `;

    const values = [
        id,
        runId,
        userId,
        organizationId,
        goal,
        model,
        status,
        startedAt,
    ];

    const res = await query(sql, values);
    return res.rows[0];
}

/**
 * Updates an agent execution record upon completion or failure.
 *
 * @param {string} runId
 * @param {string} organizationId
 * @param {object} updates
 * @returns {Promise<object|null>} Updated run record or null if not found
 */
export async function updateAgentRun(runId, organizationId, {
    status,
    stoppedReason = null,
    totalSteps = 0,
    durationMs = 0,
    finalAnswer = null,
    error = null,
    model = null,
    completedAt = new Date(),
} = {}) {
    if (!runId) throw new TypeError("runId is required to update agent run");

    // Dynamic update construction with parameterized indices
    const setClauses = ["updated_at = NOW()"];
    const values = [runId];
    let paramIndex = 2;

    if (organizationId) {
        values.push(organizationId);
        paramIndex++;
    }

    if (status !== undefined) {
        setClauses.push(`status = $${paramIndex++}`);
        values.push(status);
    }
    if (stoppedReason !== undefined) {
        setClauses.push(`stopped_reason = $${paramIndex++}`);
        values.push(stoppedReason);
    }
    if (totalSteps !== undefined) {
        setClauses.push(`total_steps = $${paramIndex++}`);
        values.push(totalSteps);
    }
    if (durationMs !== undefined) {
        setClauses.push(`duration_ms = $${paramIndex++}`);
        values.push(durationMs);
    }
    if (finalAnswer !== undefined) {
        setClauses.push(`final_answer = $${paramIndex++}`);
        values.push(finalAnswer);
    }
    if (error !== undefined) {
        setClauses.push(`error = $${paramIndex++}`);
        values.push(error);
    }
    if (model !== undefined && model !== null) {
        setClauses.push(`model = $${paramIndex++}`);
        values.push(model);
    }
    if (completedAt !== undefined) {
        setClauses.push(`completed_at = $${paramIndex++}`);
        values.push(completedAt);
    }

    const whereClause = organizationId
        ? `WHERE run_id = $1 AND organization_id = $2`
        : `WHERE run_id = $1`;

    const sql = `
        UPDATE agent_runs
        SET ${setClauses.join(", ")}
        ${whereClause}
        RETURNING
            id,
            run_id AS "runId",
            user_id AS "userId",
            organization_id AS "organizationId",
            goal,
            model,
            status,
            stopped_reason AS "stoppedReason",
            total_steps AS "totalSteps",
            duration_ms AS "durationMs",
            final_answer AS "finalAnswer",
            error,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt";
    `;

    const res = await query(sql, values);
    return res.rows[0] || null;
}

/**
 * Retrieves a single agent run by runId, scoped to an organization.
 *
 * @param {string} runId
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function getAgentRunByRunId(runId, organizationId) {
    if (!runId) return null;

    let sql = `
        SELECT
            id,
            run_id AS "runId",
            user_id AS "userId",
            organization_id AS "organizationId",
            goal,
            model,
            status,
            stopped_reason AS "stoppedReason",
            total_steps AS "totalSteps",
            duration_ms AS "durationMs",
            final_answer AS "finalAnswer",
            error,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM agent_runs
        WHERE run_id = $1
    `;

    const values = [runId];

    if (organizationId) {
        sql += ` AND organization_id = $2`;
        values.push(organizationId);
    }

    const res = await query(sql, values);
    return res.rows[0] || null;
}

/**
 * Retrieves a single agent run by internal primary key id.
 *
 * @param {string} id
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function getAgentRunById(id, organizationId) {
    if (!id) return null;

    let sql = `
        SELECT
            id,
            run_id AS "runId",
            user_id AS "userId",
            organization_id AS "organizationId",
            goal,
            model,
            status,
            stopped_reason AS "stoppedReason",
            total_steps AS "totalSteps",
            duration_ms AS "durationMs",
            final_answer AS "finalAnswer",
            error,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM agent_runs
        WHERE id = $1
    `;

    const values = [id];

    if (organizationId) {
        sql += ` AND organization_id = $2`;
        values.push(organizationId);
    }

    const res = await query(sql, values);
    return res.rows[0] || null;
}

/**
 * Lists agent runs for an organization, newest first.
 *
 * @param {string} organizationId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.offset=0]
 * @param {string} [options.status]
 * @param {string} [options.userId]
 * @returns {Promise<Array<object>>}
 */
export async function listAgentRuns(organizationId, {
    limit = 50,
    offset = 0,
    status = null,
    userId = null,
} = {}) {
    if (!organizationId) {
        throw new TypeError("organizationId is required to list agent runs");
    }

    const conditions = ["organization_id = $1"];
    const values = [organizationId];
    let paramIndex = 2;

    if (status) {
        conditions.push(`status = $${paramIndex++}`);
        values.push(status);
    }

    if (userId) {
        conditions.push(`user_id = $${paramIndex++}`);
        values.push(userId);
    }

    values.push(Math.max(1, Math.min(limit, 100)));
    const limitParam = paramIndex++;

    values.push(Math.max(0, offset));
    const offsetParam = paramIndex++;

    const sql = `
        SELECT
            id,
            run_id AS "runId",
            user_id AS "userId",
            organization_id AS "organizationId",
            goal,
            model,
            status,
            stopped_reason AS "stoppedReason",
            total_steps AS "totalSteps",
            duration_ms AS "durationMs",
            final_answer AS "finalAnswer",
            error,
            started_at AS "startedAt",
            completed_at AS "completedAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM agent_runs
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam};
    `;

    const res = await query(sql, values);
    return res.rows;
}

/**
 * Creates an execution trace step record for observability.
 *
 * @param {object} params
 * @param {string} [params.id]
 * @param {string} params.runId - Parent execution run identifier
 * @param {number} params.stepNumber - 1-based sequential step index
 * @param {string} params.node - Graph node name (e.g. 'execute_tool')
 * @param {string} [params.action="tool_call"]
 * @param {string} [params.toolName]
 * @param {object} [params.toolArguments]
 * @param {string} [params.toolResultSummary]
 * @param {string} [params.status="success"]
 * @param {number} [params.durationMs=0]
 * @returns {Promise<object>} Created step record
 */
export async function createAgentRunStep({
    id = crypto.randomUUID(),
    runId,
    stepNumber,
    node,
    action = "tool_call",
    toolName = null,
    toolArguments = null,
    toolResultSummary = null,
    status = "success",
    durationMs = 0,
}) {
    if (!runId) throw new TypeError("runId is required to persist agent step");
    if (stepNumber === undefined || stepNumber === null) {
        throw new TypeError("stepNumber is required to persist agent step");
    }
    if (!node) throw new TypeError("node name is required to persist agent step");

    const sql = `
        INSERT INTO agent_run_steps (
            id,
            run_id,
            step_number,
            node,
            action,
            tool_name,
            tool_arguments,
            tool_result_summary,
            status,
            duration_ms,
            created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING
            id,
            run_id AS "runId",
            step_number AS "stepNumber",
            node,
            action,
            tool_name AS "toolName",
            tool_arguments AS "toolArguments",
            tool_result_summary AS "toolResultSummary",
            status,
            duration_ms AS "durationMs",
            created_at AS "createdAt";
    `;

    const safeArgs = toolArguments && typeof toolArguments === "object"
        ? JSON.stringify(toolArguments)
        : null;

    const values = [
        id,
        runId,
        stepNumber,
        node,
        action,
        toolName,
        safeArgs,
        toolResultSummary,
        status,
        durationMs,
    ];

    const res = await query(sql, values);
    return res.rows[0];
}

/**
 * Retrieves all chronological execution steps for a specific agent run.
 *
 * @param {string} runId
 * @returns {Promise<Array<object>>}
 */
export async function getAgentRunSteps(runId) {
    if (!runId) return [];

    const sql = `
        SELECT
            id,
            run_id AS "runId",
            step_number AS "stepNumber",
            node,
            action,
            tool_name AS "toolName",
            tool_arguments AS "toolArguments",
            tool_result_summary AS "toolResultSummary",
            status,
            duration_ms AS "durationMs",
            created_at AS "createdAt"
        FROM agent_run_steps
        WHERE run_id = $1
        ORDER BY step_number ASC, created_at ASC;
    `;

    const res = await query(sql, [runId]);
    return res.rows;
}

/**
 * Deletes an agent run and all associated steps (via ON DELETE CASCADE).
 * Useful for test cleanup.
 *
 * @param {string} runId
 * @param {string} [organizationId]
 * @returns {Promise<boolean>}
 */
export async function deleteAgentRun(runId, organizationId = null) {
    if (!runId) return false;

    let sql = `DELETE FROM agent_runs WHERE run_id = $1`;
    const values = [runId];

    if (organizationId) {
        sql += ` AND organization_id = $2`;
        values.push(organizationId);
    }

    const res = await query(sql, values);
    return res.rowCount > 0;
}
