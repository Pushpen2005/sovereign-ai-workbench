/**
 * PR #26 / Phase 6 — Agent Controller
 *
 * Exposes:
 *   POST /api/v1/agent/run
 *   GET  /api/v1/agent/runs
 *   GET  /api/v1/agent/runs/:runId
 *   GET  /api/v1/agent/runs/:runId/steps
 */

import { runAgentLoop, AgentRuntimeError } from "../services/agent.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";
import {
    listAgentRuns,
    getAgentRunByRunId,
    getAgentRunSteps as getStepsByRunId,
} from "../repositories/agent.repository.js";
import { executionEvents } from "../services/execution-events.service.js";

/**
 * Triggers an autonomous agent workflow execution.
 */
export async function runAgent(req, res, next) {
    try {
        const { goal, maxSteps, timeoutMs } = req.body || {};

        if (!goal || typeof goal !== "string" || !goal.trim()) {
            return res.status(400).json({
                success: false,
                message: "A non-empty 'goal' string is required.",
            });
        }

        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || null;

        const result = await runAgentLoop({
            goal: goal.trim(),
            maxSteps: Number.isInteger(maxSteps) ? maxSteps : undefined,
            timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : undefined,
            organizationId,
            userId,
        });

        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof AgentRuntimeError) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
}

/**
 * Lists agent execution runs for the requesting organization.
 */
export async function getAgentRuns(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const limit = parseInt(req.query.limit || "50", 10);
        const offset = parseInt(req.query.offset || "0", 10);
        const status = req.query.status || null;

        const runs = await listAgentRuns(organizationId, { limit, offset, status });

        return res.status(200).json({
            success: true,
            data: runs,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Retrieves a single agent run by runId, scoped to the requesting organization.
 */
export async function getAgentRun(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const { runId } = req.params;

        const run = await getAgentRunByRunId(runId, organizationId);

        if (!run) {
            return res.status(404).json({
                success: false,
                message: `Agent run '${runId}' not found in this organization.`,
            });
        }

        return res.status(200).json({
            success: true,
            data: run,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Retrieves the timeline of steps for an agent run, verifying organization access.
 */
export async function getAgentRunSteps(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const { runId } = req.params;

        // Verify organization ownership before exposing steps
        const run = await getAgentRunByRunId(runId, organizationId);

        if (!run) {
            return res.status(404).json({
                success: false,
                message: `Agent run '${runId}' not found in this organization.`,
            });
        }

        const steps = await getStepsByRunId(runId);

        return res.status(200).json({
            success: true,
            data: steps,
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Streams real-time Server-Sent Events (SSE) for an active or completed agent run.
 */
export async function streamAgentRun(req, res, next) {
    try {
        const organizationId = resolveAuthenticatedOrganization(req);
        const { runId } = req.params;

        // Verify organization authorization
        const run = await getAgentRunByRunId(runId, organizationId);
        if (!run) {
            const owner = executionEvents.getRunOwner(runId);
            if (!owner || owner.organizationId !== organizationId) {
                return res.status(404).json({
                    success: false,
                    message: `Agent run '${runId}' not found in this organization.`,
                });
            }
        }

        const persistedSteps = await getStepsByRunId(runId);
        executionEvents.subscribe(runId, req, res, { persistedSteps });
    } catch (error) {
        next(error);
    }
}
