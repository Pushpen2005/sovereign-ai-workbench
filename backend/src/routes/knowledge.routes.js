import express from "express";
import upload from "../middleware/upload.middleware.js";
import {
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
  searchKnowledge,
  deleteKnowledgeDocument,
  askKnowledgeBase,
} from "../controllers/knowledge.controller.js";

const router = express.Router();

/**
 * GET /api/v1/knowledge
 * List all knowledge base (SOP) documents for authenticated tenant.
 */
router.get("/", listKnowledgeDocuments);

/**
 * POST /api/v1/knowledge
 * Upload and ingest a knowledge base document into PostgreSQL and Qdrant.
 */
router.post("/", upload.single("document"), uploadKnowledgeDocument);

/**
 * POST /api/v1/knowledge/search
 * Interactive semantic search simulator for knowledge base SOPs.
 * Strictly tenant-isolated and scoped to canonical documentType="sop".
 */
router.post("/search", searchKnowledge);

/**
 * DELETE /api/v1/knowledge/:id
 * Delete a knowledge base document, its database record, and its vector embeddings.
 */
router.delete("/:id", deleteKnowledgeDocument);

/**
 * POST /api/v1/knowledge/chat
 * Knowledge Base chat using isolated SOP context.
 */
router.post("/chat", askKnowledgeBase);

export default router;

