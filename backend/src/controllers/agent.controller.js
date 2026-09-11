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
import { runInspectionAgent } from "../services/inspection-agent.service.js";
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
        const { goal, task, maxSteps, timeoutMs, documentId } = req.body || {};
        
        const finalGoal = goal || task;

        if (!finalGoal || typeof finalGoal !== "string" || !finalGoal.trim()) {
            return res.status(400).json({
                success: false,
                message: "A non-empty 'goal' or 'task' string is required.",
            });
        }

        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || null;

        if (documentId) {
            if (typeof documentId !== "string" || !documentId.trim() || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(documentId.trim())) {
                return res.status(400).json({
                    success: false,
                    code: "VALIDATION_ERROR",
                    message: "Malformed documentId. Must be a valid UUID.",
                });
            }

            const { runInspectionAgent } = await import("../services/inspection-agent.service.js");
            const result = await runInspectionAgent({
                documentId: documentId.trim(),
                goal: finalGoal.trim(),
                maxSteps: Number.isInteger(maxSteps) ? maxSteps : undefined,
                timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : undefined,
                organizationId,
                userId,
            });
            return res.status(200).json(result);
        }

        const result = await runAgentLoop({
            goal: finalGoal.trim(),
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
            // Defensive: check if run exists in another tenant for explicit 403
            const foreignRun = await getAgentRunByRunId(runId);
            if (foreignRun) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Agent run belongs to another organization.",
                });
            }

            return res.status(404).json({
                success: false,
                message: `Agent run '${runId}' not found.`,
            });
        }

        return res.status(200).json({
            success: true,
            run: {
                id: run.runId || run.id,
                task: run.goal,
                status: run.status?.toUpperCase() || "RUNNING",
                currentStep: run.currentStep || "idle"
            }
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
            const foreignRun = await getAgentRunByRunId(runId);
            if (foreignRun) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Agent run belongs to another organization.",
                });
            }

            return res.status(404).json({
                success: false,
                message: `Agent run '${runId}' not found.`,
            });
        }

        const steps = await getStepsByRunId(runId, organizationId);

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

        // Verify organization authorization with PostgreSQL fallback
        const authCheck = await executionEvents.verifyOrHydrateRunOwner(runId, organizationId);
        if (authCheck.forbidden) {
            return res.status(403).json({
                success: false,
                message: authCheck.message || "Forbidden: Run belongs to another organization.",
            });
        }
        if (authCheck.notFound) {
            return res.status(404).json({
                success: false,
                message: authCheck.message || `Agent run '${runId}' not found.`,
            });
        }

        const persistedSteps = await getStepsByRunId(runId, organizationId);
        executionEvents.subscribe(runId, req, res, { organizationId, persistedSteps });
    } catch (error) {
        next(error);
    }
}

/**
 * Executes the dedicated industrial Inspection Agent workflow.
 * POST /api/v1/agent/inspection
 */
export async function runInspectionAgentController(req, res, next) {
    try {
        const { documentId, goal } = req.body || {};

        if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
            return res.status(400).json({
                success: false,
                message: "A non-empty 'documentId' string is required.",
            });
        }

        const organizationId = resolveAuthenticatedOrganization(req);
        const userId = req.user?.id || req.user?.userId || null;

        const result = await runInspectionAgent({
            documentId: documentId.trim(),
            goal: typeof goal === "string" && goal.trim() ? goal.trim() : undefined,
            organizationId,
            userId,
        });

        return res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
}

/**
 * Dedicated Phase 7 Inspection Agent analysis endpoint.
 * POST /api/v1/agents/inspection/analyze
 */
export async function analyzeInspectionController(req, res, next) {
    try {
        const { documentId, goal, organizationId: bodyOrgId } = req.body || {};

        if (!documentId || typeof documentId !== "string" || !documentId.trim()) {
            return res.status(400).json({
                success: false,
                message: "A non-empty 'documentId' string is required.",
            });
        }

        // Authoritatively resolve organizationId: from auth context, or bodyOrgId if unauthenticated (e.g. system test)
        let organizationId;
        try {
            organizationId = resolveAuthenticatedOrganization(req);
        } catch (authErr) {
            if (bodyOrgId && typeof bodyOrgId === "string" && bodyOrgId.trim()) {
                organizationId = bodyOrgId.trim();
            } else {
                throw authErr;
            }
        }

        const userId = req.user?.id || req.user?.userId || null;

        const result = await runInspectionAgent({
            documentId: documentId.trim(),
            goal: typeof goal === "string" && goal.trim() ? goal.trim() : undefined,
            organizationId,
            userId,
        });

        return res.status(200).json({
            success: true,
            runId: result.runId,
            status: result.status,
            result: result.result,
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
        }
        next(error);
    }
}

/**
 * Retrieves execution status and activity for a dedicated inspection run.
 * GET /api/v1/agents/inspection/runs/:runId
 */
export async function getInspectionRunController(req, res, next) {
    try {
        const { runId } = req.params;
        let organizationId = null;
        try {
            organizationId = resolveAuthenticatedOrganization(req);
        } catch (_) {
            organizationId = req.headers["x-organization-id"] || null;
        }

        const run = await getAgentRunByRunId(runId, organizationId);
        if (!run) {
            const foreignRun = await getAgentRunByRunId(runId);
            if (foreignRun) {
                return res.status(403).json({
                    success: false,
                    message: "Forbidden: Run belongs to another organization.",
                });
            }
            return res.status(404).json({
                success: false,
                message: `Inspection run '${runId}' not found.`,
            });
        }

        const steps = await getStepsByRunId(runId, run.organizationId);

        let finalResult = null;
        if (run.finalAnswer) {
            try {
                finalResult = JSON.parse(run.finalAnswer);
            } catch (_) {
                finalResult = run.finalAnswer;
            }
        }

        return res.status(200).json({
            success: true,
            runId: run.runId,
            status: run.status,
            goal: run.goal,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            result: finalResult,
            steps: steps.map((s) => ({
                step: s.node,
                status: s.status,
                timestamp: s.createdAt,
                message: s.toolResultSummary,
            })),
        });
    } catch (error) {
        next(error);
    }
}

