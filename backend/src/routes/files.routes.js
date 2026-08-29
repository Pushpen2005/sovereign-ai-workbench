import express from "express";
import upload from "../middleware/upload.middleware.js";
import path from "path";

const router = express.Router();

const uploadInspection = (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "Document file is required",
    });
  }

  const documentId = path.basename(
    req.file.filename,
    path.extname(req.file.filename)
  );

  return res.status(200).json({
    success: true,
    documentId,
    filename: req.file.filename,
  });
};

// Existing endpoint — keep it working
router.post(
  "/upload",
  upload.single("document"),
  uploadInspection
);

// New inspection endpoint
router.post(
  "/inspection/upload",
  upload.single("document"),
  uploadInspection
);

export default router;