/**
 * PR #26 — Autonomous Agent Tool Orchestration Test Suite
 *
 * Validates:
 *   1. Tool Registry & Whitelist Enforcement
 *   2. Calculator Tool (Deterministic Safe AST Math, zero eval, zero code exec)
 *   3. File Read Tool (Security boundaries, path traversal rejection)
 *   4. Document Search Tool (Vector retrieval & input validation)
 *   5. Sandbox Code Tool (PR #24 Docker container integration)
 *   6. Document Generate Tool (DOCX deliverable compilation)
 *   7. Action Parsing, JSON Repair & Step Bounded Execution
 *   8. Multi-Step Agent Demonstrations
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
    TOOL_REGISTRY,
    executeRegisteredTool,
} from "../src/services/agentTools/toolRegistry.js";
import { executeCalculator, CalculatorError } from "../src/services/agentTools/calculator.tool.js";
import { executeFileRead, FileReadError } from "../src/services/agentTools/fileRead.tool.js";
import { executeDocumentSearch, DocumentSearchError } from "../src/services/agentTools/documentSearch.tool.js";
import { executeSandboxCode, SandboxCodeError } from "../src/services/agentTools/sandboxCode.tool.js";
import { executeDocumentGenerate } from "../src/services/agentTools/documentGenerate.tool.js";
import { parseActionJSON, runAgentLoop } from "../src/services/agent.service.js";

console.log("==================================================");
console.log("PR #26: Autonomous Agent Tool Orchestration Tests");
console.log("==================================================\n");

let passed = 0;
let failed = 0;

function report(testName, ok, detail = "") {
    if (ok) {
        console.log(`  ✅ PASS: ${testName}${detail ? ` — ${detail}` : ""}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${testName}${detail ? ` — ${detail}` : ""}`);
        failed++;
    }
}

// ─── 1. Tool Registry & Whitelist ─────────────────────────────────────────────
console.log("[1] Tool Registry & Whitelist Enforcement");

const expectedTools = ["document_search", "file_read", "calculator", "execute_sandbox_code", "document_generate"];
for (const toolName of expectedTools) {
    report(`Tool '${toolName}' registered`, Boolean(TOOL_REGISTRY[toolName]));
}

// Rejection of unknown tool
const unknownRes = await executeRegisteredTool("arbitrary_bash_command", { cmd: "rm -rf /" });
report(
    "Unknown / unwhitelisted tool execution rejected",
    unknownRes.status === "error" && unknownRes.error.includes("Unauthorized or unknown tool"),
    unknownRes.error
);

// ─── 2. Safe Calculator Tool (Zero eval) ───────────────────────────────────────
console.log("\n[2] Safe Calculator Tool (Zero eval, Safe AST Parser)");

// 2.1 Basic arithmetic
const calc1 = await executeCalculator({ expression: "1250 * 0.08" });
report("Basic multiplication (1250 * 0.08 = 100)", calc1.result === 100, `got ${calc1.result}`);

// 2.2 Operator precedence & parentheses
const calc2 = await executeCalculator({ expression: "(25 + 15) * 2 / 8" });
report("Precedence & parentheses ((25 + 15) * 2 / 8 = 10)", calc2.result === 10, `got ${calc2.result}`);

// 2.3 Exponentiation
const calc3 = await executeCalculator({ expression: "2 ** 8 + 4 ^ 2" });
report("Exponentiation (2 ** 8 + 4 ^ 2 = 272)", calc3.result === 272, `got ${calc3.result}`);

// 2.4 Safe functions
const calc4 = await executeCalculator({ expression: "sqrt(144) + abs(-18)" });
report("Safe functions sqrt(144) + abs(-18) = 30", calc4.result === 30, `got ${calc4.result}`);

// 2.5 Division by zero error
try {
    await executeCalculator({ expression: "100 / 0" });
    report("Division by zero throws CalculatorError", false, "did not throw");
} catch (err) {
    report("Division by zero throws CalculatorError", err instanceof CalculatorError, err.message);
}

// 2.6 Malicious identifier injection rejected
try {
    await executeCalculator({ expression: "process.exit(1)" });
    report("Arbitrary identifier process.exit rejected", false, "did not throw");
} catch (err) {
    report("Arbitrary identifier rejected", err instanceof CalculatorError && err.message.includes("Unauthorized identifier"), err.message);
}

// 2.7 eval() / JavaScript execution attempt rejected
try {
    await executeCalculator({ expression: "eval('2 + 2')" });
    report("eval() call rejected", false, "did not throw");
} catch (err) {
    report("eval() call rejected", err instanceof CalculatorError, err.message);
}

// ─── 3. File Read Security & Path Traversal ───────────────────────────────────
console.log("\n[3] File Read Tool Security Boundary");

// 3.1 Path traversal /etc/passwd rejected
try {
    await executeFileRead({ documentId: "/etc/passwd" });
    report("Path traversal /etc/passwd rejected", false, "did not throw");
} catch (err) {
    report("Path traversal /etc/passwd rejected", err instanceof FileReadError && err.message.includes("Access Denied"), err.message);
}

// 3.2 Directory traversal ../../secrets.env rejected
try {
    await executeFileRead({ documentId: "../../secrets.env" });
    report("Directory traversal ../../secrets.env rejected", false, "did not throw");
} catch (err) {
    report("Directory traversal ../../secrets.env rejected", err instanceof FileReadError && err.message.includes("Access Denied"), err.message);
}

// ─── 4. Document Search Input Validation ──────────────────────────────────────
console.log("\n[4] Document Search Tool Input Validation");

// 4.1 Empty query rejected
try {
    await executeDocumentSearch({ query: "" });
    report("Empty query rejected", false, "did not throw");
} catch (err) {
    report("Empty query rejected", err instanceof DocumentSearchError, err.message);
}

// 4.2 Non-string argument rejected
try {
    await executeDocumentSearch({ query: 12345 });
    report("Non-string query rejected", false, "did not throw");
} catch (err) {
    report("Non-string query rejected", err instanceof DocumentSearchError, err.message);
}

// ─── 5. Sandbox Code Execution (PR #24 Integration) ───────────────────────────
console.log("\n[5] Sandbox Code Execution Tool");

const sandboxRes = await executeSandboxCode({
    code: "print(25 * 4)",
    language: "python",
});
report(
    "execute_sandbox_code calculates 25 * 4 = 100 inside isolated container",
    sandboxRes.success && sandboxRes.stdout.trim() === "100",
    `exitCode=${sandboxRes.exitCode}, stdout='${sandboxRes.stdout.trim()}'`
);

// 5.2 Non-python language rejected
try {
    await executeSandboxCode({ code: "console.log('hi')", language: "javascript" });
    report("Non-python language rejected", false, "did not throw");
} catch (err) {
    report("Non-python language rejected", err instanceof SandboxCodeError, err.message);
}

// ─── 6. Document Generate Tool (Approval Note DOCX) ───────────────────────────
console.log("\n[6] Document Generate Tool");

const docxRes = await executeDocumentGenerate({
    title: "Unit Test Approval Note",
    sections: [
        { heading: "Findings", content: "Observed vibration on Pump-P102 discharge line." },
        { heading: "Risk Assessment", content: "Risk level MEDIUM due to potential seal fatigue." },
        { heading: "Recommendation", content: "Schedule replacement of mechanical seal within 48 hours." },
    ],
});

report(
    "Approval Note DOCX generated",
    Boolean(docxRes.filename && docxRes.downloadUrl),
    `filename=${docxRes.filename}`
);

// ─── 7. Action JSON Parser & Repair ───────────────────────────────────────────
console.log("\n[7] Action JSON Parsing & Repair");

// 7.1 Parses clean JSON
const action1 = parseActionJSON('{"type": "tool_call", "tool": "calculator", "arguments": {"expression": "2+2"}}');
report("Clean JSON action parsed", action1.type === "tool_call" && action1.tool === "calculator");

// 7.2 Strips markdown fences
const action2 = parseActionJSON('```json\n{"type": "final", "answer": "Analysis complete."}\n```');
report("Markdown code block stripped", action2.type === "final" && action2.answer === "Analysis complete.");

// 7.3 Parses JSON with preamble prose
const action3 = parseActionJSON('Here is the action:\n{"type": "tool_call", "tool": "file_read", "arguments": {"documentId": "123"}}');
report("Embedded JSON extracted from surrounding text", action3.type === "tool_call" && action3.tool === "file_read");

// ─── 8. Multi-Step Demonstrations ─────────────────────────────────────────────
console.log("\n[8] Multi-Step Agent Demonstrations (Bounded Loop)");

// Demonstration 2: Direct sandbox computation
console.log("  Running Demo 2: 'Calculate 25 * 4 using Python and verify the result.'");
const demo2Res = await runAgentLoop({
    goal: "Calculate 25 * 4 using Python and verify the result.",
    maxSteps: 4,
    timeoutMs: 30000,
});

report(
    "Demo 2 executed successfully",
    demo2Res.success && demo2Res.steps.some((s) => s.tool === "execute_sandbox_code"),
    `steps=${demo2Res.totalSteps}, model=${demo2Res.model}`
);

// Demonstration 3: Document Search
console.log("  Running Demo 3: 'What does the Safety SOP say about lockout/tagout?'");
const demo3Res = await runAgentLoop({
    goal: "What does the Safety SOP say about lockout/tagout?",
    maxSteps: 4,
    timeoutMs: 30000,
});

report(
    "Demo 3 executed successfully with Qdrant retrieval",
    demo3Res.success && demo3Res.steps.some((s) => s.tool === "document_search"),
    `steps=${demo3Res.totalSteps}, sourcesCount=${demo3Res.sources.length}`
);

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log("\n==================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("==================================================");

if (failed > 0) {
    process.exit(1);
}
