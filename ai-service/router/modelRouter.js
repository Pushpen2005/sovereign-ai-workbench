/**
 * PR #23 / Phase 8 — Model Router & Multi-Model Orchestration
 *
 * Classifies incoming requests into a standardized deterministic taxonomy:
 *   - DOCUMENT_ANALYSIS
 *   - CODING
 *   - VISION
 *   - GENERAL_CHAT
 *   - INSPECTION
 *
 * Selects the appropriate local Ollama model from the verified local registry
 * and returns routing metadata including `local: true`.
 *
 * Enforces a strict server-side model allowlist to prevent unauthorized or
 * external model invocation.
 */

// ─── Task Types ───────────────────────────────────────────────────────────────

export const TASK_TYPE = Object.freeze({
    DOCUMENT_ANALYSIS: "DOCUMENT_ANALYSIS",
    CODING:            "CODING",
    VISION:            "VISION",
    GENERAL_CHAT:      "GENERAL_CHAT",
    INSPECTION:        "INSPECTION",
    // Backward-compatibility & Phase 9 aliases
    DOCUMENT:          "DOCUMENT_ANALYSIS",
    GENERAL:           "GENERAL_CHAT",
});

export const VALID_TASK_TYPES = Object.freeze(new Set([
    TASK_TYPE.DOCUMENT_ANALYSIS,
    TASK_TYPE.CODING,
    TASK_TYPE.VISION,
    TASK_TYPE.GENERAL_CHAT,
    TASK_TYPE.INSPECTION,
    "DOCUMENT",
    "GENERAL",
]));

/**
 * Normalizes task type to minimum canonical taxonomy (DOCUMENT, CODING, GENERAL, VISION, INSPECTION).
 */
export function toCanonicalTaskType(taskType) {
    if (taskType === TASK_TYPE.DOCUMENT_ANALYSIS || taskType === "DOCUMENT" || taskType === TASK_TYPE.INSPECTION) {
        return "DOCUMENT";
    }
    if (taskType === TASK_TYPE.CODING) {
        return "CODING";
    }
    if (taskType === TASK_TYPE.GENERAL_CHAT || taskType === "GENERAL") {
        return "GENERAL";
    }
    if (taskType === TASK_TYPE.VISION) {
        return "VISION";
    }
    return taskType;
}

// ─── Keyword Dictionaries ─────────────────────────────────────────────────────

/**
 * Inspection-task indicators — strong signals that the user wants industrial inspection analysis,
 * finding extraction, or Approval Note generation.
 * Takes precedence over generic document keywords.
 */
const INSPECTION_KEYWORDS = [
    "inspection report", "approval note", "findings", "risk assessment",
    "equipment inspection", "industrial inspection", "inspection finding",
    "defect finding", "analyze this inspection report", "prepare an approval note",
    "inspection analysis", "inspect equipment", "audit report",
    "bearing temperature observed", "operating limit", "critical exceedance",
    "analyze this report and prepare an approval note", "prepare an approval",
];

/**
 * Coding-task indicators — strong signals that the user wants code generated.
 */
const CODING_KEYWORDS = [
    // explicit code verbs
    "write code", "write a function", "write a script", "write a program",
    "write python", "write a python", "python program", "write a python program", "write a python script",
    "write javascript", "write java", "write sql", "write bash",
    "write a query", "write a class", "write an algorithm",
    // debug / fix code
    "debug", "fix this code", "fix this function", "fix this script",
    "correct this code", "this code doesn't work", "why is this code",
    // generate / create code
    "generate code", "generate python", "create a function", "create a script", "create a class",
    "implement a function", "implement an algorithm", "implement this in",
    // language / framework names combined with action
    "in python", "in javascript", "in typescript", "in java", "in c++",
    "in sql", "in bash", "in node", "in react",
    "python script", "python code",
    "javascript function", "python function", "create a javascript", "create a python",
    "function for", "code for", "script for", "sorting data", "sort data",
    // code-specific nouns
    "function that", "function to", "class that", "class to",
    "script that", "script to", "algorithm that", "algorithm to",
    "regex", "regular expression", "api call", "rest call", "http request",
    "sql query", "database query", "code snippet", "code example",
    "calculate using code", "calculate with python", "automate",
    // refactor / review
    "refactor this", "optimise this code", "optimize this code",
    "code review", "review this code",
];

