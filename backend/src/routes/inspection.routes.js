import express from "express";
import upload from "../middleware/upload.middleware.js";

const router = express.Router();

router.post(
  "/ingest",
  upload.single("document")
);

export default router;