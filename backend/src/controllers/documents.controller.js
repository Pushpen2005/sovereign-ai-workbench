import {
  getAllDocuments,
  getDocumentById,
  processAndIngestDocument,
} from "../services/documents.service.js";

/**
 * Documents Controller
 * Thin controller mapping HTTP requests to Documents Service.
 */

export async function getDocuments(req, res, next) {
  try {
    const documents = await getAllDocuments();
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

    const document = await getDocumentById(id);
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

    const target = req.file || req.body;
    const options = {
      documentId: req.body?.documentId,
      filename: req.body?.filename,
      originalFilename: req.file?.originalname || req.body?.originalFilename || req.body?.filename,
    };

    const result = await processAndIngestDocument(target, options);

    return res.status(200).json({
      success: true,
      documentId: result.documentId,
      filename: result.filename,
      originalFilename: result.originalFilename,
      status: result.status,
      chunksStored: result.chunksStored,
    });
  } catch (error) {
    next(error);
  }
}
