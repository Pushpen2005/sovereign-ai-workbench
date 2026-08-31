import { answerQuestion } from "../../../ai-service/rag/rag.service.js";
import { resolveOrganizationId } from "../config/organization.js";
import {
  getOrCreateConversation,
  saveChatExchange,
  listConversations,
  getConversationWithMessages,
  getChatStats,
} from "../services/chat.service.js";

/**
 * POST /api/v1/chat/ask
 * Ask a question against the indexed document corpus with automatic PostgreSQL conversation persistence.
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

    // 1. Resolve or create persistent conversation
    const conversation = await getOrCreateConversation({
      conversationId: conversationId?.trim() || null,
      organizationId,
      question: question.trim(),
    });

    // 2. Execute existing RAG pipeline
    const result = await answerQuestion(question.trim(), {
      documentId: documentId?.trim() || undefined,
    });

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