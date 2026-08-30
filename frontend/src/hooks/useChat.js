/**
 * HOOK LAYER — useChat.js
 *
 * Manages chat messages, loading state, and exposes askQuestion().
 * Components use this hook — they never call fetch directly.
 */

import { useState, useCallback } from "react";
import { askQuestion as askQuestionApi } from "../api/chat.api.js";

export function useChat(initialDocumentId = null) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [documentId, setDocumentId] = useState(initialDocumentId);

  const askQuestion = useCallback(
    async (question) => {
      const trimmedQuestion = question?.trim();

      // Validate question
      if (!trimmedQuestion) {
        return;
      }

      setLoading(true);
      setError(null);

      const userMessage = {
        id: `msg-user-${Date.now()}`,
        role: "user",
        content: trimmedQuestion,
        timestamp: new Date().toISOString(),
      };

      // Add user message immediately
      setMessages((prevMessages) => [
        ...prevMessages,
        userMessage,
      ]);

      try {
        const response = await askQuestionApi(
          trimmedQuestion,
          documentId
        );

        const assistantMessage = {
          id: `msg-assistant-${Date.now()}`,
          role: "assistant",
          content:
            response?.answer ||
            "I could not generate an answer.",
          sources: response?.sources ?? [],
          timestamp: new Date().toISOString(),
        };

        setMessages((prevMessages) => [
          ...prevMessages,
          assistantMessage,
        ]);
      } catch (err) {
        setError(
          err?.message ||
            "An error occurred while asking the question."
        );
      } finally {
        setLoading(false);
      }
    },
    [documentId]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    loading,
    error,
    documentId,
    setDocumentId,
    askQuestion,
    clearMessages,
  };
}