import express from "express";
import upload from "../middleware/upload.middleware.js";

const router = express.Router();

router.post(
  "/upload",
  upload.single("document"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Document file is required",
      });
    }

    return res.status(200).json({
      message: "File uploaded successfully",
      file: {
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  }
);

export default router;