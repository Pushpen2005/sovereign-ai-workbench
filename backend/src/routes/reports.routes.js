import express from "express";
import { getReports, getReport } from "../controllers/reports.controller.js";
import {
  generateApprovalNoteDocx,
  downloadApprovalNote,
} from "../controllers/inspection.controller.js";

const router = express.Router();

router.get("/", getReports);
router.post("/approval-note", generateApprovalNoteDocx);
router.get("/download/:filename", downloadApprovalNote);
router.get("/:id", getReport);

export default router;
