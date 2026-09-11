import { answerQuestion } from "../../../ai-service/rag/rag.service.js";
import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";
import { query } from "../config/db.js";
import {
  getOrCreateConversation,
  saveChatExchange,
  listConversations,
  getConversationWithMessages,
  getChatStats,
} from "../services/chat.service.js";
import { checkDocumentsGate } from "../services/documents-gate.service.js";
import { routeTask, RouterError, isModelAllowed } from "../../../ai-service/router/modelRouter.js";
import { telemetryService } from "../services/telemetry.service.js";

/**
 * POST /api/v1/chat/ask
 *
 * PR #23 — Model Router integrated.
 * Classifies the question (DOCUMENT / CODING / GENERAL), selects the
 * appropriate local MLX model, executes RAG with that model, and
 * returns routing metadata alongside the existing answer/sources.
 */
export async function askQuestion(req, res, next) {
  try {
    const { question, documentId, conversationId, model } = req.body || {};

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        success: false,
        message: "Valid question is required",
      });
    }

    if (
      documentId !== undefined &&
      documentId !== null &&
      (typeof documentId !== "string" || !documentId.trim())
    ) {
      return res.status(400).json({
        success: false,
        message: "documentId must be a valid string",
      });
    }

    // Enforce sovereign model allowlist
    if (model) {
      if (!isModelAllowed(model)) {
        return res.status(400).json({
          success: false,
          message: `Model '${model}' is not in the sovereign model allowlist.`,
        });
      }
    }

    const organizationId = resolveAuthenticatedOrganization(req);

    // ── Authoritative Documents Gate & Scoping ───────────────────────────
    const isGeneralChatMode = (mode === "GENERAL_CHAT" || mode === "general");
    let allowedDocumentIds = undefined;

    if (!isGeneralChatMode) {
      const gate = await checkDocumentsGate(organizationId, documentId);

      if (gate.forbidden) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: document belongs to another organization",
        });
      }

      if (!gate.available) {
        const NO_DOC_ANSWER = "No uploaded document is currently available for this AI Search query.";

        // Resolve or create persistent conversation
        const conversation = await getOrCreateConversation({
          conversationId: conversationId?.trim() || null,
          organizationId,
          question: question.trim(),
        });

        const exchange = await saveChatExchange({
          conversationId: conversation.id,
          organizationId,
          question: question.trim(),
          answer: NO_DOC_ANSWER,
          sources: [],
          documentId: documentId?.trim() || null,
        });

        telemetryService.recordAiExecution({
          runId: conversation.id,
          organizationId,
          taskType: "DOCUMENT_ANALYSIS",
          selectedModel: "gemma-2-2b-it-4bit",
          local: true,
          status: "completed",
          totalLatencyMs: 0,
          modelLatencyMs: 0,
          retrievalLatencyMs: 0,
        });

        const isStream = Boolean(
          req.query.stream === "true" ||
          req.body?.stream === true ||
          req.headers.accept === "text/event-stream"
        );

        if (isStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          });
          res.flushHeaders?.();

          res.write(`event: metadata\ndata: ${JSON.stringify({
            taskType: "DOCUMENT_ANALYSIS",
            selectedModel: "gemma-2-2b-it-4bit",
            provider: "MLX",
            runtime: "MLX :8080",
            local: true,
            isFallback: false,
          })}\n\n`);

          res.write(`event: token\ndata: ${JSON.stringify({ token: NO_DOC_ANSWER })}\n\n`);

          res.write(`event: completed\ndata: ${JSON.stringify({
            success: true,
            grounded: false,
            conversationId: conversation.id,
            messageId: exchange.assistantMessage.id,
            answer: NO_DOC_ANSWER,
            reason: "no_documents_available",
            sources: [],
            citations: [],
            citationIntegrity: null,
            claimGrounding: null,
            taskType: "DOCUMENT_ANALYSIS",
            selectedModel: "gemma-2-2b-it-4bit",
            provider: "MLX",
            runtime: "MLX :8080",
            local: true,
            isFallback: false,
            timings: { totalMs: 0 },
          })}\n\n`);

          return res.end();
        }

        return res.status(200).json({
          success: true,
          grounded: false,
          answer: NO_DOC_ANSWER,
          citations: [],
          reason: "no_documents_available",
          conversationId: conversation.id,
          question: question.trim(),
          documentId: documentId?.trim() || null,
          sources: [],
          citationIntegrity: null,
          claimGrounding: null,
          messageId: exchange.assistantMessage.id,
          taskType: "DOCUMENT_ANALYSIS",
          selectedModel: "gemma-2-2b-it-4bit",
          provider: "MLX",
          runtime: "MLX :8080",
          routingReason: "No active documents available in library",
          local: true,
          isFallback: false,
          timings: { totalMs: 0 },
        });
      }

      allowedDocumentIds = gate.allowedDocumentIds;
    }

    // ── PR #23: Route the question to the appropriate local model ────────────
    let routing;
    try {
      routing = await routeTask(question.trim(), { model, documentId: documentId?.trim() });
    } catch (routerErr) {
      if (routerErr instanceof RouterError) {
        if (routerErr.code === "MODEL_NOT_ALLOWED") {
          return res.status(400).json({
            success: false,
            message: routerErr.message,
            code: "MODEL_NOT_ALLOWED",
          });
        }
        return res.status(503).json({
          success: false,
          message: routerErr.message,
          code: "MODEL_UNAVAILABLE",
        });
      }
      throw routerErr;
    }

    // 1. Resolve or create persistent conversation
    const conversation = await getOrCreateConversation({
      conversationId: conversationId?.trim() || null,
      organizationId,
      question: question.trim(),
    });

    const isStream = Boolean(
      req.query.stream === "true" ||
      req.body?.stream === true ||
      req.headers.accept === "text/event-stream"
    );

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      res.write(`event: metadata\ndata: ${JSON.stringify({
        taskType: routing.taskType,
        selectedModel: routing.selectedModel,
        provider: routing.provider || "MLX",
        runtime: routing.runtime || "MLX :8080",
        local: routing.local ?? true,
        isFallback: routing.isFallback,
      })}\n\n`);

      const onChunk = (chunk) => {
        try {
          res.write(`event: token\ndata: ${JSON.stringify({ token: chunk })}\n\n`);
        } catch {}
      };

      let result;
      if (routing.taskType === "CODING" && !documentId && isGeneralChatMode) {
        const codingPrompt = `You are a skilled software engineering assistant.
Provide clean, idiomatic, well-commented code that directly addresses the following user request.
Do not require external documents or reference context.

Request:
${question.trim()}`;

        const codeAnswer = await generateAnswer(codingPrompt, routing.selectedModel, { onChunk, stream: true });
        result = {
          answer: codeAnswer,
          sources: [],
          grounded: true,
        };
      } else if (isGeneralChatMode) {
        const generalPrompt = `You are SovereignAI, a helpful, precise, and sovereign AI assistant.
Answer the user's question clearly and concisely.

Question:
${question.trim()}

Answer:`;
        const generalAnswer = await generateAnswer(generalPrompt, routing.selectedModel, { onChunk, stream: true });
        result = {
          answer: generalAnswer,
          sources: [],
          grounded: false,
        };
      } else {
        result = await answerQuestion(question.trim(), {
          documentId: documentId?.trim() || undefined,
          allowedDocumentIds,
          organizationId,
          model: routing.selectedModel,
          onChunk,
          stream: true,
        });
      }

      const exchange = await saveChatExchange({
        conversationId: conversation.id,
        organizationId,
        question: question.trim(),
        answer: result.answer,
        sources: result.sources || [],
        documentId: documentId?.trim() || null,
      });

      telemetryService.recordAiExecution({
        runId: conversation.id,
        organizationId,
        taskType: routing.taskType,
        selectedModel: routing.selectedModel,
        local: routing.local ?? true,
        status: "completed",
        totalLatencyMs: result.timings?.totalMs || 0,
        modelLatencyMs: result.timings?.generationMs || 0,
        retrievalLatencyMs: result.timings?.searchMs || 0,
      });

      res.write(`event: completed\ndata: ${JSON.stringify({
        success: true,
        conversationId: conversation.id,
        messageId: exchange.assistantMessage.id,
        answer: result.answer,
        grounded: result.grounded !== undefined ? result.grounded : (result.sources?.length > 0),
        reason: result.reason || null,
        sources: result.sources || [],
        citations: result.citations || result.sources || [],
        citationIntegrity: result.citationIntegrity || null,
        claimGrounding: result.claimGrounding || null,
        taskType: routing.taskType,
        selectedModel: routing.selectedModel,
        provider: routing.provider || "MLX",
        runtime: routing.runtime || "MLX :8080",
        local: routing.local ?? true,
        timings: result.timings || null,
      })}\n\n`);

      return res.end();
    }

    let result;
    if (routing.taskType === "CODING" && !documentId && isGeneralChatMode) {
      // Direct code generation using the routed coding model (no document retrieval required)
      const codingPrompt = `You are a skilled software engineering assistant.
Provide clean, idiomatic, well-commented code that directly addresses the following user request.
Do not require external documents or reference context.

Request:
${question.trim()}`;

      const codeAnswer = await generateAnswer(codingPrompt, routing.selectedModel);
      result = {
        answer: codeAnswer,
        sources: [],
      };
    } else if (isGeneralChatMode) {
      const generalPrompt = `You are SovereignAI, a helpful, precise, and sovereign AI assistant.
Answer the user's question clearly and concisely.

Question:
${question.trim()}

Answer:`;
      const generalAnswer = await generateAnswer(generalPrompt, routing.selectedModel);
      result = {
        answer: generalAnswer,
        sources: [],
        grounded: false,
      };
    } else {
      // 2. Execute RAG pipeline with the router-selected model
      result = await answerQuestion(question.trim(), {
        documentId: documentId?.trim() || undefined,
        allowedDocumentIds,
        organizationId,
        model: routing.selectedModel,
      });
    }

    // 3. Persist user and assistant exchange
    const exchange = await saveChatExchange({
      conversationId: conversation.id,
      organizationId,
      question: question.trim(),
      answer: result.answer,
      sources: result.sources || [],
      documentId: documentId?.trim() || null,
    });

    telemetryService.recordAiExecution({
      runId: conversation.id,
      organizationId,
      taskType: routing.taskType,
      selectedModel: routing.selectedModel,
      local: routing.local ?? true,
      status: "completed",
      totalLatencyMs: result.timings?.totalMs || 0,
      modelLatencyMs: result.timings?.generationMs || 0,
      retrievalLatencyMs: result.timings?.searchMs || 0,
    });

    return res.status(200).json({
      success: true,
      conversationId: conversation.id,
      question: question.trim(),
      documentId: documentId?.trim() || null,
      answer: result.answer,
      grounded: result.grounded !== undefined ? result.grounded : ((result.sources && result.sources.length > 0) ? true : false),
      reason: result.reason || null,
      sources: result.sources || [],
      citations: result.citations || result.sources || [],
      citationIntegrity: result.citationIntegrity || null,
      claimGrounding: result.claimGrounding || null,
      messageId: exchange.assistantMessage.id,
      // ── PR #23 / Phase 8 routing metadata ──────────────────────────────
      taskType:      routing.taskType,
      selectedModel: routing.selectedModel,
      provider:      routing.provider || "MLX",
      runtime:       routing.runtime || "MLX :8080",
      routingReason: routing.routingReason,
      local:         routing.local ?? true,
      isFallback:    routing.isFallback,
      timings:       result.timings || null,
    });
  } catch (error) {
    next(error);
  }
}


/**
 * GET /api/v1/chat/history
 * List all conversations for the active organization.
 */
export async function getHistory(req, res, next) {
  try {
    const organizationId = resolveAuthenticatedOrganization(req);
    const limit = parseInt(req.query.limit || "50", 10);
    const offset = parseInt(req.query.offset || "0", 10);

    const conversations = await listConversations(organizationId, { limit, offset });

    return res.status(200).json({
      success: true,
      count: conversations.length,
      data: conversations,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/chat/conversations/:id/messages
 * Retrieve messages for a specific conversation in chronological order.
 */
export async function getConversationMessages(req, res, next) {
  try {
    const { id } = req.params;
    const organizationId = resolveAuthenticatedOrganization(req);

    const result = await getConversationWithMessages(id, organizationId);

    return res.status(200).json({
      success: true,
      conversation: result.conversation,
      data: result.messages,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/chat/stats
 * Return query and conversation counts for the organization.
 */
export async function getStats(req, res, next) {
  try {
    const organizationId = resolveAuthenticatedOrganization(req);
    const stats = await getChatStats(organizationId);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}