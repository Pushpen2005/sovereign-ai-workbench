import express from "express";
import { register, login, getMe } from "../controllers/auth.controller.js";
import { requireAuth, authRateLimiter } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * POST /api/v1/auth/register
 * Register a new user account with hashed credentials.
 */
router.post("/register", authRateLimiter(60000, 30), register);

/**
 * POST /api/v1/auth/login
 * Authenticate with email/password and obtain a signed JWT.
 */
router.post("/login", authRateLimiter(60000, 30), login);

/**
 * GET /api/v1/auth/me
 * Retrieve the current authenticated user's profile and organization.
 */
router.get("/me", requireAuth, getMe);

export default router;
