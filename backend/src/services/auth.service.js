import { randomUUID } from "node:crypto";
import {
  findUserByEmail,
  findUserById,
  createUser,
  findOrganizationById,
  findOrganizationByName,
  createOrganization,
} from "../repositories/user.repository.js";
import { hashPassword, verifyPassword, generateToken } from "../utils/auth.js";
import { DEFAULT_ORGANIZATION_ID } from "../config/organization.js";

export class AuthError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export class AuthUnauthorizedError extends AuthError {
  constructor(message = "Invalid credentials") {
    super(message, 401);
    this.name = "AuthUnauthorizedError";
  }
}

export class AuthForbiddenError extends AuthError {
  constructor(message = "Access forbidden") {
    super(message, 403);
    this.name = "AuthForbiddenError";
  }
}

export class AuthConflictError extends AuthError {
  constructor(message = "Resource already exists") {
    super(message, 409);
    this.name = "AuthConflictError";
  }
}

/**
 * Structured security audit logging for authentication events.
 * Never logs passwords, hashes, tokens, or confidential material.
 */
export function logAuthEvent(event, { userId = null, organizationId = null, email = null, reason = null } = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    userId: userId || null,
    organizationId: organizationId || null,
    email: email ? email.toLowerCase() : null,
    reason: reason || null,
  };
  console.log(`[AUTH-AUDIT] ${JSON.stringify(entry)}`);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registers a new user with password hashing and organization association.
 */
export async function registerUser({
  name,
  email,
  password,
  organizationId,
  organizationName,
  role = "member",
}) {
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    throw new AuthError("Name must be at least 2 characters long", 400);
  }

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    throw new AuthError("A valid email address is required", 400);
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    throw new AuthError("Password must be at least 6 characters long", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check for duplicate account
  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    logAuthEvent("REGISTER_CONFLICT", { email: normalizedEmail, reason: "duplicate_email" });
    throw new AuthConflictError("An account with this email address already exists");
  }

  // Resolve organization
  let resolvedOrgId = DEFAULT_ORGANIZATION_ID;

  if (organizationId && typeof organizationId === "string" && organizationId.trim()) {
    const org = await findOrganizationById(organizationId.trim());
    if (!org) {
      throw new AuthError("Specified organization does not exist", 400);
    }
    resolvedOrgId = org.id;
  } else if (organizationName && typeof organizationName === "string" && organizationName.trim()) {
    const orgName = organizationName.trim();
    let org = await findOrganizationByName(orgName);
    if (!org) {
      org = await createOrganization({ id: randomUUID(), name: orgName });
    }
    resolvedOrgId = org.id;
  }

  const passwordHash = hashPassword(password);
  const userId = randomUUID();

  const newUser = await createUser({
    id: userId,
    organizationId: resolvedOrgId,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: role || "member",
  });

  const safeUser = {
    id: newUser.id,
    organizationId: newUser.organization_id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    createdAt: newUser.created_at,
  };

  const token = generateToken(safeUser);

  logAuthEvent("REGISTER_SUCCESS", {
    userId: safeUser.id,
    organizationId: safeUser.organizationId,
    email: safeUser.email,
  });

  return { user: safeUser, token };
}

/**
 * Authenticates user credentials and issues a signed JWT.
 */
export async function loginUser({ email, password }) {
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    throw new AuthError("Email and password are required", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(normalizedEmail);

  if (!user) {
    logAuthEvent("LOGIN_FAILURE", { email: normalizedEmail, reason: "user_not_found" });
    throw new AuthUnauthorizedError("Invalid email or password");
  }

  const isValidPassword = verifyPassword(password, user.password_hash);
  if (!isValidPassword) {
    logAuthEvent("LOGIN_FAILURE", {
      userId: user.id,
      email: normalizedEmail,
      reason: "invalid_password",
    });
    throw new AuthUnauthorizedError("Invalid email or password");
  }

  const safeUser = {
    id: user.id,
    organizationId: user.organization_id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };

  const token = generateToken(safeUser);

  logAuthEvent("LOGIN_SUCCESS", {
    userId: safeUser.id,
    organizationId: safeUser.organizationId,
    email: safeUser.email,
  });

  return { user: safeUser, token };
}

/**
 * Retrieves the current authenticated user by ID.
 */
export async function getCurrentUser(userId) {
  if (!userId || typeof userId !== "string") {
    throw new AuthUnauthorizedError("Unauthorized");
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", 404);
  }

  return {
    id: user.id,
    organizationId: user.organization_id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}
