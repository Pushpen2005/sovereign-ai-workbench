import express from "express";
import upload from "../middleware/upload.middleware.js";
import {
  getDocuments,
  getDocument,
  uploadDocument,
} from "../controllers/documents.controller.js";

const router = express.Router();

// GET /api/v1/documents - List all persisted documents
router.get("/", getDocuments);

// GET /api/v1/documents/:id - Get specific document metadata
router.get("/:id", getDocument);

// POST /api/v1/documents - Upload and ingest document with PostgreSQL tracking
router.post("/", upload.single("document"), uploadDocument);

export default router;
