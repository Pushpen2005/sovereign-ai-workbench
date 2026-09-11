import test, { describe, it } from "node:test";
import assert from "node:assert";
import { executeRegisteredTool, TOOL_REGISTRY } from "../src/services/agentTools/toolRegistry.js";

describe("Phase 6 - Agent Deliverables", { concurrency: 1 }, () => {
    it("TEST 1 - Tool Registry contains inspection_workflow", () => {
        assert.ok(TOOL_REGISTRY["inspection_workflow"]);
    });

    it("TEST 2 - Tool Registry contains document_generate", () => {
        assert.ok(TOOL_REGISTRY["document_generate"]);
    });

    it("TEST 3 - executeInspectionWorkflow rejects unauthenticated calls", async () => {
        const res = await executeRegisteredTool("inspection_workflow", { documentId: "123" });
        assert.strictEqual(res.status, "error");
        assert.match(res.error, /organizationId context is required/i);
    });

    it("TEST 4 - Artifact generation rejection without organization context", async () => {
        const res = await executeRegisteredTool("document_generate", {
            subject: "Test Note",
            inspectionFindings: [{ finding: "Corrosion" }]
        });
        assert.strictEqual(res.status, "error");
        assert.match(res.error, /Execution context missing authenticated organizationId/i);
    });
});
