import express from "express";
import { assessRisk } from "../controllers/inspection.controller.js";

const router = express.Router();

router.post("/assess", assessRisk);
router.post("/", assessRisk); // Alias for compatibility if needed

export default router;
