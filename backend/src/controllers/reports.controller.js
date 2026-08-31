import { resolveOrganizationId } from "../config/organization.js";
import {
  getAllReports,
  getReportById,
  getReportsCount,
} from "../services/reports.service.js";

/**
 * Reports Controller
 * Handles HTTP requests for inspection report history.
 */

/**
 * GET /api/v1/reports
 * Returns list of persisted reports scoped to organization.
 */
export async function getReports(req, res, next) {
  try {
    const organizationId = resolveOrganizationId(req);
    const limit = parseInt(req.query.limit || "50", 10);
    const offset = parseInt(req.query.offset || "0", 10);

    const reports = await getAllReports(organizationId, { limit, offset });
    const total = await getReportsCount(organizationId);

    return res.status(200).json({
      success: true,
      count: reports.length,
      total,
      data: reports,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/reports/:id
 * Returns a specific report by its ID.
 */
export async function getReport(req, res, next) {
  try {
    const { id } = req.params;
    const organizationId = resolveOrganizationId(req);

    const report = await getReportById(id, organizationId);

    return res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
}
