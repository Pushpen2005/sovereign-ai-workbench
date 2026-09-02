import express from "express";
import { getReports, getReport } from "../controllers/reports.controller.js";

const router = express.Router();

router.get("/", getReports);
router.get("/:id", getReport);

export default router;
