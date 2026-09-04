import express from "express";
import upload from "../middleware/upload.middleware.js";
import path from "path";

import fs from "fs";

const router = express.Router();

const uploadInspection = (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "Document file is required",
    });
  }

  // Validate PDF magic bytes (%PDF)
  try {
    const fd = fs.openSync(req.file.path, "r");
    const headerBuf = Buffer.alloc(4);
    fs.readSync(fd, headerBuf, 0, 4, 0);
    fs.closeSync(fd);

    if (headerBuf.toString("utf8") !== "%PDF") {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: "Invalid file format: file does not match valid PDF header signature",
      });
    }
  } catch (readErr) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      message: "Failed to verify uploaded document integrity",
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

/**
 * @deprecated Legacy file upload endpoint. Maintained for backward compatibility.
 * Use canonical POST /api/v1/inspection/upload instead.
 */
router.post(
  "/upload",
  upload.single("document"),
  uploadInspection
);

/**
 * Canonical inspection PDF upload endpoint.
 */
router.post(
  "/inspection/upload",
  upload.single("document"),
  uploadInspection
);

export default router;