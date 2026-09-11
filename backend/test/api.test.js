import test, { describe, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import app from "../src/app.js";

describe("Phase 1 - Backend API Standardization", () => {
    describe("Health & Global Middleware", () => {
        it("GET /api/v1/health should return standardized health format", async () => {
            const res = await request(app).get("/api/v1/health");
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.status, "ok");
            assert.strictEqual(res.body.backend, "healthy");
        });

        it("should include x-request-id in headers", async () => {
            const res = await request(app).get("/api/v1/health");
            assert.ok(res.headers["x-request-id"]);
        });
    });

    describe("Error Handling & Validation", () => {
        it("should return standardized error for invalid agent task", async () => {
            const res = await request(app).get("/api/v1/nonexistent_route");
            assert.strictEqual(res.status, 404);
            assert.strictEqual(res.body.success, false);
            assert.ok(res.body.error);
            assert.strictEqual(res.body.error.code, "NOT_FOUND");
        });
    });
});
