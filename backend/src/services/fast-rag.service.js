import { randomUUID } from "crypto";
import { executionEvents } from "./execution-events.service.js";
import { executeDocumentSearch } from "./agentTools/documentSearch.tool.js";
import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import { DEFAULT_ORGANIZATION_ID } from "../config/organization.js";
import { AgentRuntimeError } from "./agent.service.js";
import { createAgentRun, updateAgentRun } from "../repositories/agent.repository.js";

/**
 * Runs a Fast RAG (Retrieval-Augmented Generation) workflow for simple DOCUMENT_ANALYSIS tasks.
 * Bypasses LangGraph to provide minimum-latency responses.
 *
 * @param {object} params
 * @param {string} params.goal - The user's question or search query
 * @param {string} params.organizationId
 * @param {string} [params.userId]
 * @param {string} [params.runId]
 * @param {string} [params.model]
 * @returns {Promise<object>}
 */
export async function runFastRagWorkflow({
    goal,
    organizationId,
    userId,
    runId,
    model = "gemma-2-2b-it-4bit"
}) {
    if (typeof goal !== "string" || !goal.trim()) {
        throw new AgentRuntimeError("goal must be a non-empty string");
    }

    const cleanGoal = goal.trim();
    const cleanRunId = runId || randomUUID();
    const cleanOrgId = organizationId || DEFAULT_ORGANIZATION_ID;
    const startTime = Date.now();

    // 1. Setup Observability
    try {
        executionEvents.registerRunOwner(cleanRunId, cleanOrgId, "fast_rag");
        await createAgentRun({
            runId: cleanRunId,
            userId: userId || null,
            organizationId: cleanOrgId,
            goal: cleanGoal,
            status: "in_progress",
            startedAt: new Date(startTime),
        });
    } catch (err) {
        console.warn("[FastRAG] Observability init warning:", err.message);
    }

    try {
        executionEvents.publish(cleanRunId, "run_started", {
            runId: cleanRunId,
            engine: "fast_rag",
            status: "in_progress",
            startedAt: new Date(startTime).toISOString(),
        });
        
        executionEvents.publish(cleanRunId, "step_started", {
            stepId: "rag_search",
            tool: "document_search",
            status: "in_progress",
            message: "Searching internal documents",
        });

        // 2. Direct Qdrant Document Search
        const searchArgs = { query: cleanGoal, topK: 5 };
        const searchContext = { organizationId: cleanOrgId };
        
        const searchStart = Date.now();
        const searchResult = await executeDocumentSearch(searchArgs, searchContext);
        const searchLatency = Date.now() - searchStart;

        executionEvents.publish(cleanRunId, "step_completed", {
            stepId: "rag_search",
            tool: "document_search",
            status: "completed",
            message: `Found ${searchResult.totalResults} relevant chunks.`,
            latencyMs: searchLatency
        });

        if (searchResult.totalResults === 0) {
            const noResultsAnswer = "The available internal documents do not provide enough information to answer this.";
            executionEvents.publish(cleanRunId, "run_completed", {
                runId: cleanRunId,
                status: "completed",
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
            });
            await saveRunStatus(cleanRunId, "completed", noResultsAnswer);
            return buildFinalResult(cleanRunId, cleanGoal, noResultsAnswer, "completed", startTime, []);
        }

        // 3. Build Prompt & Synthesize
        executionEvents.publish(cleanRunId, "step_started", {
            stepId: "rag_synthesis",
            tool: "synthesis",
            status: "in_progress",
            message: "Generating grounded answer",
        });

        const contextString = searchResult.results.map((c, i) => 
            `[Document ${i + 1} | ${c.filename} | Page ${c.page}]\n${c.text}`
        ).join("\n\n");

        const synthesisPrompt = `You are SovereignAI, an industrial AI assistant.
Answer the user's question clearly and accurately using ONLY the provided internal document sources.
If the sources do not contain the answer, state that you do not know based on the available documents.
Do not fabricate information.

User Question: ${cleanGoal}

SOURCES:
${contextString}

Provide a structured, paragraph-based answer. Use Markdown headings. Synthesize actual retrieved evidence. DO NOT use placeholders like '[Insert relevant excerpt]'. List the source documents at the bottom.`;

        const llmStart = Date.now();
        const llmResponse = await generateAnswer(synthesisPrompt, model, { format: "text" });
        const llmLatency = Date.now() - llmStart;

        executionEvents.publish(cleanRunId, "step_completed", {
            stepId: "rag_synthesis",
            tool: "synthesis",
            status: "completed",
            message: "Completed",
            latencyMs: llmLatency
        });

        executionEvents.publish(cleanRunId, "run_completed", {
            runId: cleanRunId,
            status: "completed",
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
        });

        await saveRunStatus(cleanRunId, "completed", llmResponse);
        return buildFinalResult(cleanRunId, cleanGoal, llmResponse, "completed", startTime, searchResult.results);

    } catch (err) {
        console.error("[FastRAG] Execution error:", err);
        
        const isTimeout = err.code === "LOCAL_RUNTIME_TIMEOUT";
        const stoppedReason = isTimeout ? "timeout" : "error";
        
        executionEvents.publish(cleanRunId, "run_completed", {
            runId: cleanRunId,
            status: "failed",
            error: err.message,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
        });
        
        const errorMessage = `Agent encountered an error: ${err.message}`;
        await saveRunStatus(cleanRunId, "failed", errorMessage, stoppedReason, err.message);
        return buildFinalResult(cleanRunId, cleanGoal, errorMessage, stoppedReason, startTime, []);
    }
}

async function saveRunStatus(runId, status, finalAnswer, stoppedReason = "completed", errorMsg = null) {
    try {
        await updateAgentRun(runId, {
            status,
            stoppedReason,
            finalAnswer,
            error: errorMsg,
            completedAt: new Date()
        });
    } catch (dbErr) {
        console.warn("[FastRAG] DB update failed:", dbErr.message);
    }
}

function buildFinalResult(runId, goal, finalAnswer, status, startTime, sources) {
    const stepHistory = [];
    if (sources.length > 0) {
        stepHistory.push({
            tool: "document_search",
            resultSummary: `Found ${sources.length} chunks`,
            actionTimestamp: startTime
        });
    }
    
    return {
        runId,
        goal,
        status: status === "timeout" ? "failed" : status,
        stoppedReason: status === "completed" ? "completed" : status,
        totalSteps: sources.length > 0 ? 1 : 0,
        durationMs: Date.now() - startTime,
        finalAnswer,
        stepHistory,
        error: status !== "completed" ? "Fast RAG failed" : null,
    };
}
