import path from "path";
import {answerQuestion} from "../../ai-service/rag/rag.service.js";
import {analyzeInspectionReport} from "../../ai-service/inspection/inspection.service.js";
export async function ingestInspection(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Document file is required",
      });
    }

    const documentId = path.basename(
      req.file.filename,
      path.extname(req.file.filename)
    );
    
    await analyzeInspectionReport(req.file.path, documentId);   

    return res.status(200).json({
      success: true,
      documentId,
      filename: req.file.originalname,
      message: "Inspection document ready for ingestion",
    });
  } catch (error) {
    next(error);
  }
}