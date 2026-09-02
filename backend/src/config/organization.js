export const DEFAULT_ORGANIZATION_ID =
  process.env.DEFAULT_ORGANIZATION_ID || "0bd5dba2-05e1-4f5c-9047-25843d338622";

export const DEFAULT_ORGANIZATION_NAME =
  process.env.DEFAULT_ORGANIZATION_NAME || "Demo Organization";

/**
 * Resolves the organization ID for a given request.
 * Prioritizes:
 * 1. Authenticated user's organizationId (req.user?.organizationId)
 * 2. Explicit request header (x-organization-id)
 * 3. Explicit request query parameter (req.query?.organizationId)
 * 4. Explicit request body parameter (req.body?.organizationId)
 * 5. Default / configured demo organization ID
 *
 * @param {object} req - Express request object
 * @returns {string} Organization ID
 */
export function resolveOrganizationId(req) {
  if (req?.user?.organizationId && typeof req.user.organizationId === "string") {
    const trimmed = req.user.organizationId.trim();
    if (trimmed) return trimmed;
  }

  const headerOrgId = req?.headers?.["x-organization-id"];
  if (typeof headerOrgId === "string" && headerOrgId.trim()) {
    return headerOrgId.trim();
  }

  const queryOrgId = req?.query?.organizationId;
  if (typeof queryOrgId === "string" && queryOrgId.trim()) {
    return queryOrgId.trim();
  }

  const bodyOrgId = req?.body?.organizationId;
  if (typeof bodyOrgId === "string" && bodyOrgId.trim()) {
    return bodyOrgId.trim();
  }

  return DEFAULT_ORGANIZATION_ID;
}
