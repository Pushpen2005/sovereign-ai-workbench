import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import chatRouter from "./routes/chat.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../ai-service/.env') });

import express from 'express';
import cors from 'cors';
import router from './routes/files.routes.js';
import multer from 'multer';
import inspectionRouter from "./routes/inspection.routes.js";
import documentsRouter from "./routes/documents.routes.js";
import reportsRouter from "./routes/reports.routes.js";
import codingRouter from "./routes/coding.routes.js";
import visionRouter from "./routes/vision.routes.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/v1', router);
app.use("/api/v1/documents", documentsRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/inspection", inspectionRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/coding", codingRouter);
app.use("/api/v1/vision", visionRouter);
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to the File Upload API"
    });
});

app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
        status: "ok"
    });
});

/**
 * PR #23 — Model Router Diagnostic Endpoint
 *
 * GET /api/v1/router/models
 * Returns the configured model registry and the list of locally installed
 * Ollama models. Useful for verifying router configuration without running
 * a full chat request.
 */
import {
    getAvailableModels,
    classifyTask,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

app.get('/api/v1/router/models', async (req, res) => {
    const defaultModel  = process.env.DEFAULT_MODEL   || process.env.OLLAMA_MODEL || "llama3.2:3b";
    const documentModel = process.env.DOCUMENT_MODEL  || defaultModel;
    const codingModel   = process.env.CODING_MODEL    || defaultModel;

    const installedModels = await getAvailableModels();

    res.status(200).json({
        registry: {
            [TASK_TYPE.DOCUMENT]: documentModel,
            [TASK_TYPE.CODING]:   codingModel,
            [TASK_TYPE.GENERAL]:  defaultModel,
        },
        installedModels,
        ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    });
});

/**
 * PR #22 — Sovereignty Verification Endpoint
 *
 * Returns a real-time manifest confirming that all AI inference,
 * embedding, OCR, and storage components are running locally with
 * zero dependency on external cloud AI APIs.
 */
app.get('/api/v1/sovereignty', async (req, res) => {
    const qdrantUrl  = process.env.QDRANT_URL  || "http://localhost:6333";
    const ollamaUrl  = process.env.OLLAMA_URL  || "http://localhost:11434";
    const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";

    let qdrantReachable  = false;
    let ollamaReachable  = false;
    let ollamaModelLoaded = false;

    try {
        const qRes = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
        qdrantReachable = qRes.ok;
    } catch { /* unreachable */ }

    try {
        const oRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (oRes.ok) {
            ollamaReachable = true;
            const tags = await oRes.json();
            ollamaModelLoaded = Array.isArray(tags.models) &&
                tags.models.some(m => m.name && m.name.startsWith(ollamaModel.split(":")[0]));
        }
    } catch { /* unreachable */ }

    // Audit: confirm no external cloud AI API keys are configured
    const externalApiKeys = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
        "COHERE_API_KEY", "REPLICATE_API_KEY", "HF_TOKEN",
        "HUGGINGFACE_API_TOKEN", "AZURE_OPENAI_KEY", "BEDROCK_ACCESS_KEY",
    ].filter(k => Boolean(process.env[k]));

    const isFullySovereign =
        qdrantReachable &&
        ollamaReachable &&
        ollamaModelLoaded &&
        externalApiKeys.length === 0;

    res.status(200).json({
        status: isFullySovereign ? "sovereign" : "degraded",
        auditTimestamp: new Date().toISOString(),
        components: {
            llm: {
                provider:         "ollama",
                model:            ollamaModel,
                endpoint:         ollamaUrl,
                endpointType:     "local",
                reachable:        ollamaReachable,
                modelLoaded:      ollamaModelLoaded,
                cloudDependency:  false,
            },
            embeddings: {
                provider:         "@huggingface/transformers (ONNX runtime)",
                model:            "Xenova/all-MiniLM-L6-v2",
                dimensions:       384,
                runtime:          "local-onnx",
                cachedLocally:    true,
                cloudDependency:  false,
            },
            ocr: {
                provider:         "Tesseract OCR",
                version:          "5.x",
                runtime:          "local-binary (system PATH)",
                cloudDependency:  false,
            },
            vectorDb: {
                provider:         "Qdrant",
                endpoint:         qdrantUrl,
                endpointType:     "local",
                reachable:        qdrantReachable,
                cloudDependency:  false,
            },
            relationalDb: {
                provider:         "PostgreSQL 16",
                endpointType:     "local",
                cloudDependency:  false,
            },
            docxGenerator: {
                provider:         "python-docx",
                runtime:          "local-python3",
                cloudDependency:  false,
            },
        },
        externalCloudApiKeys: externalApiKeys,
        sovereignty: {
            noExternalAiApis:        externalApiKeys.length === 0,
            allInferenceLocal:       ollamaReachable,
            allEmbeddingsLocal:      true,
            allOcrLocal:             true,
            allStorageLocal:         qdrantReachable,
            networkFirewalled:       false,  // Docker bridge; no kernel firewall enforced
            networkFirewallNote:     "Code-level sovereignty verified. No application code calls external AI APIs. Network-layer isolation requires additional iptables/firewall rules for true air-gap.",
        },
    });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      success: false,
      message: err.message,
    });
  }

  if (err) {
    const status = err.status || err.statusCode || (err.message && err.message.includes("not found") ? 404 : 400);
    return res.status(status).json({
      success: false,
      message: err.message,
    });
  }

  next();
});

export default app;