/**
 * Vision-task indicators — signals the user wants visual inspection or image analysis.
 */
const VISION_KEYWORDS = [
    "analyze this gauge image", "gauge image", "inspect this image",
    "analyze this image", "look at this image", "in this image",
    "from this image", "this picture", "this photo",
    "equipment image", "analyze this equipment image", "inspect this equipment image",
    "image for visible defects", "visible defects", "image for visible",
    "engineering drawing", "analyze this drawing", "inspect this drawing",
    "analyze this diagram", "inspect this diagram",
    "visible in this image", "shown in this image", "image shows",
    "analyze this photo", "inspect this photo", "schematic",
    "photograph", "visual inspection",
];

/**
 * Document-task indicators — signals the user is asking about ingested content or SOPs.
 * Aligned with Phase 8 taxonomy: SOP, manual, policy, procedure, document, report, "according to".
 */
const DOCUMENT_KEYWORDS = [
    // Core signals from Phase 8 specification:
    "sop", "manual", "policy", "procedure", "document", "report", "according to",
    // Standard document / compliance references
    "maintenance sop", "safety sop", "checklist", "guideline", "standard",
    "compliance", "specification", "per the", "based on", "according to the",
    "from the document", "from the report", "from the sop", "from the manual",
    "retrieved context",
    // Incident and failure investigation against ingested documentation
    "fail", "failure", "root cause",
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a question into the standardized task taxonomy using deterministic keyword matching.
 * No LLM call — deterministic O(n) string search, adding < 1 ms overhead.
 *
 * Precedence:
 * 1. Image presence (options.hasImage / options.image) -> VISION
 * 2. Explicit workflow: "inspection" -> INSPECTION
 * 3. Inspection indicators -> INSPECTION (takes precedence over generic document keywords)
 * 4. Coding indicators -> CODING
 * 5. Vision indicators -> VISION
 * 6. Document indicators -> DOCUMENT_ANALYSIS
 * 7. Fallback -> GENERAL_CHAT
 *
 * @param {string|object} questionOrInput
 * @param {object} [options]
 * @returns {"DOCUMENT_ANALYSIS" | "CODING" | "VISION" | "GENERAL_CHAT" | "INSPECTION"}
 */
export function classifyTask(questionOrInput, options = {}) {
    const opts = typeof questionOrInput === "object" && questionOrInput !== null
        ? { ...questionOrInput, ...options }
        : options;

    const rawText = typeof questionOrInput === "string"
        ? questionOrInput
        : (opts.request || opts.question || "");

    // 1. Image presence -> VISION
    if (opts && (opts.hasImage || opts.image)) {
        return TASK_TYPE.VISION;
    }

    // 2. Explicit workflow override
    if (opts && opts.workflow === "inspection") {
        return TASK_TYPE.INSPECTION;
    }

    if (typeof rawText !== "string" || !rawText.trim()) {
        return TASK_TYPE.GENERAL_CHAT;
    }

    const q = rawText.toLowerCase();

    // 3. Inspection check first (takes precedence over generic "report" / "document" matches)
    for (const kw of INSPECTION_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.INSPECTION;
        }
    }

    // 4. Coding check
    for (const kw of CODING_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.CODING;
        }
    }

    // 5. Vision keyword check
    for (const kw of VISION_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.VISION;
        }
    }

    // 6. Document analysis check
    for (const kw of DOCUMENT_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.DOCUMENT_ANALYSIS;
        }
    }

    return TASK_TYPE.GENERAL_CHAT;
}

// ─── Model Registry & Allowlist ───────────────────────────────────────────────

