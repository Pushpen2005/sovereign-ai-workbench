import { answerQuestion } from "../../../ai-service/rag/rag.service.js";


export async function askQuestion(req, res, next) {
  try {
    const { question, documentId } = req.body || {};

    if (
      typeof question !== "string" ||
      !question.trim()
    ) {
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

    const result = await answerQuestion(
      question.trim(),
      {
        documentId: documentId?.trim() || null,
      }
    );

    return res.status(200).json({
      success: true,
      question: question.trim(),
      documentId: documentId?.trim() || null,
      answer: result.answer,
      sources: result.sources || [],
    });
  } catch (error) {
    next(error);
  }
}