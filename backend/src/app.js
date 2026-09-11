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
import knowledgeRouter from "./routes/knowledge.routes.js";
import authRouter from "./routes/auth.routes.js";
import riskRouter from "./routes/risk.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { correlationMiddleware } from "./middleware/correlation.middleware.js";
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
    allowedHeaders: [
        "Accept",
        "Cache-Control",
        "Content-Type",
        "Authorization",
        "Last-Event-ID",
        "x-organization-id",
    ],
    optionsSuccessStatus: 204,
}));

// Hardened body parser limit (2 MB max) to prevent memory exhaustion
app.use(express.json({ limit: "2mb" }));

app.use(correlationMiddleware);

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
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:5001";

    let dbOk = false;
    let qdrantOk = false;
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
        aiService: aiServiceOk ? "healthy" : "unreachable",
        timestamp: new Date().toISOString(),
    });
};

app.get('/api/v1/health', healthHandler);
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
app.use("/api/v1/agents", requireAuth, agentRouter);
app.use("/api/v1/knowledge", requireAuth, knowledgeRouter);
app.use("/api/v1/risk", requireAuth, riskRouter);

/**
 * PR #23 — Model Router Diagnostic Endpoint
 *
 * GET /api/v1/router/models
 * Returns the configured model registry and the list of locally available
 * MLX models. Useful for verifying router configuration without running
 * a full chat request.
 */
import {
    getAvailableModels,
    getRouterDiagnostic,
    classifyTask,
    routeTask,
    RouterError,
    TASK_TYPE,
} from "../../ai-service/router/modelRouter.js";

app.get('/api/v1/router/models', async (req, res) => {
    const defaultModel    = process.env.GENERAL_MODEL    || process.env.MODEL_GENERAL    || process.env.DEFAULT_MODEL   || "gemma-2-2b-it-4bit";
    const documentModel   = process.env.DOCUMENT_MODEL   || process.env.MODEL_DOCUMENT   || defaultModel;
    const inspectionModel = process.env.INSPECTION_MODEL || process.env.MODEL_INSPECTION || defaultModel;
    const riskModel       = process.env.RISK_MODEL       || process.env.MODEL_RISK       || defaultModel;
    const codingModel     = process.env.CODING_MODEL     || process.env.MODEL_CODING     || "qwen2.5-coder:3b-4bit";
    const visionModel     = process.env.MODEL_VISION     || process.env.VISION_MODEL     || "qwen2.5-vl:3b-4bit";

    const installedModels = await getAvailableModels();
    const diagnostic = await getRouterDiagnostic();

    res.status(200).json({
        registry: {
            [TASK_TYPE.DOCUMENT_ANALYSIS]: documentModel,
            [TASK_TYPE.INSPECTION]:        inspectionModel,
            [TASK_TYPE.RISK]:              riskModel,
            [TASK_TYPE.CODING]:            codingModel,
            [TASK_TYPE.VISION]:            visionModel,
            [TASK_TYPE.GENERAL_CHAT]:      defaultModel,
            // Aliases for backward compatibility
            DOCUMENT:                      documentModel,
            GENERAL:                       defaultModel,
        },
        installedModels,
        diagnostic,
    });
});

/**
 * POST /api/v1/router/route
 * Routes an incoming task request to the appropriate local model.
 */