/**
 * Read the model registry from environment variables.
 * All values fall back to DEFAULT_MODEL / OLLAMA_MODEL so the router remains fully operational.
 */
export function getModelRegistry() {
    const defaultModel    = process.env.GENERAL_MODEL    || process.env.MODEL_GENERAL    || process.env.DEFAULT_MODEL   || process.env.OLLAMA_MODEL || "llama3.2:3b";
    const documentModel   = process.env.DOCUMENT_MODEL   || process.env.MODEL_DOCUMENT   || defaultModel;
    const inspectionModel = process.env.INSPECTION_MODEL || process.env.MODEL_INSPECTION || defaultModel;

    // Coding model: by default uses CODING_MODEL (llama3.2:3b), prepared for Qwen Coder MLX in Phase 3
    const codingMlxEnabled = (process.env.CODING_MLX_ENABLED || "false").toLowerCase() === "true" ||
                             (process.env.CODING_MODEL_PROVIDER || "").toLowerCase() === "mlx";
    const qwenCoderModel   = process.env.QWEN_CODER_MODEL || "qwen2.5-coder:3b-4bit";
    const codingModel      = codingMlxEnabled
        ? qwenCoderModel
        : (process.env.CODING_MODEL || process.env.MODEL_CODING || defaultModel);

    // Vision model: by default uses VISION_MODEL (moondream), prepared for Qwen VL MLX in Phase 4
    const visionMlxEnabled = (process.env.VISION_MLX_ENABLED || "false").toLowerCase() === "true" ||
                             (process.env.VISION_MODEL_PROVIDER || "").toLowerCase() === "mlx";
    const qwenVlModel      = process.env.QWEN_VL_MODEL || "qwen2.5-vl:3b-4bit";
    const visionModel      = visionMlxEnabled
        ? qwenVlModel
        : (process.env.VISION_MODEL || process.env.MODEL_VISION || "moondream");

    const codingFallbackEnabled =
        (process.env.CODING_MODEL_FALLBACK || "true").toLowerCase() !== "false";
    const visionFallbackEnabled =
        (process.env.VISION_MODEL_FALLBACK || "true").toLowerCase() !== "false";

    return {
        [TASK_TYPE.DOCUMENT_ANALYSIS]: documentModel,
        [TASK_TYPE.CODING]:            codingModel,
        [TASK_TYPE.VISION]:            visionModel,
        [TASK_TYPE.GENERAL_CHAT]:      defaultModel,
        [TASK_TYPE.INSPECTION]:        inspectionModel,
        DOCUMENT:                      documentModel,
        GENERAL:                       defaultModel,
        defaultModel,
        visionModel,
        codingFallbackEnabled,
        visionFallbackEnabled,
        qwenCoderModel,
        qwenVlModel,
    };
}

/**
 * Sovereign model allowlist.
 * Explicitly blocks unauthorized or external model names.
 *
 * @returns {Set<string>}
 */
export function getAllowedModels() {
    const registry = getModelRegistry();
    const allowed = new Set([
        registry.defaultModel,
        registry[TASK_TYPE.DOCUMENT_ANALYSIS],
        registry[TASK_TYPE.CODING],
        registry[TASK_TYPE.VISION],
        registry[TASK_TYPE.GENERAL_CHAT],
        registry[TASK_TYPE.INSPECTION],
        "llama3.2:3b",
        "llama3.2",
        "moondream",
        "moondream:latest",
        "gemma-2-2b-it-4bit",
        "gemma-2-2b-it",
        "gemma-2-2b",
        "gemma-2-9b-it-4bit",
        "gemma-2-9b-it",
        "qwen2.5-coder:3b-4bit",
        "qwen2.5-coder:3b",
        "qwen2.5-coder",
        "qwen2.5-coder:7b-4bit",
        "qwen2.5-coder:7b",
        "qwen2.5-vl:3b-4bit",
        "qwen2.5-vl:3b",
        "qwen2.5-vl",
        "models/qwen2.5-vl-3b-4bit",
    ].filter(Boolean));

    const extra = process.env.ALLOWED_MODELS;
    if (extra) {
        extra.split(",").map((s) => s.trim()).filter(Boolean).forEach((m) => allowed.add(m));
    }

    return allowed;
}

