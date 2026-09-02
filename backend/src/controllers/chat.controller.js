import { answerQuestion } from "../../../ai-service/rag/rag.service.js";
import { generateAnswer } from "../../../ai-service/llm/llm.service.js";
import { resolveOrganizationId } from "../config/organization.js";
import {
  getOrCreateConversation,
  saveChatExchange,
  listConversations,
  getConversationWithMessages,
  getChatStats,
} from "../services/chat.service.js";
import { routeTask, RouterError } from "../../../ai-service/router/modelRouter.js";

/**
 * POST /api/v1/chat/ask
 *
 * PR #23 — Model Router integrated.
 * Classifies the question (DOCUMENT / CODING / GENERAL), selects the
 * appropriate local Ollama model, executes RAG with that model, and
 * returns routing metadata alongside the existing answer/sources.
 */
export async function askQuestion(req, res, next) {
  try {
    const { question, documentId, conversationId } = req.body || {};

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

    const organizationId = resolveOrganizationId(req);

    // ── PR #23: Route the question to the appropriate local model ────────────
    let routing;
    try {
      routing = await routeTask(question.trim());
    } catch (routerErr) {
      if (routerErr instanceof RouterError) {
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

    let result;
    if (routing.taskType === "CODING" && !documentId) {
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
    } else {
      // 2. Execute RAG pipeline with the router-selected model
      result = await answerQuestion(question.trim(), {
        documentId: documentId?.trim() || undefined,
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

    return res.status(200).json({
      success: true,
      conversationId: conversation.id,
      question: question.trim(),
      documentId: documentId?.trim() || null,
      answer: result.answer,
      sources: result.sources || [],
      messageId: exchange.assistantMessage.id,
      // ── PR #23 routing metadata ─────────────────────────────────────────
      taskType:      routing.taskType,
      selectedModel: routing.selectedModel,
      routingReason: routing.routingReason,
      isFallback:    routing.isFallback,
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
    const organizationId = resolveOrganizationId(req);
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
    const organizationId = resolveOrganizationId(req);

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
    const organizationId = resolveOrganizationId(req);
    const stats = await getChatStats(organizationId);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
}