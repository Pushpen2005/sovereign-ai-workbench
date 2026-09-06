import {
  getAllDocuments,
  getDocumentById,
  processAndIngestDocument,
  getDocumentDownloadPath,
  getDocumentDownloadPathByFilename,
  deleteDocumentById,
} from "../services/documents.service.js";
import { resolveAuthenticatedOrganization } from "../config/organization.js";

/**
 * Documents Controller
 * Thin controller mapping HTTP requests to Documents Service.
 */

export async function getDocuments(req, res, next) {
  try {
    const organizationId = resolveAuthenticatedOrganization(req);
    const { documentType } = req.query;

    if (documentType !== undefined && documentType !== null && String(documentType).trim() !== "") {
      const ALLOWED_DOCUMENT_TYPES = ["sop", "inspection", "other"];
      const lower = String(documentType).trim().toLowerCase();
      if (!ALLOWED_DOCUMENT_TYPES.includes(lower)) {
        return res.status(400).json({
          success: false,
          message: `Invalid documentType '${documentType}'. Allowed values: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`,
        });
      }
    }

    const documents = await getAllDocuments(organizationId, documentType);
    return res.status(200).json({
      success: true,
      documents,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDocument(req, res, next) {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      return res.status(400).json({
        success: false,
        message: "Document ID is required",
      });
    }

    const organizationId = resolveAuthenticatedOrganization(req);
    const document = await getDocumentById(id, organizationId);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: `Document with ID '${id}' not found`,
      });
    }

    return res.status(200).json({
      success: true,
      document,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadDocument(req, res, next) {
  try {
    if (!req.file && (!req.body || (!req.body.documentId && !req.body.filePath))) {
      return res.status(400).json({
        success: false,
        message: "Document file or document reference is required",
      });
    }

    const ALLOWED_DOCUMENT_TYPES = ["sop", "inspection", "other"];
    let rawDocumentType = req.body?.documentType;
    let normalizedDocumentType = "inspection"; // Safe backward-compatible default if omitted

    if (rawDocumentType !== undefined && rawDocumentType !== null && String(rawDocumentType).trim() !== "") {
      const lower = String(rawDocumentType).trim().toLowerCase();
      if (!ALLOWED_DOCUMENT_TYPES.includes(lower)) {
        return res.status(400).json({
          success: false,
          message: `Invalid documentType '${rawDocumentType}'. Allowed values: ${ALLOWED_DOCUMENT_TYPES.join(", ")}`,
        });
      }
      normalizedDocumentType = lower;
    }

    const organizationId = resolveAuthenticatedOrganization(req);
    const target = req.file || req.body;
    const options = {
      organizationId,
      documentId: req.body?.documentId,
      filename: req.body?.filename,
      originalFilename: req.file?.originalname || req.body?.originalFilename || req.body?.filename,
      documentType: normalizedDocumentType,
    };

    const result = await processAndIngestDocument(target, options);

    return res.status(200).json({
      success: true,
      documentId: result.documentId,
      organizationId: result.organizationId,
      filename: result.filename,
      originalFilename: result.originalFilename,
      documentType: result.documentType || normalizedDocumentType,
      status: result.status,
      chunksStored: result.chunksStored,
      extractionMethod: result.extractionMethod || "pdf-text",
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadDocument(req, res, next) {
  try {
    const { id } = req.params;
    const organizationId = resolveAuthenticatedOrganization(req);

    const { filePath, originalFilename } = await getDocumentDownloadPath(id, organizationId);
    return res.download(filePath, originalFilename);
  } catch (error) {
    next(error);
  }
}

export async function downloadDocumentByFilename(req, res, next) {
  try {
    const { filename } = req.params;
    const organizationId = resolveAuthenticatedOrganization(req);

    const { filePath, originalFilename } = await getDocumentDownloadPathByFilename(filename, organizationId);
    return res.download(filePath, originalFilename);
  } catch (error) {
    next(error);
  }
}

export async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;
    const organizationId = resolveAuthenticatedOrganization(req);

    await deleteDocumentById(id, organizationId);
    return res.status(200).json({
      success: true,
      message: `Document '${id}' deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
}

