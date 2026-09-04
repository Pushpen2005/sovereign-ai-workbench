/**
 * PR #26 — Agent Tool Registry
 *
 * Central whitelist and executor for all local tools.
 * HARD SECURITY BOUNDARY:
 *   - The LLM can NEVER execute arbitrary functions by name.
 *   - Only registered tools in this map can be called.
 *   - Input arguments are validated before execution.
 */

import { executeCalculator } from "./calculator.tool.js";
import { executeDocumentSearch } from "./documentSearch.tool.js";
import { executeFileRead } from "./fileRead.tool.js";
import { executeSandboxCode } from "./sandboxCode.tool.js";
import { executeDocumentGenerate } from "./documentGenerate.tool.js";
import { generateVisionAnswer } from "../../../../ai-service/llm/llm.service.js";
import { routeTask } from "../../../../ai-service/router/modelRouter.js";

export class ToolRegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = "ToolRegistryError";
    }
}

/**
 * Optional tool: analyze_image
 */
async function executeAnalyzeImage(args) {
    if (!args || typeof args !== "object") {
        throw new Error("Arguments must be an object with 'imageBase64' or 'imageReference'");
    }

    const { prompt = "Analyze this industrial image.", imageBase64 } = args;

    if (!imageBase64 || typeof imageBase64 !== "string") {
        throw new Error("imageBase64 must be a non-empty base64 string");
    }

    // Verify vision model availability
    const routing = await routeTask(prompt, { hasImage: true });

    const answer = await generateVisionAnswer(prompt, imageBase64, routing.selectedModel);
    return {
        model: routing.selectedModel,
        analysis: answer,
    };
}

export const TOOL_REGISTRY = {
    document_search: {
        name: "document_search",
        description: "Search internal documents and safety SOPs in the vector knowledge base (Qdrant). Returns relevant text chunks with source filename, page, and chunk index.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Semantic search query string" },
                limit: { type: "number", description: "Maximum chunks to return (1-10, default 5)" },
            },
            required: ["query"],
        },
        execute: executeDocumentSearch,
    },

    file_read: {
        name: "file_read",
        description: "Read an indexed document's metadata and extracted text excerpts by documentId or filename. Path traversal is strictly prohibited.",
        parameters: {
            type: "object",
            properties: {
                documentId: { type: "string", description: "The UUID or identifier of the document to read" },
                maxChunks: { type: "number", description: "Maximum chunks to read (1-10, default 5)" },
            },
            required: ["documentId"],
        },
        execute: executeFileRead,
    },

    calculator: {
        name: "calculator",
        description: "Perform safe, deterministic arithmetic calculations and mathematical functions (sqrt, abs, round, etc.). Zero eval(), zero code execution.",
        parameters: {
            type: "object",
            properties: {
                expression: { type: "string", description: "Mathematical expression to evaluate (e.g. '1250 * 0.08' or '25 * 4')" },
            },
            required: ["expression"],
        },
        execute: executeCalculator,
    },

    execute_sandbox_code: {
        name: "execute_sandbox_code",
        description: "Execute Python code inside an isolated, network-disabled Docker sandbox with resource and time limits. Returns stdout, stderr, and exitCode.",
        parameters: {
            type: "object",
            properties: {
                code: { type: "string", description: "Python code to execute in sandbox" },
                language: { type: "string", enum: ["python"], description: "Programming language (only 'python')" },
            },
            required: ["code"],
        },
        execute: executeSandboxCode,
    },

    document_generate: {
        name: "document_generate",
        description: "Compile an official, audit-ready Approval Note (.docx) report deliverable containing structured findings, risk analysis, and recommendations.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Title or subject of the document" },
                sections: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            heading: { type: "string" },
                            content: { type: "string" },
                        },
                        required: ["heading", "content"],
                    },
                    description: "Structured document sections",
                },
            },
            required: ["sections"],
        },
        execute: executeDocumentGenerate,
    },

    analyze_image: {
        name: "analyze_image",
        description: "Perform on-premise multimodal visual inspection of an industrial image using the local vision model.",
        parameters: {
            type: "object",
            properties: {
                imageBase64: { type: "string", description: "Base64-encoded image string" },
                prompt: { type: "string", description: "Inspection query for the vision model" },
            },
            required: ["imageBase64"],
        },
        execute: executeAnalyzeImage,
    },
};

/**
 * Returns formatted tool definitions prompt for LLM system instructions.
 *
 * @returns {string}
 */
export function getToolDefinitionsPrompt() {
    return Object.values(TOOL_REGISTRY)
        .map((t) => {
            return `Tool: "${t.name}"\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.parameters)}`;
        })
        .join("\n\n");
}

/**
 * Validates and executes a registered tool safely.
 *
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<{ status: "success" | "error", result?: any, error?: string, durationMs: number }>}
 */
export async function executeRegisteredTool(toolName, args = {}, context = {}) {
    const startTime = Date.now();

    if (typeof toolName !== "string" || !toolName.trim()) {
        return {
            status: "error",
            error: "Missing or invalid tool name",
            durationMs: 0,
        };
    }

    const cleanName = toolName.trim().toLowerCase();
    const tool = TOOL_REGISTRY[cleanName];

    if (!tool) {
        return {
            status: "error",
            error: `Unauthorized or unknown tool '${cleanName}'. Available tools: ${Object.keys(TOOL_REGISTRY).join(", ")}`,
            durationMs: 0,
        };
    }

    try {
        const result = await tool.execute(args, context);
        return {
            status: "success",
            result,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        return {
            status: "error",
            error: err.message,
            durationMs: Date.now() - startTime,
        };
    }
}
