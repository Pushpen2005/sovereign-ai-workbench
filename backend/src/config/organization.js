export const DEFAULT_ORGANIZATION_ID =
  process.env.DEFAULT_ORGANIZATION_ID || "0bd5dba2-05e1-4f5c-9047-25843d338622";

export const DEFAULT_ORGANIZATION_NAME =
  process.env.DEFAULT_ORGANIZATION_NAME || "Demo Organization";

/**
 * Resolves the organization ID authoritatively from the authenticated user context.
 *
 * Rules:
 * 1. Requires valid authenticated req.user (401 if missing)
 * 2. Requires non-empty req.user.organizationId (403 if missing)
 * 3. Rejects any conflicting x-organization-id header (403 if mismatch)
 * 4. Ignores any client body.organizationId or query.organizationId
 *
 * @param {object} req - Express request object
 * @returns {string} Authenticated organization ID
 */
export function resolveAuthenticatedOrganization(req) {
  if (!req?.user || (!req.user.id && !req.user.userId && !req.user.sub)) {
    const error = new Error("Authentication required: missing authenticated user context");
    error.status = 401;
    error.statusCode = 401;
    throw error;
  }

  const orgId = req.user.organizationId;
  if (!orgId || typeof orgId !== "string" || !orgId.trim()) {
    const error = new Error("Forbidden: authenticated user has no valid organization context");
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }

  const trimmed = orgId.trim();

  // Defensive header check: if x-organization-id header is supplied, it MUST match the authenticated token
  const headerOrgId = req.headers?.["x-organization-id"];
  if (typeof headerOrgId === "string" && headerOrgId.trim() && headerOrgId.trim() !== trimmed) {
    const error = new Error("Forbidden: x-organization-id header does not match authenticated organization context");
    error.status = 403;
    error.statusCode = 403;
    throw error;
  }

  return trimmed;
}

/**
 * Canonical organization resolution for API handlers.
 * Enforces authenticated tenant identity and rejects unauthenticated fallback.
 *
 * @param {object} req - Express request object
 * @returns {string} Authenticated organization ID
 */
export function resolveOrganizationId(req) {
  return resolveAuthenticatedOrganization(req);
}
