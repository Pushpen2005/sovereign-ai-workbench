/**
 * PR #23 / Phase 5 — Model Router
 *
 * Classifies incoming requests as DOCUMENT, CODING, VISION, or GENERAL
 * using a fast, deterministic keyword classifier (< 1 ms overhead).
 * Selects the appropriate local Ollama model from the registry and
 * verifies it is installed before returning a routing decision.
 *
 * Enforces a strict server-side model allowlist to prevent unauthorized or
 * external model invocation.
 */

// ─── Task Types ───────────────────────────────────────────────────────────────

export const TASK_TYPE = Object.freeze({
    DOCUMENT: "DOCUMENT",
    CODING:   "CODING",
    VISION:   "VISION",
    GENERAL:  "GENERAL",
});

// ─── Keyword Dictionaries ─────────────────────────────────────────────────────

/**
 * Coding-task indicators — strong signals that the user wants code generated.
 * Checked first because they are unambiguous.
 */
const CODING_KEYWORDS = [
    // explicit code verbs
    "write code", "write a function", "write a script", "write a program",
    "write python", "write javascript", "write java", "write sql", "write bash",
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
    "engineering drawing", "analyze this drawing", "inspect this drawing",
    "analyze this diagram", "inspect this diagram",
    "visible in this image", "shown in this image", "image shows",
    "analyze this photo", "inspect this photo",
];

/**
 * Document-task indicators — signals the user is asking about ingested content.
 * Used as the default when coding and vision indicators are absent.
 */
const DOCUMENT_KEYWORDS = [
    "what does", "what is", "what are", "explain", "summarize", "summary",
    "describe", "find", "search", "retrieve", "look up", "according to",
    "per the", "based on", "according to the", "from the document",
    "from the report", "from the sop", "from the inspection",
    "inspection report", "maintenance sop", "safety sop", "sop",
    "procedure", "checklist", "guideline", "standard", "compliance",
    "finding", "findings", "defect", "defects", "anomaly", "anomalies",
    "pump", "valve", "heat exchanger", "pressure vessel", "bearing",
    "temperature", "vibration", "corrosion", "thickness", "wear",
    "why did", "why is", "how does", "how do", "what happened",
    "risk", "severity", "recommendation", "approve", "sign off",
    "approval note", "report", "audit", "retrieved context",
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a question as DOCUMENT, CODING, VISION, or GENERAL using deterministic keyword matching.
 * No LLM call — O(n) string search, adds < 1 ms overhead.
 *
 * @param {string} question
 * @param {object} options
 * @returns {"DOCUMENT" | "CODING" | "VISION" | "GENERAL"}
 */
export function classifyTask(question, options = {}) {
    if (options && (options.hasImage || options.image)) {
        return TASK_TYPE.VISION;
    }

    if (typeof question !== "string" || !question.trim()) {
        return TASK_TYPE.GENERAL;
    }

    const q = question.toLowerCase();

    // 1. Coding check first — explicit and unambiguous
    for (const kw of CODING_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.CODING;
        }
    }

    // 2. Vision keyword check
    for (const kw of VISION_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.VISION;
        }
    }

    // 3. Document check
    for (const kw of DOCUMENT_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.DOCUMENT;
        }
    }

    return TASK_TYPE.GENERAL;
}

// ─── Model Registry & Allowlist ───────────────────────────────────────────────

/**
 * Read the model registry from environment variables.
 * All values fall back to OLLAMA_MODEL so the router remains fully operational.
 */
