import { post, get } from "./client.js";

/**
 * AUTH API
 * Client methods for authentication and user identity endpoints.
 */

/**
 * Register a new user account.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.organizationName]
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function registerApi({ name, email, password, organizationName }) {
  const res = await post("/api/v1/auth/register", {
    name,
    email,
    password,
    organizationName,
  });
  return res.data;
}

/**
 * Authenticate user credentials and retrieve a signed JWT.
 *
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function loginApi({ email, password }) {
  const res = await post("/api/v1/auth/login", {
    email,
    password,
  });
  return res.data;
}

/**
 * Retrieve the currently authenticated user's profile.
 *
 * @returns {Promise<object>}
 */
export async function getMeApi() {
  const res = await get("/api/v1/auth/me");
  return res.data;
}
