import { query } from "../config/db.js";

/**
 * User Repository
 * Handles all PostgreSQL interactions for the users and organizations tables.
 */

/**
 * Finds a user by email address (case-insensitive).
 *
 * @param {string} email
 * @returns {Promise<object|null>} User row or null
 */
export async function findUserByEmail(email) {
  if (!email || typeof email !== "string") return null;

  const sql = `
    SELECT id, organization_id, name, email, password_hash, role, created_at, updated_at
    FROM users
    WHERE lower(email) = lower($1)
    LIMIT 1;
  `;

  const res = await query(sql, [email.trim()]);
  return res.rows[0] || null;
}

/**
 * Finds a user by ID.
 *
 * @param {string} id
 * @returns {Promise<object|null>} User row or null
 */
export async function findUserById(id) {
  if (!id || typeof id !== "string") return null;

  const sql = `
    SELECT id, organization_id, name, email, password_hash, role, created_at, updated_at
    FROM users
    WHERE id = $1
    LIMIT 1;
  `;

  const res = await query(sql, [id.trim()]);
  return res.rows[0] || null;
}

/**
 * Creates a new user record.
 *
 * @param {object} params
 * @returns {Promise<object>} Created user row
 */
export async function createUser({
  id,
  organizationId,
  name,
  email,
  passwordHash,
  role = "member",
}) {
  const sql = `
    INSERT INTO users (
      id,
      organization_id,
      name,
      email,
      password_hash,
      role,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, lower($4), $5, $6, NOW(), NOW())
    RETURNING id, organization_id, name, email, role, created_at, updated_at;
  `;

  const values = [
    id,
    organizationId,
    name.trim(),
    email.trim(),
    passwordHash,
    role,
  ];

  const res = await query(sql, values);
  return res.rows[0];
}

/**
 * Finds an organization by ID.
 *
 * @param {string} id
 * @returns {Promise<object|null>} Organization row or null
 */
export async function findOrganizationById(id) {
  if (!id || typeof id !== "string") return null;

  const sql = `
    SELECT id, name, created_at, updated_at
    FROM organizations
    WHERE id = $1
    LIMIT 1;
  `;

  const res = await query(sql, [id.trim()]);
  return res.rows[0] || null;
}

/**
 * Finds an organization by name (case-insensitive).
 *
 * @param {string} name
 * @returns {Promise<object|null>} Organization row or null
 */
export async function findOrganizationByName(name) {
  if (!name || typeof name !== "string") return null;

  const sql = `
    SELECT id, name, created_at, updated_at
    FROM organizations
    WHERE lower(name) = lower($1)
    LIMIT 1;
  `;

  const res = await query(sql, [name.trim()]);
  return res.rows[0] || null;
}

/**
 * Creates or updates an organization record.
 *
 * @param {object} params
 * @returns {Promise<object>} Organization row
 */
export async function createOrganization({ id, name }) {
  const sql = `
    INSERT INTO organizations (id, name, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = NOW()
    RETURNING id, name, created_at, updated_at;
  `;

  const res = await query(sql, [id.trim(), name.trim()]);
  return res.rows[0];
}

/**
 * Lists all users for an organization.
 *
 * @param {string} organizationId
 * @returns {Promise<Array<object>>} Safe user list
 */
export async function listUsersByOrganization(organizationId) {
  const sql = `
    SELECT id, organization_id, name, email, role, created_at
    FROM users
    WHERE organization_id = $1
    ORDER BY created_at ASC;
  `;

  const res = await query(sql, [organizationId]);
  return res.rows;
}
