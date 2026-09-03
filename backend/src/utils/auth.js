import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "sovereign-ai-workbench-dev-jwt-secret-key-replace-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Hashes a plaintext password using bcrypt.
 *
 * @param {string} password
 * @returns {string} Hashed password
 */
export function hashPassword(password) {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string");
  }
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters long");
  }
  return bcrypt.hashSync(password, 10);
}

/**
 * Securely verifies a plaintext password against a stored hash.
 * Supports bcrypt ($2b$, $2a$) and legacy scrypt (scrypt$<salt>$<hash>).
 *
 * @param {string} password Plaintext password
 * @param {string} storedHash Stored password hash
 * @returns {boolean} True if password matches
 */
export function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }

  // 1. Standard bcrypt comparison
  if (storedHash.startsWith("$2")) {
    try {
      return bcrypt.compareSync(password, storedHash);
    } catch {
      return false;
    }
  }

  // 2. Legacy scrypt comparison
  if (storedHash.startsWith("scrypt$")) {
    try {
      const parts = storedHash.split("$");
      if (parts.length === 3) {
        const salt = Buffer.from(parts[1], "hex");
        const expectedKey = Buffer.from(parts[2], "hex");
        const derivedKey = crypto.scryptSync(password, salt, expectedKey.length);
        if (derivedKey.length === expectedKey.length) {
          return crypto.timingSafeEqual(derivedKey, expectedKey);
        }
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Generates a signed JSON Web Token containing minimal user identity claims.
 * Never includes passwords or sensitive application data.
 *
 * @param {object} payload User identity fields
 * @param {object} [options] Optional jwt.sign options
 * @returns {string} Signed JWT
 */
export function generateToken(payload, options = {}) {
  const safePayload = {
    sub: payload.id || payload.sub,
    userId: payload.id || payload.userId || payload.sub,
    email: payload.email,
    organizationId: payload.organizationId,
    role: payload.role || "member",
  };

  const expiresIn = options.expiresIn || JWT_EXPIRES_IN;

  return jwt.sign(safePayload, JWT_SECRET, {
    expiresIn,
    algorithm: "HS256",
  });
}

/**
 * Verifies and decodes a JSON Web Token.
 *
 * @param {string} token JWT string
 * @returns {object|null} Decoded payload or null if invalid/expired
 */
export function verifyToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    return null;
  }
}
