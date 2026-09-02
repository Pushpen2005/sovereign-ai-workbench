/**
 * HOOK LAYER — useChat.js
 *
 * Manages chat messages, persistent conversation lifecycle, and history.
 * Connects directly to backend APIs:
 *   POST /api/v1/chat/ask
 *   GET  /api/v1/chat/history
 *   GET  /api/v1/chat/conversations/:id/messages
 */

import { useState, useCallback, useEffect } from "react";
import {
  askQuestion as askQuestionApi,
  fetchChatHistory,
  fetchConversationMessages,
} from "../api/chat.api.js";

export function useChat(initialDocumentId = null) {
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState(null);
  const [documentId, setDocumentId] = useState(initialDocumentId);

  /**
   * Fetch conversation history from backend on initial mount.
   */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchChatHistory();
      if (res && res.success && Array.isArray(res.data)) {
        setConversations(res.data);
      }
    } catch (err) {
      console.warn("Could not load chat history:", err?.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchChatHistory()
      .then((res) => {
        if (isMounted && res && res.success && Array.isArray(res.data)) {
          setConversations(res.data);
        }
      })
      .catch((err) => {
        console.warn("Could not load chat history:", err?.message);
      })
      .finally(() => {
        if (isMounted) setHistoryLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Switch to a specific existing conversation and restore its messages.
   * @param {string} convId
   */
  const selectConversation = useCallback(async (convId) => {
    if (!convId || convId === activeConversationId) return;

    setActiveConversationId(convId);
    setLoading(true);
    setError(null);

    try {
      const res = await fetchConversationMessages(convId);
      if (res && res.success && Array.isArray(res.data)) {
        const mapped = res.data.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: Array.isArray(m.sources) ? m.sources : [],
          timestamp: m.createdAt,
          documentId: m.documentId,
        }));
        setMessages(mapped);
      } else {
        setMessages([]);
      }
    } catch (err) {
      setError(err?.message || "Failed to load conversation messages.");
    } finally {
      setLoading(false);
    }
  }, [activeConversationId]);

  /**
   * Start a fresh conversation in the UI.
   */
  const startNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  /**
   * Send a question to RAG and persist exchange in active conversation.
   * @param {string} question
   */
  const askQuestion = useCallback(
    async (question) => {
      const trimmedQuestion = question?.trim();
      if (!trimmedQuestion || loading) {
        return;
      }

      setLoading(true);
      setError(null);

      // Optimistic user message in UI
      const tempUserMsgId = `temp-user-${Date.now()}`;
      const tempUserMsg = {
        id: tempUserMsgId,
        role: "user",
        content: trimmedQuestion,
        timestamp: new Date().toISOString(),
        documentId,
      };

      setMessages((prev) => [...prev, tempUserMsg]);

      try {
        const response = await askQuestionApi(
          trimmedQuestion,
          documentId,
          activeConversationId
        );

        const newConvId = response?.conversationId || activeConversationId;
        if (!activeConversationId && newConvId) {
          setActiveConversationId(newConvId);
        }

        const assistantMsg = {
          id: response?.messageId || `msg-assistant-${Date.now()}`,
          role: "assistant",
          content: response?.answer || "I could not generate an answer.",
          sources: response?.sources || [],
          timestamp: new Date().toISOString(),
          documentId,
          taskType: response?.taskType || null,
          selectedModel: response?.selectedModel || null,
          routingReason: response?.routingReason || null,
          isFallback: Boolean(response?.isFallback),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Refresh conversation history list so title and updated timestamp are current
        loadHistory();
      } catch (err) {
        setError(
          err?.message || "An error occurred while asking the question."
        );
      } finally {
        setLoading(false);
      }
    },
    [documentId, activeConversationId, loading, loadHistory]
  );

  return {
    conversations,
    activeConversationId,
    messages,
    loading,
    historyLoading,
    error,
    documentId,
    setDocumentId,
    askQuestion,
    selectConversation,
    startNewChat,
    clearMessages: startNewChat,
    refreshHistory: loadHistory,
  };
}