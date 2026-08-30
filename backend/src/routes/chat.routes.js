import express from "express";
import { askQuestion } from "../controllers/chat.controller.js";

const router = express.Router();

// PR #20 — RAG Chat
router.post("/ask", askQuestion);

export default router;