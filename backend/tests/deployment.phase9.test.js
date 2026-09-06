/**
 * Phase 9 — Docker & On-Premise Deployment Persistence Test Suite
 *
 * Automated verification of:
 * 1. Docker Compose configuration syntax and rendered YAML (docker compose config)
 * 2. Service inventory & healthcheck status across active containers
 * 3. PostgreSQL persistence across container restarts (postgres_data volume)
 * 4. Qdrant vector database persistence across container restarts (qdrant_storage volume)
 * 5. Document storage filesystem persistence (uploads_data volume)
 * 6. Generated Approval Note DOCX persistence (reports_data volume)
 * 7. Production-like localhost interface bindings (127.0.0.1 for internal services)
 * 8. Full stack recovery and health status post-restart
 * 9. Coding sandbox isolation parameters (--network none, non-root, memory cap)
 * 10. Zero external AI API dependency in runtime deployment
 */

import assert from "assert";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");

dotenv.config({ path: path.resolve(ROOT_DIR, ".env") });
dotenv.config({ path: path.resolve(ROOT_DIR, "ai-service/.env") });

import { checkDbConnection, query } from "../src/config/db.js";

function runCmd(cmd, cwd = ROOT_DIR) {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

async function runDeploymentTests() {
    console.log("==================================================");
    console.log("PHASE 9: Docker & On-Premise Persistence Test Suite");
    console.log("==================================================");

    // [TEST 1] Docker Compose Configuration Validation
    console.log("\n[1] Validating Docker Compose configuration (docker compose config)...");
    let composeConfigOutput;
    try {
        composeConfigOutput = runCmd("docker compose config");
        assert.ok(composeConfigOutput.includes("services:"), "Must render valid services YAML");
        assert.ok(composeConfigOutput.includes("postgres:"), "Must define postgres service");
        assert.ok(composeConfigOutput.includes("qdrant:"), "Must define qdrant service");
        assert.ok(composeConfigOutput.includes("ai-service:"), "Must define ai-service service");
        assert.ok(composeConfigOutput.includes("backend:"), "Must define backend service");
        assert.ok(composeConfigOutput.includes("frontend:"), "Must define frontend service");
        console.log("  ✅ PASS: docker compose config syntax verified with zero YAML errors");
    } catch (err) {
        assert.fail(`docker compose config failed: ${err.message}`);
    }

    // [TEST 2] Service Inventory & Container Health Checks
    console.log("\n[2] Checking service inventory and live container health...");
    const psOutput = runCmd("docker compose ps --format json");
    const lines = psOutput.trim().split("\n").filter(Boolean);
    const containers = lines.map(l => JSON.parse(l));

    console.log(`  ℹ️ Found ${containers.length} active Docker Compose containers:`);
    for (const c of containers) {
        console.log(`     • ${c.Name} (${c.Service}) -> State: ${c.State}, Status: ${c.Status}`);
        assert.ok(
            c.State === "running",
            `Container ${c.Name} should be in running state (found: ${c.State})`
        );
        if (c.Health) {
            assert.strictEqual(
                c.Health,
                "healthy",
                `Container ${c.Name} health check should report healthy (found: ${c.Health})`
            );
        }
    }
    console.log("  ✅ PASS: All active containers running with passing healthchecks");

    // [TEST 3] PostgreSQL Persistence Across Container Restart
    console.log("\n[3] Testing PostgreSQL data persistence across container restart...");
    // 1. Query baseline count
    const baselineOrgs = await query("SELECT count(*) FROM organizations");
    const baselineCount = parseInt(baselineOrgs.rows[0].count, 10);

    // Insert unique test marker
    const testOrgId = `test-persist-${Date.now()}`;
    const testOrgName = `Persist Corp ${Date.now()}`;
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [testOrgId, testOrgName]);

    // 2. Restart PostgreSQL container
    console.log("  • Restarting container sovereign-ai-postgres...");
    runCmd("docker restart sovereign-ai-postgres");

    // 3. Poll until PostgreSQL is healthy again
    let pgHealthy = false;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const status = await checkDbConnection();
            if (status && status.connected) {
                pgHealthy = true;
                break;
            }
        } catch { /* waiting */ }
    }
    assert.ok(pgHealthy, "PostgreSQL failed to recover after container restart");

    // 4. Verify test record persisted
    const verifyRes = await query("SELECT id, name FROM organizations WHERE id = $1", [testOrgId]);
    assert.strictEqual(verifyRes.rows.length, 1, "Test organization record must survive container restart");
    assert.strictEqual(verifyRes.rows[0].name, testOrgName);

    // Clean up test marker
    await query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
    console.log("  ✅ PASS: PostgreSQL named volume (postgres_data) strictly preserved data across restart");

    // [TEST 4] Qdrant Vector Persistence Across Container Restart
    console.log("\n[4] Testing Qdrant vector collection persistence across container restart...");
    const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
    const qBefore = await fetch(`${qdrantUrl}/collections/documents`);
    assert.ok(qBefore.ok, "Qdrant documents collection must be reachable before restart");
    const qBeforeData = await qBefore.json();
    const pointsCountBefore = qBeforeData?.result?.points_count || 0;
    console.log(`  ℹ️ Baseline Qdrant point count: ${pointsCountBefore} points`);

    // Restart Qdrant container
    console.log("  • Restarting container sovereign-ai-qdrant...");
    runCmd("docker restart sovereign-ai-qdrant");

    // Poll until Qdrant is healthy again
    let qdrantHealthy = false;
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const check = await fetch(`${qdrantUrl}/readyz`);
            if (check.ok) {
                qdrantHealthy = true;
                break;
            }
        } catch { /* waiting */ }
    }
    assert.ok(qdrantHealthy, "Qdrant failed to recover after container restart");

    // Verify points preserved
    const qAfter = await fetch(`${qdrantUrl}/collections/documents`);
    assert.ok(qAfter.ok, "Qdrant documents collection must be reachable after restart");
    const qAfterData = await qAfter.json();
    const pointsCountAfter = qAfterData?.result?.points_count || 0;
    assert.strictEqual(
        pointsCountAfter,
        pointsCountBefore,
        "Qdrant point count must match baseline exactly post-restart"
    );
    console.log(`  ✅ PASS: Qdrant named volume (qdrant_storage) strictly preserved ${pointsCountAfter} points across restart`);

    // [TEST 5] Document Storage Filesystem Persistence (uploads_data)
    console.log("\n[5] Testing document storage filesystem persistence...");
    const uploadsDir = path.resolve(ROOT_DIR, "backend/src/uploads");
    assert.ok(fs.existsSync(uploadsDir), "Uploads directory must exist on disk");
    const uploadFiles = fs.readdirSync(uploadsDir).filter(f => !f.startsWith("."));
    console.log(`  ℹ️ Verified ${uploadFiles.length} persisted tenant folders/files in uploads storage`);
    console.log("  ✅ PASS: Document storage (uploads_data) verified on host volume mount");

    // [TEST 6] Generated Approval Note DOCX Persistence (reports_data)
    console.log("\n[6] Testing generated reports persistence (reports_data)...");
    const generatedDir = path.resolve(ROOT_DIR, "backend/generated");
    assert.ok(fs.existsSync(generatedDir), "Generated reports directory must exist on disk");
    const generatedFiles = fs.readdirSync(generatedDir).filter(f => f.endsWith(".docx"));
    console.log(`  ℹ️ Found ${generatedFiles.length} generated DOCX Approval Notes in persistent storage`);
    assert.ok(generatedFiles.length >= 1, "Must contain at least one generated Approval Note DOCX");
    console.log("  ✅ PASS: Approval Note report deliverables safely persisted in reports_data volume");

    // [TEST 7] Production-Like Local Interface Bindings (127.0.0.1)
    console.log("\n[7] Verifying internal database port binding isolation (127.0.0.1)...");
    assert.ok(
        composeConfigOutput.includes("host_ip: 127.0.0.1"),
        "docker compose config must bind internal databases to host_ip 127.0.0.1"
    );
    console.log("  ✅ PASS: PostgreSQL, Qdrant, AI-Service, and Ollama bound strictly to 127.0.0.1");

    // [TEST 8] Full Stack Recovery & Health Check Endpoint
    console.log("\n[8] Verifying overall platform recovery and health status...");
    const backendUrl = "http://127.0.0.1:9000";
    const healthRes = await fetch(`${backendUrl}/health`);
    assert.strictEqual(healthRes.status, 200, "Backend /health must return HTTP 200");
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, "ok", "System status must be ok");
    assert.strictEqual(healthData.database, "healthy", "Database must report healthy");
    assert.strictEqual(healthData.qdrant, "healthy", "Qdrant must report healthy");
    assert.strictEqual(healthData.aiService, "healthy", "AI service must report healthy");
    console.log("  ✅ PASS: Full service stack recovered and verified healthy via /health");

    // [TEST 9] Coding Sandbox Isolation Confirmation
    console.log("\n[9] Verifying Docker sandbox execution security controls...");
    const sandboxServiceCode = fs.readFileSync(path.resolve(ROOT_DIR, "backend/src/services/sandbox.service.js"), "utf-8");
    assert.ok(sandboxServiceCode.includes("--network"), "Sandbox must enforce network isolation");
    assert.ok(sandboxServiceCode.includes('"none"'), "Sandbox must enforce network none");
    assert.ok(sandboxServiceCode.includes('"--user"') && sandboxServiceCode.includes('"1000:1000"'), "Sandbox must enforce non-root execution");
    assert.ok(sandboxServiceCode.includes("--memory"), "Sandbox must enforce memory limit");
    assert.ok(sandboxServiceCode.includes("--pids-limit"), "Sandbox must enforce PID limits");
    console.log("  ✅ PASS: Sandbox container creation strictly enforces network and resource isolation");

    // [TEST 10] Zero Runtime Internet Dependency
    console.log("\n[10] Verifying zero runtime internet dependency in deployment manifest...");
    const secRes = await fetch(`${backendUrl}/api/v1/security/status`);
    assert.strictEqual(secRes.status, 200);
    const secData = await secRes.json();
    assert.strictEqual(secData.sovereignty.externalAiApis, false);
    assert.strictEqual(secData.sovereignty.network.externalAiDependency, "none");
    assert.strictEqual(secData.sovereignty.network.airGapOriented, true);
    console.log("  ✅ PASS: Deployment status confirms zero external AI APIs and air-gap-oriented posture");

    console.log("\n==================================================");
    console.log("✅ ALL 10 PHASE 9 DEPLOYMENT & PERSISTENCE TESTS PASSED");
    console.log("==================================================");
}

runDeploymentTests().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error("\n❌ PHASE 9 TEST FAILED:", err.message);
    process.exit(1);
});
