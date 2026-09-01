/**
 * PR #26 — Agent Controller
 *
 * Exposes:
 *   POST /api/v1/agent/run
 */

import { runAgentLoop, AgentRuntimeError } from "../services/agent.service.js";

export async function runAgent(req, res, next) {
    try {
        const { goal, maxSteps, timeoutMs } = req.body || {};

        if (!goal || typeof goal !== "string" || !goal.trim()) {
            return res.status(400).json({
                success: false,
                message: "A non-empty 'goal' string is required.",
            });
        }

        const result = await runAgentLoop({
            goal: goal.trim(),
            maxSteps: Number.isInteger(maxSteps) ? maxSteps : undefined,
            timeoutMs: Number.isInteger(timeoutMs) ? timeoutMs : undefined,
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