export function getModelRegistry() {
    const defaultModel  = process.env.DEFAULT_MODEL   || process.env.OLLAMA_MODEL || "llama3.2:3b";
    const documentModel = process.env.DOCUMENT_MODEL  || defaultModel;
    const codingModel   = process.env.CODING_MODEL    || defaultModel;
    const visionModel   = process.env.VISION_MODEL    || "moondream";

    const codingFallbackEnabled =
        (process.env.CODING_MODEL_FALLBACK || "true").toLowerCase() !== "false";

    return {
        [TASK_TYPE.DOCUMENT]: documentModel,
        [TASK_TYPE.CODING]:   codingModel,
        [TASK_TYPE.VISION]:   visionModel,
        [TASK_TYPE.GENERAL]:  defaultModel,
        defaultModel,
        visionModel,
        codingFallbackEnabled,
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
        registry[TASK_TYPE.DOCUMENT],
        registry[TASK_TYPE.CODING],
        registry[TASK_TYPE.VISION],
        registry[TASK_TYPE.GENERAL],
        "llama3.2:3b",
        "llama3.2",
        "moondream",
        "moondream:latest",
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
    const allowed = getAllowedModels();
    const trimmed = modelName.trim();
    const base = trimmed.split(":")[0];
    for (const m of allowed) {
        if (m === trimmed || m.split(":")[0] === base) {
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

export async function checkModelAvailability(modelName) {
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

    try {
        const res = await fetchOllamaTags(ollamaUrl);

        if (!res.ok) return false;

        const data = await res.json();
        const installed = Array.isArray(data.models)
            ? data.models.map((m) => m.name)
            : [];

        const base = modelName.split(":")[0];
        return installed.some(
            (m) => m === modelName || m.startsWith(base + ":")
        );
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
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";

    try {
        const res = await fetchOllamaTags(ollamaUrl);

        if (!res.ok) return [];

        const data = await res.json();
        return Array.isArray(data.models)
            ? data.models.map((m) => ({ name: m.name, size: m.size }))
            : [];
    } catch {
        return [];
    }
}

// ─── Router ───────────────────────────────────────────────────────────────────

/**
 * Classify a question and select the appropriate local Ollama model.
 *
 * Returns a routing decision object:
 * {
 *   taskType:      "DOCUMENT" | "CODING" | "VISION" | "GENERAL"
 *   selectedModel: string          — model name to use
 *   routingReason: string          — human-readable explanation
 *   isFallback:    boolean         — true when preferred model unavailable
 *   registryModel: string          — the configured model
 *   latencyMs:     number          — decision duration in milliseconds
 * }
 *
 * @param {string} question
 * @param {object} options
 * @returns {Promise<{taskType: string, selectedModel: string, routingReason: string, isFallback: boolean, registryModel: string, latencyMs: number}>}
 */
export async function routeTask(question, options = {}) {
    const tStart = Date.now();
    console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.started", task: options.hasImage ? "VISION" : "TEXT" })}`);

    // Model allowlist check on client override
    if (options.model) {
        if (!isModelAllowed(options.model)) {
            console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "model_not_allowed", model: options.model })}`);
            throw new RouterError(
                `Requested model '${options.model}' is not in the sovereign model allowlist.`
            );
        }
    }

    const taskType = classifyTask(question, options);
    console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.classified", taskType, questionPreview: typeof question === 'string' ? question.slice(0, 50) : null })}`);

    const registry = getModelRegistry();
    const registryModel = options.model || registry[taskType];
    const defaultModel  = registry.defaultModel;

    // Check whether the configured model is installed
    const isAvailable = await checkModelAvailability(registryModel);

    if (isAvailable) {
        const latencyMs = Date.now() - tStart;
        console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.model_selected", taskType, selectedModel: registryModel, latencyMs, isFallback: false })}`);
        return {
            taskType,
            selectedModel: registryModel,
            routingReason: routingReason(taskType, registryModel, false),
            isFallback:    false,
            registryModel,
            latencyMs,
        };
    }

    // Model not installed ─────────────────────────────────────────────────────
    if (taskType === TASK_TYPE.VISION) {
        console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "vision_model_unavailable", model: registryModel })}`);
        throw new RouterError(
            `Configured local vision model '${registryModel}' is not available in Ollama. ` +
            `Run: ollama pull ${registryModel}`
        );
    }

    if (registryModel === defaultModel) {
        console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "default_model_unavailable", model: registryModel })}`);
        throw new RouterError(
            `Configured local model '${registryModel}' is not available in Ollama. ` +
            `Run: ollama pull ${registryModel}`
        );
    }

    if (registry.codingFallbackEnabled && taskType === TASK_TYPE.CODING) {
        // Fallback: use default model and surface explicit isFallback flag
        const defaultAvailable = await checkModelAvailability(defaultModel);

        if (!defaultAvailable) {
            console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "coding_and_fallback_unavailable", model: registryModel, fallback: defaultModel })}`);
            throw new RouterError(
                `Configured coding model '${registryModel}' is unavailable and ` +
                `fallback model '${defaultModel}' is also unavailable. ` +
                `Run: ollama pull ${defaultModel}`
            );
        }

        const latencyMs = Date.now() - tStart;
        console.log(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.model_selected", taskType, selectedModel: defaultModel, latencyMs, isFallback: true })}`);
        return {
            taskType,
            selectedModel: defaultModel,
            routingReason: `Coding model '${registryModel}' is not installed. Falling back to '${defaultModel}'.`,
            isFallback:    true,
            registryModel,
            latencyMs,
        };
    }

    // No fallback configured — return a clean error
    console.warn(`[ROUTER-AUDIT] ${JSON.stringify({ event: "router.failed", reason: "model_unavailable", model: registryModel })}`);
    throw new RouterError(
        `Configured local model '${registryModel}' is not available in Ollama. ` +
        `Run: ollama pull ${registryModel}  (or set CODING_MODEL_FALLBACK=true)`
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function routingReason(taskType, model, isFallback) {
    const labels = {
        [TASK_TYPE.DOCUMENT]: "Document / RAG analysis request",
        [TASK_TYPE.CODING]:   "Code generation request",
        [TASK_TYPE.VISION]:   "Multimodal visual inspection & document understanding",
        [TASK_TYPE.GENERAL]:  "General query — routed to default model",
    };
    return isFallback
        ? `Fallback: ${labels[taskType] || taskType}`
        : labels[taskType] || taskType;
}

export class RouterError extends Error {
    constructor(message) {
        super(message);
        this.name = "RouterError";
    }
}
