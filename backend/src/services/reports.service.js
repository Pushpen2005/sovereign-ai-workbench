import {
  createReport,
  findReportsByOrganizationId,
  findReportById,
  countReportsByOrganizationId,
} from "../repositories/reports.repository.js";

/**
 * Reports Service
 * Encapsulates business logic for report persistence, organization scoping, and listing.
 */

/**
 * Persist a newly generated report in PostgreSQL.
 * @param {object} params
 * @param {string} [params.documentId]
 * @param {string} params.organizationId
 * @param {string} [params.title]
 * @param {string} params.filename
 * @param {string|null} [params.riskLevel]
 * @param {string} [params.status]
 * @param {string} [params.task]
 * @returns {Promise<object>}
 */
export async function createReportRecord(params) {
  if (!params.organizationId || typeof params.organizationId !== "string") {
    throw new Error("organizationId is required to persist report");
  }

  if (!params.filename || typeof params.filename !== "string") {
    throw new Error("filename is required to persist report");
  }

  return createReport(params);
}

/**
 * Get all reports scoped to the given organization.
 * @param {string} organizationId
 * @param {object} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getAllReports(organizationId, options = {}) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required to retrieve reports");
  }

  return findReportsByOrganizationId(organizationId, options);
}

/**
 * Retrieve a specific report by ID within an organization.
 * @param {string} id
 * @param {string} organizationId
 * @returns {Promise<object>}
 */
export async function getReportById(id, organizationId) {
  if (!id || typeof id !== "string") {
    throw new Error("report id is required");
  }
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required");
  }

  const report = await findReportById(id, organizationId);
  if (!report) {
    const error = new Error(`Report '${id}' not found`);
    error.status = 404;
    throw error;
  }

  return report;
}

/**
 * Get total report count for an organization.
 * @param {string} organizationId
 * @returns {Promise<number>}
 */
export async function getReportsCount(organizationId) {
  if (!organizationId || typeof organizationId !== "string") {
    throw new Error("organizationId is required");
  }

  return countReportsByOrganizationId(organizationId);
}
