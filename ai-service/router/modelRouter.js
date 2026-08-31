/**
 * PR #23 — Model Router
 *
 * Classifies every incoming request as DOCUMENT, CODING, or GENERAL
 * using a fast, deterministic keyword classifier (no LLM call overhead).
 * Selects the appropriate local Ollama model from the registry and
 * verifies it is installed before returning a routing decision.
 *
 * Model registry is driven entirely by environment variables so a second
 * model (e.g. qwen2.5-coder:7b) can be added without code changes.
 */

// ─── Task Types ───────────────────────────────────────────────────────────────

export const TASK_TYPE = Object.freeze({
    DOCUMENT: "DOCUMENT",
    CODING:   "CODING",
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
    "generate code", "create a function", "create a script", "create a class",
    "implement a function", "implement an algorithm", "implement this in",
    // language / framework names combined with action
    "in python", "in javascript", "in typescript", "in java", "in c++",
    "in sql", "in bash", "in node", "in react",
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
 * Document-task indicators — signals the user is asking about ingested content.
 * Used as the default when coding indicators are absent.
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
    "approval note", "report", "audit",
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a question as DOCUMENT, CODING, or GENERAL using keyword matching.
 * No LLM call — O(n) string search, adds < 1 ms overhead.
 *
 * @param {string} question
 * @returns {"DOCUMENT" | "CODING" | "GENERAL"}
 */
export function classifyTask(question) {
    if (typeof question !== "string" || !question.trim()) {
        return TASK_TYPE.GENERAL;
    }

    const q = question.toLowerCase();

    // Coding check first — explicit and unambiguous
    for (const kw of CODING_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.CODING;
        }
    }

    // Document check
    for (const kw of DOCUMENT_KEYWORDS) {
        if (q.includes(kw)) {
            return TASK_TYPE.DOCUMENT;
        }
    }

    return TASK_TYPE.GENERAL;
}

// ─── Model Registry ───────────────────────────────────────────────────────────

/**
 * Read the model registry from environment variables.
 * All values fall back to OLLAMA_MODEL (the existing default) so the
 * router is a no-op until a second model is configured.
 */
function getModelRegistry() {
    const defaultModel  = process.env.DEFAULT_MODEL   || process.env.OLLAMA_MODEL || "llama3.2:3b";
    const documentModel = process.env.DOCUMENT_MODEL  || defaultModel;
    const codingModel   = process.env.CODING_MODEL    || defaultModel;

    // "true" or "1" enables silent fallback to DEFAULT_MODEL when CODING_MODEL
    // is configured but not currently installed in Ollama.
    const codingFallbackEnabled =
        (process.env.CODING_MODEL_FALLBACK || "true").toLowerCase() !== "false";

    return {
        [TASK_TYPE.DOCUMENT]: documentModel,
        [TASK_TYPE.CODING]:   codingModel,
        [TASK_TYPE.GENERAL]:  defaultModel,
        defaultModel,
        codingFallbackEnabled,
    };
}

// ─── Availability Check ───────────────────────────────────────────────────────

/**
 * Query the local Ollama API to determine whether a specific model is
 * currently installed.  Returns false on any network / parse error so
 * callers can implement fallback logic rather than crashing.
 *
 * @param {string} modelName
 * @returns {Promise<boolean>}
 */
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

        // Accept both "llama3.2:3b" and "llama3.2" as a match
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
 * @returns {Promise<string[]>}
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
 *   taskType:      "DOCUMENT" | "CODING" | "GENERAL"
 *   selectedModel: string          — model name to use
 *   routingReason: string          — human-readable explanation
 *   isFallback:    boolean         — true when preferred model unavailable
 *   registryModel: string          — the configured (not necessarily installed) model
 * }
 *
 * @param {string} question
 * @returns {Promise<{taskType: string, selectedModel: string, routingReason: string, isFallback: boolean, registryModel: string}>}
 */
export async function routeTask(question) {
    const taskType = classifyTask(question);
    const registry = getModelRegistry();

    const registryModel = registry[taskType];
    const defaultModel  = registry.defaultModel;

    // Check whether the configured model is installed
    const isAvailable = await checkModelAvailability(registryModel);

    if (isAvailable) {
        return {
            taskType,
            selectedModel: registryModel,
            routingReason: routingReason(taskType, registryModel, false),
            isFallback:    false,
            registryModel,
        };
    }

    // Model not installed ─────────────────────────────────────────────────────
    if (registryModel === defaultModel) {
        // The registry model IS the default — if it's not available, hard error
        throw new RouterError(
            `Configured local model '${registryModel}' is not available in Ollama. ` +
            `Run: ollama pull ${registryModel}`
        );
    }

    if (registry.codingFallbackEnabled && taskType === TASK_TYPE.CODING) {
        // Fallback: use default model and surface explicit isFallback flag
        const defaultAvailable = await checkModelAvailability(defaultModel);

        if (!defaultAvailable) {
            throw new RouterError(
                `Configured coding model '${registryModel}' is unavailable and ` +
                `fallback model '${defaultModel}' is also unavailable. ` +
                `Run: ollama pull ${defaultModel}`
            );
        }

        return {
            taskType,
            selectedModel: defaultModel,
            routingReason: `Coding model '${registryModel}' is not installed. Falling back to '${defaultModel}'.`,
            isFallback:    true,
            registryModel,
        };
    }

    // No fallback configured — return a clean error
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
