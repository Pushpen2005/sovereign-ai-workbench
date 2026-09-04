import express from "express";
import upload from "../middleware/upload.middleware.js";
import {
  getDocuments,
  getDocument,
  uploadDocument,
  downloadDocument,
  downloadDocumentByFilename,
  deleteDocument,
} from "../controllers/documents.controller.js";

const router = express.Router();

// GET /api/v1/documents - List all persisted documents
router.get("/", getDocuments);

// GET /api/v1/documents/download/:filename - Download document by filename
router.get("/download/:filename", downloadDocumentByFilename);

// GET /api/v1/documents/:id/download - Download document by ID
router.get("/:id/download", downloadDocument);

// GET /api/v1/documents/:id - Get specific document metadata
router.get("/:id", getDocument);

// POST /api/v1/documents - Upload and ingest document with PostgreSQL tracking
router.post("/", upload.single("document"), uploadDocument);

// DELETE /api/v1/documents/:id - Delete document (physical file, vectors, and DB record)
router.delete("/:id", deleteDocument);

export default router;