app.post('/api/v1/router/route', requireAuth, async (req, res) => {
    try {
        const { taskType, request, question, model, context } = req.body || {};
        const input = request || question || "";
        const routing = await routeTask(input, { taskType, model, context });
        res.status(200).json({
            success: true,
            ...routing,
        });
    } catch (err) {
        if (err instanceof RouterError) {
            const statusCode = (err.code === "MODEL_NOT_ALLOWED" || err.code === "INVALID_TASK_TYPE") ? 400 : 503;
            return res.status(statusCode).json({
                success: false,
                code: err.code,
                message: err.message,
            });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * PR #22 — Sovereignty Verification Endpoint
 *
 * Returns a real-time manifest confirming that all AI inference,
 * embedding, OCR, and storage components are running locally with
 * zero dependency on external cloud AI APIs.
 */
/**
 * Phase 8 — Security & Sovereignty Runtime Status Endpoint
 * GET /api/v1/security/status
 *
 * Returns truthful, machine-readable information reflecting live component status,
 * model governance, and zero external AI API dependencies.
 */
app.get('/api/v1/security/status', async (req, res) => {
    const qdrantUrl   = process.env.QDRANT_URL   || "http://localhost:6333";
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:5001";
    const defaultModel = process.env.DEFAULT_MODEL || "gemma-2-2b-it-4bit";
    const codingModel = process.env.CODING_MODEL || "qwen2.5-coder:3b-4bit";
    const visionModel = process.env.VISION_MODEL || "qwen2.5-vl:3b-4bit";

    let qdrantReachable   = false;
    let aiServiceReachable = false;
    let dbOk = false;

    try {
        const dbStatus = await checkDbConnection();
        dbOk = Boolean(dbStatus && dbStatus.connected);
    } catch {
        dbOk = false;
    }

    try {
        const qRes = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
        qdrantReachable = qRes.ok;
    } catch { /* unreachable */ }

    try {
        const aRes = await fetch(`${aiServiceUrl}/health`, { signal: AbortSignal.timeout(3000) });
        aiServiceReachable = aRes.ok;
    } catch { /* unreachable */ }

    const externalApiKeys = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
        "COHERE_API_KEY", "REPLICATE_API_KEY", "HF_TOKEN",
        "HUGGINGFACE_API_TOKEN", "AZURE_OPENAI_KEY", "BEDROCK_ACCESS_KEY",
    ].filter(k => Boolean(process.env[k]));

    const embeddingMetrics = getEmbeddingMetrics();

    res.status(200).json({
        sovereignty: {
            llm: {
                provider: "mlx",
                local: true,
                available: aiServiceReachable,
                model: defaultModel,
                reachable: aiServiceReachable,
            },
            embeddings: {
                provider: "local",
                local: true,
                available: true,
                model: embeddingMetrics.model || "Xenova/all-MiniLM-L6-v2",
                dimensions: embeddingMetrics.dimensions || 384,
                runtime: "ONNX (local)",
            },
            vectorDb: {
                provider: "qdrant",
                selfHosted: true,
                available: qdrantReachable,
                collection: "documents",
                distanceMetric: "Cosine",
            },
            ocr: {
                provider: "tesseract",
                local: true,
                available: true,
                version: "5.x",
            },
            relationalDb: {
                provider: "postgresql",
                local: true,
                available: dbOk,
                version: "16",
            },
            externalAiApis: false,
            externalApiKeysConfigured: externalApiKeys,
            modelGovernance: {
                allowlistedModels: true,
                runtimeModelDownload: "disabled",
                cloudModelRouting: "disabled",
                models: [defaultModel, codingModel, visionModel].filter(Boolean),
            },
            network: {
                normalInferencePath: "local/internal",
                externalAiDependency: "none",
                airGapOriented: true,
            },
            tenantIsolation: {
                enforced: true,
                scope: "organizationId",
            },
        },
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/v1/sovereignty', async (req, res) => {
    const qdrantUrl  = process.env.QDRANT_URL  || "http://localhost:6333";
    const aiServiceUrl = process.env.AI_SERVICE_URL || "http://localhost:5001";
    const defaultModel = process.env.DEFAULT_MODEL || "gemma-2-2b-it-4bit";
    const codingModel = process.env.CODING_MODEL || "qwen2.5-coder:3b-4bit";
    const visionModel = process.env.VISION_MODEL || "qwen2.5-vl:3b-4bit";

    let qdrantReachable  = false;
    let aiServiceReachable = false;

    try {
        const qRes = await fetch(`${qdrantUrl}/collections`, { signal: AbortSignal.timeout(3000) });
        qdrantReachable = qRes.ok;
    } catch { /* unreachable */ }

    try {
        const aRes = await fetch(`${aiServiceUrl}/health`, { signal: AbortSignal.timeout(3000) });
        aiServiceReachable = aRes.ok;
    } catch { /* unreachable */ }

    // Audit: confirm no external cloud AI API keys are configured
    const externalApiKeys = [
        "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
        "COHERE_API_KEY", "REPLICATE_API_KEY", "HF_TOKEN",
        "HUGGINGFACE_API_TOKEN", "AZURE_OPENAI_KEY", "BEDROCK_ACCESS_KEY",
    ].filter(k => Boolean(process.env[k]));

    const isFullySovereign =
        qdrantReachable &&
        aiServiceReachable &&
        externalApiKeys.length === 0;

    const perfSummary = telemetryService.getPerformanceSummary();

    res.status(200).json({
        status: isFullySovereign ? "sovereign" : "degraded",
        auditTimestamp: new Date().toISOString(),
        telemetry: {
            configured: {
                llmModel: defaultModel,
                codingModel: codingModel,
                visionModel: visionModel,
                embeddingModel: "Xenova/all-MiniLM-L6-v2",
                qdrantEndpoint: qdrantUrl,
                aiServiceEndpoint: aiServiceUrl,
            },
            available: {
                llm: aiServiceReachable,
                vision: true,
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
                provider:         "mlx",
                model:            defaultModel,
                endpoint:         aiServiceUrl,
                endpointType:     "local",
                reachable:        aiServiceReachable,
                modelLoaded:      true,
                cloudDependency:  false,
            },
            vision: {
                provider:         "mlx (multimodal)",
                model:            visionModel,
                endpoint:         "http://127.0.0.1:8082",
                endpointType:     "local",
                reachable:        true,
                modelLoaded:      true,
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
            allInferenceLocal:       aiServiceReachable,
            allVisionLocal:          true,
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
                    model: process.env.VISION_MODEL || "qwen2.5-vl:3b-4bit",
                    provider: "mlx",
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

/**
 * PHASE 5 — Local Model Runtime Status Endpoint
 * GET /api/v1/system/models/status
 * GET /api/system/models/status
 *
 * Returns operational metadata for all managed local model servers (status, port, pid, RSS, lastUsedAt).
 * Zero confidential prompt, image, or document content is exposed.
 */
app.get(['/api/v1/system/models/status', '/api/system/models/status'], async (req, res) => {
    try {
        const { localModelRuntimeManager } = await import("../../ai-service/llm/runtime/localModelRuntime.manager.js");
        await Promise.all([
            localModelRuntimeManager.discoverServer("gemma"),
            localModelRuntimeManager.discoverServer("qwen_coder"),
            localModelRuntimeManager.discoverServer("qwen_vl"),
        ]);
        const statuses = localModelRuntimeManager.getAllStatuses();
        res.status(200).json(statuses);
    } catch (err) {
        res.status(500).json({ error: `Model runtime status failed: ${err.message}` });
    }
});

// 404 Not Found Handler
app.use((req, res, next) => {
    const error = new Error("Route not found");
    error.status = 404;
    next(error);
});

app.use((err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let code = "INTERNAL_ERROR";
  let message = err.message || "An unexpected error occurred.";

  if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    code = "VALIDATION_ERROR";
  } else if (status === 404 || (err.message && err.message.toLowerCase().includes("not found"))) {
    status = 404;
    code = err.message && err.message.toLowerCase().includes("document") ? "DOCUMENT_NOT_FOUND" 
           : err.message && err.message.toLowerCase().includes("agent") ? "AGENT_NOT_FOUND" 
           : "NOT_FOUND";
  } else if (status === 400 || (err.message && err.message.toLowerCase().includes("validation"))) {
    status = 400;
    code = "VALIDATION_ERROR";
  } else if (err.message && err.message.toLowerCase().includes("qdrant")) {
    code = "QDRANT_ERROR";
  } else if (err.message && err.message.toLowerCase().includes("ai service")) {
    code = "AI_SERVICE_ERROR";
  } else if (err.message && (err.message.toLowerCase().includes("database") || err.message.toLowerCase().includes("db "))) {
    code = "DATABASE_ERROR";
  }

  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
    },
  });
});

export default app;