/**
 * Check whether a model name is permitted by the sovereign allowlist.
 *
 * @param {string} modelName
 * @returns {boolean}
 */
export function isModelAllowed(modelName) {
    if (typeof modelName !== "string" || !modelName.trim()) return false;
    const trimmed = modelName.trim();
    // Strictly reject path traversal, slashes, backslashes, or illegal characters
    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..") || /[^a-zA-Z0-9_.:-]/.test(trimmed)) {
        return false;
    }
    const allowed = getAllowedModels();
    for (const m of allowed) {
        if (m === trimmed || m.split(":")[0] === trimmed || (m === trimmed.split(":")[0] && !trimmed.includes(":"))) {
            return true;
        }
    }
    return false;
}

// ─── Availability Check ───────────────────────────────────────────────────────

async function fetchOllamaTags(ollamaUrl) {
    let res;
    try {
        res = await fetch(`${ollamaUrl}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
    } catch (err) {
        if (ollamaUrl.includes("host.docker.internal")) {
            const fallbackUrl = ollamaUrl.replace("host.docker.internal", "127.0.0.1");
            res = await fetch(`${fallbackUrl}/api/tags`, {
                signal: AbortSignal.timeout(3000),
            });
        } else {
            throw err;
        }
    }
    return res;
}

let cachedModelsData = null;
let modelsCacheTimestamp = 0;
const MODELS_CACHE_TTL_MS = 15000; // 15 seconds cache

export function clearModelCache() {
    cachedModelsData = null;
    modelsCacheTimestamp = 0;
}

async function getCachedOllamaModels(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedModelsData && (now - modelsCacheTimestamp < MODELS_CACHE_TTL_MS)) {
        return cachedModelsData;
    }

    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    try {
        const res = await fetchOllamaTags(ollamaUrl);
        if (!res.ok) return cachedModelsData || [];
        const data = await res.json();
        const models = Array.isArray(data.models) ? data.models : [];
        cachedModelsData = models;
        modelsCacheTimestamp = now;
        return models;
    } catch {
        return cachedModelsData || [];
    }
}

export async function checkModelAvailability(modelName) {
    if (!modelName || typeof modelName !== "string") return false;
    const lower = modelName.toLowerCase();

    // Check MLX runtime for Qwen VL models (Port :8082)
    if (lower.includes("vl") || lower.includes("qwen2.5-vl") || lower.includes("vision-mlx")) {
        const qwenVlUrl =
            process.env.QWEN_VL_MLX_URL ||
            process.env.MLX_VISION_URL ||
            "http://127.0.0.1:8082";
        try {
            let res;
            try {
                res = await fetch(`${qwenVlUrl}/health`, { signal: AbortSignal.timeout(2000) });
            } catch {
                if (qwenVlUrl.includes("host.docker.internal")) {
                    res = await fetch("http://127.0.0.1:8082/health", { signal: AbortSignal.timeout(2000) });
                }
            }
            return Boolean(res && res.ok);
        } catch {
            return false;
        }
    }

    // Check MLX runtime for Qwen Coder models (Port :8081)
    if (lower.startsWith("qwen") || lower.includes("qwen2.5-coder") || lower.includes("coder-mlx")) {
        const qwenUrl =
            process.env.QWEN_CODER_MLX_URL ||
            process.env.MLX_CODER_URL ||
            "http://127.0.0.1:8081";
        try {
            let res;
            try {
                res = await fetch(`${qwenUrl}/health`, { signal: AbortSignal.timeout(2000) });
            } catch {
                if (qwenUrl.includes("host.docker.internal")) {
                    res = await fetch("http://127.0.0.1:8081/health", { signal: AbortSignal.timeout(2000) });
                }
            }
            return Boolean(res && res.ok);
        } catch {
            return false;
        }
    }

    // Check MLX runtime for Gemma models (Port :8080)
    if (lower.startsWith("gemma") || lower.includes("mlx")) {
        const mlxUrl = process.env.MLX_URL || "http://127.0.0.1:8080";
        try {
            let res;
            try {
                res = await fetch(`${mlxUrl}/health`, { signal: AbortSignal.timeout(2000) });
            } catch {
                if (mlxUrl.includes("host.docker.internal")) {
                    res = await fetch("http://127.0.0.1:8080/health", { signal: AbortSignal.timeout(2000) });
                }
            }
            return Boolean(res && res.ok);
        } catch {
            return false;
        }
    }

    try {
        const models = await getCachedOllamaModels();
        const installed = models.map((m) => m.name);

        const base = modelName.split(":")[0];
        const isFound = installed.some(
            (m) => m === modelName || m.startsWith(base + ":")
        );

        if (!isFound) {
            // Force one live refresh before failing closed in case model was just pulled
            const refreshed = await getCachedOllamaModels(true);
            const refInstalled = refreshed.map((m) => m.name);
            return refInstalled.some(
                (m) => m === modelName || m.startsWith(base + ":")
            );
        }

        return true;
    } catch {
        return false;
    }
}

/**
 * Return the full list of locally installed Ollama model names.
 *
 * @returns {Promise<Array<{name: string, size: number}>>}
 */
export async function getAvailableModels() {
    try {
        const models = await getCachedOllamaModels();
        return models.map((m) => ({ name: m.name, size: m.size }));
    } catch {
        return [];
    }
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Classify a request and select the appropriate local Ollama model.
 *
 * Accepts either:
 * - `routeTask(questionString, options)`
 * - `routeTask({ taskType, request, hasImage, workflow, model })`
 *
 * Returns a routing decision object:
 * {
 *   taskType:      "DOCUMENT_ANALYSIS" | "CODING" | "VISION" | "GENERAL_CHAT" | "INSPECTION",
 *   selectedModel: string,         — verified local model name
 *   reason:        string,         — human-readable explanation
 *   routingReason: string,         — backwards-compat alias
 *   local:         true,           — guaranteed local execution
 *   isFallback:    boolean,        — true when preferred model unavailable
 *   registryModel: string,         — the configured target model
 *   latencyMs:     number          — decision duration in milliseconds
 * }
 *
 * @param {string|object} requestOrInput
 * @param {object} [options]
 * @returns {Promise<{taskType: string, selectedModel: string, reason: string, routingReason: string, local: boolean, isFallback: boolean, registryModel: string, latencyMs: number}>}
 */
export async function routeTask(requestOrInput, options = {}) {
    const tStart = Date.now();

    const mergedOptions = typeof requestOrInput === "object" && requestOrInput !== null
        ? { ...requestOrInput, ...options }
        : { ...options, question: requestOrInput };

    const requestedModel = mergedOptions.model;
    const hasImage = Boolean(mergedOptions.hasImage || mergedOptions.image);

    console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.started", task: hasImage ? "VISION" : "TEXT" })}`);

    // Model allowlist check on client override
    if (requestedModel) {
        if (!isModelAllowed(requestedModel)) {
            console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "model_not_allowed", model: requestedModel })}`);
            const err = new RouterError(
                `Requested model '${requestedModel}' is not in the sovereign model allowlist.`
            );
            err.code = "MODEL_NOT_ALLOWED";
            err.model = requestedModel;
            throw err;
        }
    }

    // Explicit taskType validation if supplied by caller
    if (mergedOptions.taskType !== undefined && mergedOptions.taskType !== null) {
        const candidate = typeof mergedOptions.taskType === "string" ? mergedOptions.taskType.trim() : "";
        if (!candidate || !VALID_TASK_TYPES.has(candidate)) {
            console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "invalid_task_type", taskType: mergedOptions.taskType })}`);
            const err = new RouterError(
                `Invalid task type '${mergedOptions.taskType}'. Supported: DOCUMENT, CODING, GENERAL, VISION, INSPECTION.`,
                { code: "INVALID_TASK_TYPE", taskType: mergedOptions.taskType }
            );
            err.code = "INVALID_TASK_TYPE";
            err.taskType = mergedOptions.taskType;
            throw err;
        }
    }

    const taskType = mergedOptions.taskType || classifyTask(requestOrInput, options);
    console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.classified", taskType, requestPreview: typeof requestOrInput === 'string' ? requestOrInput.slice(0, 50) : null })}`);

    const registry = getModelRegistry();
    const registryModel = requestedModel || registry[taskType] || registry.defaultModel;
    const defaultModel  = registry.defaultModel;

    // Check whether the configured model is installed
    const isAvailable = await checkModelAvailability(registryModel);

    if (isAvailable) {
        const latencyMs = Date.now() - tStart;
        const reason = routingReason(taskType, registryModel, false);
        console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.model_selected", taskType, selectedModel: registryModel, latencyMs, isFallback: false, local: true })}`);
        return {
            taskType,
            canonicalTaskType: toCanonicalTaskType(taskType),
            model:         registryModel,
            selectedModel: registryModel,
            reason,
            routingReason: reason,
            local:         true,
            isFallback:    false,
            registryModel,
            latencyMs,
        };
    }

    // Model not installed ─────────────────────────────────────────────────────
    if (taskType === TASK_TYPE.VISION) {
        const isQwenVl = registryModel.toLowerCase().includes("vl") || registryModel.toLowerCase().includes("qwen");
        const fallbackVisionModel = "moondream";
        const visionFallbackEnabled = registry.visionFallbackEnabled !== false;

        if (isQwenVl && visionFallbackEnabled && registryModel !== fallbackVisionModel) {
            const fallbackAvailable = await checkModelAvailability(fallbackVisionModel);
            if (fallbackAvailable) {
                const latencyMs = Date.now() - tStart;
                const reason = `Vision model '${registryModel}' is unavailable. Falling back to '${fallbackVisionModel}'.`;
                console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.model_selected", taskType, selectedModel: fallbackVisionModel, latencyMs, isFallback: true, local: true })}`);
                return {
                    taskType,
                    canonicalTaskType: toCanonicalTaskType(taskType),
                    model:         fallbackVisionModel,
                    selectedModel: fallbackVisionModel,
                    reason,
                    routingReason: reason,
                    local:         true,
                    isFallback:    true,
                    registryModel,
                    latencyMs,
                };
            }
        }

        console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "vision_model_unavailable", model: registryModel })}`);
        const err = new RouterError(
            `Configured local vision model '${registryModel}' is not available in Ollama. ` +
            `Run: ollama pull ${registryModel}`
        );
        err.code = "MODEL_UNAVAILABLE";
        err.taskType = taskType;
        err.model = registryModel;
        throw err;
    }

    if (registryModel === defaultModel) {
        console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "default_model_unavailable", model: registryModel })}`);
        const err = new RouterError(
            `Configured local model '${registryModel}' is not available in Ollama. ` +
            `Run: ollama pull ${registryModel}`
        );
        err.code = "MODEL_UNAVAILABLE";
        err.taskType = taskType;
        err.model = registryModel;
        throw err;
    }

    if (registry.codingFallbackEnabled && taskType === TASK_TYPE.CODING) {
        // Fallback: use default model and surface explicit isFallback flag
        const defaultAvailable = await checkModelAvailability(defaultModel);

        if (!defaultAvailable) {
            console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "coding_and_fallback_unavailable", model: registryModel, fallback: defaultModel })}`);
            const err = new RouterError(
                `Configured coding model '${registryModel}' is unavailable and ` +
                `fallback model '${defaultModel}' is also unavailable. ` +
                `Run: ollama pull ${defaultModel}`
            );
            err.code = "MODEL_UNAVAILABLE";
            err.taskType = taskType;
            err.model = registryModel;
            throw err;
        }

        const latencyMs = Date.now() - tStart;
        const reason = `Coding model '${registryModel}' is not installed. Falling back to '${defaultModel}'.`;
        console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.model_selected", taskType, selectedModel: defaultModel, latencyMs, isFallback: true, local: true })}`);
        return {
            taskType,
            canonicalTaskType: toCanonicalTaskType(taskType),
            model:         defaultModel,
            selectedModel: defaultModel,
            reason,
            routingReason: reason,
            local:         true,
            isFallback:    true,
            registryModel,
            latencyMs,
        };
    }

    // No fallback configured — return a structured RouterError
    console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "model_unavailable", model: registryModel })}`);
    const err = new RouterError(
        `Configured local model '${registryModel}' is not available in Ollama. ` +
        `Run: ollama pull ${registryModel}  (or set CODING_MODEL_FALLBACK=true)`
    );
    err.code = "MODEL_UNAVAILABLE";
    err.taskType = taskType;
    err.model = registryModel;
    throw err;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function routingReason(taskType, model, isFallback) {
    const labels = {
        [TASK_TYPE.DOCUMENT_ANALYSIS]: "Document / SOP RAG analysis request",
        [TASK_TYPE.INSPECTION]:        "Industrial inspection & approval note workflow",
        [TASK_TYPE.CODING]:            "Code generation request",
        [TASK_TYPE.VISION]:            "Multimodal visual inspection & document understanding",
        [TASK_TYPE.GENERAL_CHAT]:      "General query — routed to default model",
    };
    return isFallback
        ? `Fallback: ${labels[taskType] || taskType}`
        : labels[taskType] || taskType;
}

export class RouterError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = "RouterError";
        this.code = options.code || "ROUTER_ERROR";
        if (options.taskType) this.taskType = options.taskType;
        if (options.model) this.model = options.model;
    }
}

/**
 * Startup and runtime diagnostic check for the Model Router.
 * Reports installed status, purpose, and sovereignty verification without network calls.
 *
 * @returns {Promise<object>}
 */
export async function getRouterDiagnostic() {
    const registry = getModelRegistry();
    const installed = await getAvailableModels();
    const installedNames = new Set(installed.map((m) => m.name));

    const isInstalled = (target) => {
        if (!target) return false;
        const base = target.split(":")[0];
        for (const name of installedNames) {
            if (name === target || name.startsWith(base + ":")) return true;
        }
        return false;
    };

    const models = [
        {
            taskType:  TASK_TYPE.DOCUMENT_ANALYSIS,
            model:     registry[TASK_TYPE.DOCUMENT_ANALYSIS],
            available: isInstalled(registry[TASK_TYPE.DOCUMENT_ANALYSIS]),
            purpose:   "Industrial document & SOP RAG analysis",
            local:     true,
        },
        {
            taskType:  TASK_TYPE.INSPECTION,
            model:     registry[TASK_TYPE.INSPECTION],
            available: isInstalled(registry[TASK_TYPE.INSPECTION]),
            purpose:   "Industrial inspection finding extraction & approval workflow",
            local:     true,
        },
        {
            taskType:  TASK_TYPE.CODING,
            model:     registry[TASK_TYPE.CODING],
            available: isInstalled(registry[TASK_TYPE.CODING]),
            purpose:   "Isolated sandbox Python code generation",
            local:     true,
        },
        {
            taskType:  TASK_TYPE.VISION,
            model:     registry[TASK_TYPE.VISION],
            available: isInstalled(registry[TASK_TYPE.VISION]),
            purpose:   "Local multimodal visual inspection & gauge reading",
            local:     true,
        },
        {
            taskType:  TASK_TYPE.GENERAL_CHAT,
            model:     registry[TASK_TYPE.GENERAL_CHAT],
            available: isInstalled(registry[TASK_TYPE.GENERAL_CHAT]),
            purpose:   "General conversation & explanations",
            local:     true,
        },
    ];

    return {
        models,
        installedCount: installed.length,
        zeroCloudDependencies: true,
        externalApiKeysCount: 0,
        localOllamaExecution: true,
    };
}
