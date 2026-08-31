import {
  createConversation,
  findConversationById,
  findConversationsByOrganizationId,
  updateConversationTimestamp,
  createMessage,
  findMessagesByConversationId,
  countQueriesByOrganizationId,
  countConversationsByOrganizationId,
} from "../repositories/chat.repository.js";

/**
 * Chat Service
 * Handles business logic for conversation lifecycle, message persistence, and stats.
 */

/**
 * Ensures a valid conversation exists for the organization or creates a new one.
 * @param {object} params
 * @param {string|null} [params.conversationId]
 * @param {string} params.organizationId
 * @param {string} params.question
 * @returns {Promise<object>} conversation record
 */
export async function getOrCreateConversation({
  conversationId,
  organizationId,
  question,
}) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required");
  }

  if (conversationId && typeof conversationId === "string") {
    const existing = await findConversationById(conversationId, organizationId);
    if (!existing) {
      const error = new Error(`Conversation '${conversationId}' not found`);
      error.status = 404;
      throw error;
    }
    return existing;
  }

  // Create new conversation with deterministic title from first question
  const trimmed = question?.trim() || "New Chat";
  const title = trimmed.length > 50 ? `${trimmed.slice(0, 47)}…` : trimmed;

  return createConversation({
    organizationId,
    title,
  });
}

/**
 * Persist user question and assistant answer in transaction-like sequence.
 * @param {object} params
 * @returns {Promise<{ userMessage: object, assistantMessage: object }>}
 */
export async function saveChatExchange({
  conversationId,
  organizationId,
  question,
  answer,
  sources = [],
  documentId = null,
}) {
  const userMessage = await createMessage({
    conversationId,
    role: "user",
    content: question,
    documentId: documentId || null,
  });

  const assistantMessage = await createMessage({
    conversationId,
    role: "assistant",
    content: answer,
    sources: sources || [],
    documentId: documentId || null,
  });

  // Touch conversation updated_at
  await updateConversationTimestamp(conversationId, organizationId);

  return { userMessage, assistantMessage };
}

/**
 * Get all conversations for an organization.
 * @param {string} organizationId
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function listConversations(organizationId, options = {}) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required");
  }

  return findConversationsByOrganizationId(organizationId, options);
}

/**
 * Retrieve messages for a given conversation, verifying organization ownership.
 * @param {string} conversationId
 * @param {string} organizationId
 * @returns {Promise<{ conversation: object, messages: Array<object> }>}
 */
export async function getConversationWithMessages(conversationId, organizationId) {
  if (!conversationId || typeof conversationId !== "string") {
    const error = new Error("conversationId is required");
    error.status = 400;
    throw error;
  }
  if (!organizationId || typeof organizationId !== "string") {
    const error = new Error("organizationId is required");
    error.status = 400;
    throw error;
  }

  const conversation = await findConversationById(conversationId, organizationId);
  if (!conversation) {
    const error = new Error(`Conversation '${conversationId}' not found`);
    error.status = 404;
    throw error;
  }

  const messages = await findMessagesByConversationId(conversationId);

  return { conversation, messages };
}

/**
 * Retrieve chat query and conversation counts for an organization.
 * @param {string} organizationId
 * @returns {Promise<{ queries: number, conversations: number }>}
 */
export async function getChatStats(organizationId) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required");
  }

  const [queries, conversations] = await Promise.all([
    countQueriesByOrganizationId(organizationId),
    countConversationsByOrganizationId(organizationId),
  ]);

  return { queries, conversations };
}
