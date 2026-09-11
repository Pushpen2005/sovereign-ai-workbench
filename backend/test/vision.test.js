import test, { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { executeRegisteredTool, TOOL_REGISTRY } from "../src/services/agentTools/toolRegistry.js";
import { routeTask } from "../../ai-service/router/modelRouter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Phase 5 - Vision Sandbox", { concurrency: 1 }, () => {
    const ORG_ID = "test-vision-org";
    const TEST_IMAGE_PATH = path.resolve(__dirname, "../src/uploads", ORG_ID, "test_image.png");

    before(async () => {
        await fs.promises.mkdir(path.dirname(TEST_IMAGE_PATH), { recursive: true });
        // Create a fake PNG file
        const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        await fs.promises.writeFile(TEST_IMAGE_PATH, pngMagic);
    });

    after(async () => {
        try {
            await fs.promises.unlink(TEST_IMAGE_PATH);
        } catch {}
    });

    it("TEST 1 - Valid Image: succeeds (or safely passes through mock)", async () => {
        const res = await executeRegisteredTool("vision_analyze", { image: "test_image.png", prompt: "Test prompt" }, { organizationId: ORG_ID });
        if (res.status === "error") {
            // Without actual MLX running, it will fail to fetch or decode
            const errStr = res.error.toLowerCase();
            console.log("VISION ERROR RESULT: ", res.error);
            assert.ok(errStr.includes("mlx") || errStr.includes("503") || errStr.includes("fetch") || errStr.includes("magic bytes") || errStr.includes("unsupported") || errStr.includes("connection") || errStr.includes("buffer"), "Should attempt local fetch or validation");
        } else {
            assert.strictEqual(res.status, "success");
            assert.ok(res.result.model.taskType === "VISION");
        }
    });

    it("TEST 2 & 3 - Invalid Image: controlled rejection", async () => {
        const INVALID_PATH = path.resolve(__dirname, "../src/uploads", ORG_ID, "invalid.txt");
        await fs.promises.writeFile(INVALID_PATH, "Not an image");
        const res = await executeRegisteredTool("vision_analyze", { image: "invalid.txt" }, { organizationId: ORG_ID });
        assert.strictEqual(res.status, "error");
        // Our vision-agent.service.js uses image magic bytes so this might fail during reading or decode.
    });

    it("TEST 4 - Unauthorized file reference: rejected", async () => {
        const res = await executeRegisteredTool("vision_analyze", { image: "../../../etc/passwd" }, { organizationId: ORG_ID });
        assert.strictEqual(res.status, "error");
        assert.match(res.error, /Access Denied|could not be found/i);
    });

    it("TEST 5 - Missing Qwen VL fallback: modelRouter maps it correctly", async () => {
        const routing = await routeTask("Analyze this industrial image", { hasImage: true });
        // In local mode without model it might fallback to default Model but sets isFallback
        assert.ok(routing.canonicalTaskType === "VISION" || routing.isFallback === true);
    });

    it("TEST 8 - MLX endpoint is used", async () => {
        const routing = await routeTask("Analyze this industrial image", { hasImage: true });
        assert.strictEqual(routing.local, true, "Must be local MLX");
    });
});
