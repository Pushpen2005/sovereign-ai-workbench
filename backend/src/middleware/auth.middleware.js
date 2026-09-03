import { verifyToken } from "../utils/auth.js";
import { logAuthEvent } from "../services/auth.service.js";

/**
 * Authentication Middleware
 * Enforces JWT verification and multi-tenant authorization boundaries.
 */

/**
 * Strict authentication middleware. Requires a valid Bearer JWT.
 * Validates that any supplied x-organization-id header matches the JWT tenant.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader || typeof authHeader !== "string") {
    logAuthEvent("AUTH_FAILURE", { reason: "missing_authorization_header" });
    return res.status(401).json({
      success: false,
      message: "Authorization header with Bearer token is required",
    });
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1].trim()) {
    logAuthEvent("AUTH_FAILURE", { reason: "malformed_authorization_header" });
    return res.status(401).json({
      success: false,
      message: "Malformed authorization header. Expected format: Bearer <token>",
    });
  }

  const token = parts[1].trim();
  const payload = verifyToken(token);

  if (!payload || (!payload.sub && !payload.userId)) {
    logAuthEvent("AUTH_FAILURE", { reason: "invalid_or_expired_token" });
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authorization token",
    });
  }

  const user = {
    id: payload.userId || payload.sub,
    email: payload.email,
    organizationId: payload.organizationId,
    role: payload.role || "member",
  };

  // Enforce tenant isolation against spoofing attempts
  const headerOrgId = req.headers["x-organization-id"];
  if (typeof headerOrgId === "string" && headerOrgId.trim()) {
    if (headerOrgId.trim() !== user.organizationId) {
      logAuthEvent("FORBIDDEN_ACCESS", {
        userId: user.id,
        organizationId: user.organizationId,
        reason: "cross_organization_header_attempt",
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden: x-organization-id header does not match authenticated organization context",
      });
    }
  }

  req.user = user;
  next();
}

/**
 * Optional authentication middleware.
 * If an Authorization header is present, validates it and attaches req.user.
 * If header is absent, proceeds cleanly to support legacy/demo workflows.
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader) {
    return next();
  }

  const parts = authHeader.trim().split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1].trim()) {
    return res.status(401).json({
      success: false,
      message: "Malformed authorization header. Expected format: Bearer <token>",
    });
  }

  const token = parts[1].trim();
  const payload = verifyToken(token);

  if (!payload || (!payload.sub && !payload.userId)) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authorization token",
    });
  }

  const user = {
    id: payload.userId || payload.sub,
    email: payload.email,
    organizationId: payload.organizationId,
    role: payload.role || "member",
  };

  const headerOrgId = req.headers["x-organization-id"];
  if (typeof headerOrgId === "string" && headerOrgId.trim()) {
    if (headerOrgId.trim() !== user.organizationId) {
      logAuthEvent("FORBIDDEN_ACCESS", {
        userId: user.id,
        organizationId: user.organizationId,
        reason: "cross_organization_header_attempt",
      });
      return res.status(403).json({
        success: false,
        message: "Forbidden: x-organization-id header does not match authenticated organization context",
      });
    }
  }

  req.user = user;
  next();
}

/**
 * Role-based authorization middleware.
 *
 * @param  {...string} roles Allowed roles (e.g. 'admin', 'auditor')
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      logAuthEvent("FORBIDDEN_ACCESS", {
        userId: req.user.id,
        organizationId: req.user.organizationId,
        reason: `insufficient_role_${req.user.role}`,
      });
      return res.status(403).json({
        success: false,
        message: `Forbidden: role '${req.user.role}' is not authorized for this resource`,
      });
    }

    next();
  };
}

/**
 * Lightweight in-memory rate limiter for authentication endpoints.
 * Window: 1 minute. Max requests: 30 per IP.
 */
const rateLimitMap = new Map();

export function authRateLimiter(windowMs = 60000, maxRequests = 30) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "127.0.0.1";
    const now = Date.now();

    let record = rateLimitMap.get(ip);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimitMap.set(ip, record);
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      logAuthEvent("AUTH_RATE_LIMIT_EXCEEDED", { reason: `ip_${ip}_exceeded_${maxRequests}` });
      return res.status(429).json({
        success: false,
        message: "Too many authentication attempts. Please try again later.",
      });
    }

    next();
  };
}
