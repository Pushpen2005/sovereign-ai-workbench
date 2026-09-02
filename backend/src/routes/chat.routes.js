import express from "express";
import {
  askQuestion,
  getHistory,
  getConversationMessages,
  getStats,
} from "../controllers/chat.controller.js";

const router = express.Router();

router.post("/ask", askQuestion);
router.get("/history", getHistory);
router.get("/conversations/:id/messages", getConversationMessages);
router.get("/stats", getStats);

export default router;