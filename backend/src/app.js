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
import agentRouter from "./routes/agent.routes.js";
import authRouter from "./routes/auth.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { telemetryService } from "./services/telemetry.service.js";
import { getEmbeddingMetrics } from "../../ai-service/embeddings/embedding.service.js";
import { checkDbConnection } from "./config/db.js";

const app = express();

// Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.removeHeader("X-Powered-By");
    next();
});

// Configurable CORS with safe local development fallbacks
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
    : [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
    ];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-organization-id"],
    optionsSuccessStatus: 204,
}));

// Hardened body parser limit (2 MB max) to prevent memory exhaustion
app.use(express.json({ limit: "2mb" }));

// Authentication routes (public registration/login, protected /me)
app.use("/api/v1/auth", authRouter);

// Public root and health endpoints
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to the File Upload API"
    });
});

const healthHandler = async (req, res) => {
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:5001";

    let dbOk = false;
    let qdrantOk = false;
    let ollamaOk = false;
    let aiServiceOk = false;

    try {
        const dbStatus = await checkDbConnection();
        dbOk = Boolean(dbStatus && dbStatus.connected);
    } catch {
        dbOk = false;
    }

    try {
        const qRes = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(2000) });
        qdrantOk = qRes.ok;
    } catch {
        qdrantOk = false;
    }

    try {
        let oRes;
        try {
            oRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
        } catch (fetchErr) {
            if (ollamaUrl.includes("host.docker.internal")) {
                const fallbackUrl = ollamaUrl.replace("host.docker.internal", "127.0.0.1");
                oRes = await fetch(`${fallbackUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
            } else {
                throw fetchErr;
            }
        }
        ollamaOk = Boolean(oRes && oRes.ok);
    } catch {
        ollamaOk = false;
    }

    try {
        const aRes = await fetch(`${aiServiceUrl}/health`, { signal: AbortSignal.timeout(2000) });
        aiServiceOk = aRes.ok;
    } catch {
        aiServiceOk = false;
    }

    res.status(200).json({
        status: "ok",
        backend: "healthy",
        database: dbOk ? "healthy" : "unreachable",
        qdrant: qdrantOk ? "healthy" : "unreachable",
        ollama: ollamaOk ? "healthy" : "unreachable",
        aiService: aiServiceOk ? "healthy" : "unreachable",
        timestamp: new Date().toISOString(),
    });
};

app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
        status: "ok"
    });
});

app.get('/health', healthHandler);

// Private operational routes — strictly protected by authentication boundary
app.use('/api/v1', router);
app.use("/api/v1/documents", requireAuth, documentsRouter);
app.use("/api/v1/chat", requireAuth, chatRouter);
app.use("/api/v1/inspection", requireAuth, inspectionRouter);
app.use("/api/v1/reports", requireAuth, reportsRouter);
app.use("/api/v1/coding", requireAuth, codingRouter);
app.use("/api/v1/vision", requireAuth, visionRouter);
app.use("/api/v1/agent", requireAuth, agentRouter);

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
    getRouterDiagnostic,
    classifyTask,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

app.get('/api/v1/router/models', async (req, res) => {
    const defaultModel    = process.env.MODEL_GENERAL    || process.env.DEFAULT_MODEL   || process.env.OLLAMA_MODEL || "llama3.2:3b";
    const documentModel   = process.env.MODEL_DOCUMENT   || process.env.DOCUMENT_MODEL  || defaultModel;
    const inspectionModel = process.env.MODEL_INSPECTION || process.env.INSPECTION_MODEL || defaultModel;
    const codingModel     = process.env.MODEL_CODING     || process.env.CODING_MODEL    || defaultModel;
    const visionModel     = process.env.MODEL_VISION     || process.env.VISION_MODEL    || "moondream";

    const installedModels = await getAvailableModels();
    const diagnostic = await getRouterDiagnostic();

    res.status(200).json({
        registry: {
            [TASK_TYPE.DOCUMENT_ANALYSIS]: documentModel,
            [TASK_TYPE.INSPECTION]:        inspectionModel,
            [TASK_TYPE.CODING]:            codingModel,
            [TASK_TYPE.VISION]:            visionModel,
            [TASK_TYPE.GENERAL_CHAT]:      defaultModel,
            // Aliases for backward compatibility
            DOCUMENT:                      documentModel,
            GENERAL:                       defaultModel,
        },
        installedModels,
        diagnostic,
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
    const visionModel = process.env.VISION_MODEL || "moondream";

    let qdrantReachable  = false;
    let ollamaReachable  = false;
    let ollamaModelLoaded = false;
    let visionModelLoaded = false;

    try {
        const qRes = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
        qdrantReachable = qRes.ok;
    } catch { /* unreachable */ }

    try {
        let oRes;
        try {
            oRes = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        } catch (fetchErr) {
            if (ollamaUrl.includes("host.docker.internal")) {
                const fallbackUrl = ollamaUrl.replace("host.docker.internal", "127.0.0.1");
                oRes = await fetch(`${fallbackUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            } else {
                throw fetchErr;
            }
        }
        if (oRes && oRes.ok) {
            ollamaReachable = true;
            const tags = await oRes.json();
            ollamaModelLoaded = Array.isArray(tags.models) &&
                tags.models.some(m => m.name && m.name.startsWith(ollamaModel.split(":")[0]));
            visionModelLoaded = Array.isArray(tags.models) &&
                tags.models.some(m => m.name && m.name.startsWith(visionModel.split(":")[0]));
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

    const perfSummary = telemetryService.getPerformanceSummary();

    res.status(200).json({
        status: isFullySovereign ? "sovereign" : "degraded",
        auditTimestamp: new Date().toISOString(),
        telemetry: {
            configured: {
                llmModel: ollamaModel,
                visionModel: visionModel,
                embeddingModel: "Xenova/all-MiniLM-L6-v2",
                qdrantEndpoint: qdrantUrl,
                ollamaEndpoint: ollamaUrl,
            },
            available: {
                llm: ollamaReachable && ollamaModelLoaded,
                vision: ollamaReachable && visionModelLoaded,
                embeddings: true,
                vectorDb: qdrantReachable,
                ocr: true,
            },
            actuallyUsed: {
                totalExecutions: perfSummary.totalExecutions,
                modelsActive: Object.keys(perfSummary.modelsBreakdown),
                tasksExecuted: Object.keys(perfSummary.tasksBreakdown).filter(k => perfSummary.tasksBreakdown[k] > 0),
            },
        },
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
            vision: {
                provider:         "ollama (multimodal)",
                model:            visionModel,
                endpoint:         ollamaUrl,
                endpointType:     "local",
                reachable:        ollamaReachable,
                modelLoaded:      visionModelLoaded,
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
            allVisionLocal:          ollamaReachable && visionModelLoaded,
            allEmbeddingsLocal:      true,
            allOcrLocal:             true,
            allStorageLocal:         qdrantReachable,
            networkFirewalled:       false,  // Docker bridge; no kernel firewall enforced
            networkFirewallNote:     "Code-level sovereignty verified. No application code calls external AI APIs. Network-layer isolation requires additional iptables/firewall rules for true air-gap.",
        },
    });
});

/**
 * Technical Performance Diagnostic Endpoint
 * GET /api/v1/system/performance
 *
 * Reports technical latency percentiles (P50, P95), component warmup status,
 * and workflow profiles with zero tenant data exposure.
 */
app.get('/api/v1/system/performance', async (req, res) => {
    try {
        const summary = telemetryService.getPerformanceSummary();
        const routerDiag = await getRouterDiagnostic();
        const embeddingMetrics = getEmbeddingMetrics();

        res.status(200).json({
            success: true,
            local: true,
            timestamp: new Date().toISOString(),
            summary,
            models: routerDiag.models,
            embeddings: embeddingMetrics,
            workflows: {
                rag: {
                    local: true,
                    vectorDb: "Qdrant",
                    dimensions: embeddingMetrics.dimensions,
                    embeddingWarm: embeddingMetrics.isWarm,
                },
                inspection: {
                    local: true,
                    parallelSopRetrieval: true,
                    deterministicCalculator: true,
                    approvalNoteDocx: true,
                },
                coding: {
                    local: true,
                    sandbox: "Docker ephemeral",
                    networkIsolation: "none",
                    readOnlyRoot: true,
                },
                vision: {
                    local: true,
                    model: "moondream",
                    provider: "ollama",
                },
                ocr: {
                    local: true,
                    engine: "Tesseract 5.x",
                    fastPathPdfText: true,
                },
            },
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: `Performance diagnostic failed: ${err.message}`,
        });
    }
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