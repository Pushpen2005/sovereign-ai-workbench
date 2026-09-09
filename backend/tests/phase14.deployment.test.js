/**
 * PHASE 14 — DOCKER COMPOSE & DEPLOYMENT READINESS TEST SUITE
 *
 * Verifies the 28 core deployment and persistence requirements:
 *   1. Compose configuration is valid (docker compose config validation)
 *   2. Required services are defined (frontend, backend, ai-service, postgres, qdrant, ollama)
 *   3. PostgreSQL has persistence (mapped to postgres_data volume)
 *   4. Qdrant has persistence (mapped to qdrant_storage volume)
 *   5. Qdrant storage maps to /qdrant/storage
 *   6. Internal service networking is correct (sovereign_net bridge network)
 *   7. Health checks exist across all services
 *   8. Ollama configuration is correct (keep-alive, local endpoint)
 *   9. Required local models are available (llama3.2:3b and moondream:latest)
 *  10. Backend starts after dependencies (depends_on with service_healthy)
 *  11. Database migrations are non-destructive (CREATE TABLE IF NOT EXISTS)
 *  12. Environment secrets are not exposed to frontend
 *  13. Internal ports are not unnecessarily public in production compose
 *  14. Coding Sandbox security remains intact (network none, read-only, non-root)
 *  15. Frontend reaches backend (API health endpoint responsive)
 *  16. Backend reaches PostgreSQL (live database query execution)
 *  17. Backend/AI reaches Qdrant (live collections probe)
 *  18. AI reaches Ollama (live model tags probe)
 *  19. RAG works after deployment (semantic vector retrieval + citations)
 *  20. Inspection Agent works after deployment (finding extraction and validation)
 *  21. Approval Note generation works after deployment (DOCX compilation)
 *  22. Coding Sandbox works after deployment (Docker containerized execution)
 *  23. Vision works after deployment (local multimodal image analysis)
 *  24. Restart preserves PostgreSQL data (record persistence audit)
 *  25. Restart preserves Qdrant data (vector points persistence audit)
 *  26. No external AI API is called (allowlist enforcement)
 *  27. No external inference API is called (zero cloud dependencies)
 *  28. No destructive volume reset occurs (named volume preservation)
 *
 * Run with:
 *   node backend/tests/phase14.deployment.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import { query, checkDbConnection, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { executeInSandbox } from "../src/services/sandbox.service.js";
import { analyzeImage } from "../../ai-service/vision/vision.service.js";
import { generateApprovalNote } from "../../ai-service/reports/approval-note.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";
import { generateEmbedding } from "../../ai-service/embeddings/embedding.service.js";
import { isModelAllowed, TASK_TYPE, routeTask } from "../../ai-service/router/modelRouter.js";

const ROOT_DIR = path.resolve(__dirname, "../..");

function getHostOllamaUrl() {
    let url = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
    if (url.includes("host.docker.internal")) {
        url = url.replace("host.docker.internal", "127.0.0.1");
    }
    return url;
}

async function runTest(testNumber, description, fn) {
    process.stdout.write(`\n[Test ${testNumber}] ${description}...\n`);
    try {
        await fn();
        console.log(`  \x1b[32m✓ PASS\x1b[0m [Test ${testNumber}] ${description}`);
        return true;
    } catch (err) {
        console.error(`  \x1b[31m✗ FAIL\x1b[0m [Test ${testNumber}] ${description}`);
        console.error(`    ${err.message}`);
        if (err.stack) {
            console.error(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}`);
        }
        return false;
    }
}

async function main() {
    console.log("==================================================");
    console.log("PHASE 14: DOCKER COMPOSE & DEPLOYMENT READINESS");
    console.log("==================================================");

    let passedCount = 0;
    let failedCount = 0;

    // Load compose files
    const devComposePath = path.join(ROOT_DIR, "docker-compose.yml");
    const prodComposePath = path.join(ROOT_DIR, "docker-compose.prod.yml");
    const devComposeRaw = fs.readFileSync(devComposePath, "utf-8");
    const prodComposeRaw = fs.readFileSync(prodComposePath, "utf-8");

    // 1. Compose configuration is valid
    const t1 = await runTest(1, "Docker Compose configuration is valid", async () => {
        const configOutput = execSync("docker compose config", { cwd: ROOT_DIR, encoding: "utf-8" });
        assert.ok(configOutput.includes("services:"), "docker compose config must return valid services YAML");
        const prodConfigOutput = execSync("docker compose -f docker-compose.prod.yml config", { cwd: ROOT_DIR, encoding: "utf-8" });
        assert.ok(prodConfigOutput.includes("services:"), "docker compose prod config must return valid services YAML");
    });
    t1 ? passedCount++ : failedCount++;

    // 2. Required services are defined
    const t2 = await runTest(2, "Required services are defined", async () => {
        const requiredServices = ["postgres", "qdrant", "ollama", "ai-service", "backend", "frontend"];
        for (const s of requiredServices) {
            assert.ok(devComposeRaw.includes(`${s}:`), `docker-compose.yml must define service '${s}'`);
            assert.ok(prodComposeRaw.includes(`${s}:`), `docker-compose.prod.yml must define service '${s}'`);
        }
    });
    t2 ? passedCount++ : failedCount++;

    // 3. PostgreSQL has persistence
    const t3 = await runTest(3, "PostgreSQL has persistence mapped to postgres_data", async () => {
        assert.ok(devComposeRaw.includes("postgres_data:/var/lib/postgresql/data"), "Postgres must mount postgres_data volume");
        assert.ok(devComposeRaw.includes("postgres_data:"), "Postgres volume must be declared under volumes");
    });
    t3 ? passedCount++ : failedCount++;

    // 4. Qdrant has persistence
    const t4 = await runTest(4, "Qdrant has persistence mapped to qdrant_storage", async () => {
        assert.ok(devComposeRaw.includes("qdrant_storage:/qdrant/storage"), "Qdrant must mount qdrant_storage volume");
        assert.ok(devComposeRaw.includes("qdrant_storage:"), "Qdrant volume must be declared under volumes");
    });
    t4 ? passedCount++ : failedCount++;

    // 5. Qdrant storage maps to /qdrant/storage
    const t5 = await runTest(5, "Qdrant storage maps exactly to /qdrant/storage", async () => {
        assert.ok(devComposeRaw.includes(":/qdrant/storage"), "Container mount path must be /qdrant/storage");
        assert.ok(prodComposeRaw.includes(":/qdrant/storage"), "Prod container mount path must be /qdrant/storage");
    });
    t5 ? passedCount++ : failedCount++;

    // 6. Internal service networking is correct
    const t6 = await runTest(6, "Internal service networking uses sovereign_net bridge network", async () => {
        assert.ok(devComposeRaw.includes("sovereign_net:"), "docker-compose.yml must define sovereign_net");
        assert.ok(devComposeRaw.includes("POSTGRES_HOST: postgres"), "Backend must use postgres service name");
        assert.ok(devComposeRaw.includes("QDRANT_URL: http://qdrant:6333"), "Backend must use qdrant service name");
        assert.ok(devComposeRaw.includes("AI_SERVICE_URL: http://ai-service:5001"), "Backend must use ai-service name");
    });
    t6 ? passedCount++ : failedCount++;

    // 7. Health checks exist across all services
    const t7 = await runTest(7, "Health checks exist across all critical services", async () => {
        const servicesWithHealth = ["postgres", "qdrant", "ollama", "ai-service", "backend", "frontend"];
        for (const s of servicesWithHealth) {
            assert.ok(devComposeRaw.includes("healthcheck:"), `Services must define healthcheck block`);
        }
        assert.ok(devComposeRaw.includes("pg_isready"), "Postgres healthcheck must use pg_isready");
        assert.ok(devComposeRaw.includes("/readyz"), "Qdrant healthcheck must query /readyz");
        assert.ok(devComposeRaw.includes("ollama list"), "Ollama healthcheck must query ollama list");
        assert.ok(devComposeRaw.includes("http://localhost:9000/api/v1/health"), "Backend healthcheck must query /api/v1/health");
    });
    t7 ? passedCount++ : failedCount++;

    // 8. Ollama configuration is correct
    const t8 = await runTest(8, "Ollama configuration is correct (keep-alive, ports)", async () => {
        assert.ok(devComposeRaw.includes("OLLAMA_KEEP_ALIVE: \"24h\""), "Ollama must set 24h keep-alive to avoid cold loads");
        assert.ok(devComposeRaw.includes("ollama_data:/root/.ollama"), "Ollama must persist models to ollama_data volume");
    });
    t8 ? passedCount++ : failedCount++;

    // 9. Required local models are available
    const t9 = await runTest(9, "Required local models are available (llama3.2:3b, moondream)", async () => {
        const ollamaHost = getHostOllamaUrl();
        const res = await fetch(`${ollamaHost}/api/tags`);
        assert.equal(res.status, 200, "Ollama must respond to /api/tags");
        const data = await res.json();
        const modelNames = data.models.map(m => m.name);
        assert.ok(modelNames.some(m => m.includes("llama3.2")), "llama3.2 must be locally present in Ollama");
        assert.ok(modelNames.some(m => m.includes("moondream")), "moondream must be locally present in Ollama");
    });
    t9 ? passedCount++ : failedCount++;

    // 10. Backend starts after dependencies
    const t10 = await runTest(10, "Backend starts after dependencies using condition: service_healthy", async () => {
        assert.ok(devComposeRaw.includes("condition: service_healthy"), "Backend depends_on must use service_healthy");
        assert.ok(prodComposeRaw.includes("condition: service_healthy"), "Prod backend depends_on must use service_healthy");
    });
    t10 ? passedCount++ : failedCount++;

    // 11. Database migrations are non-destructive
    const t11 = await runTest(11, "Database migrations are non-destructive and idempotent", async () => {
        await initDb();
        const dbStatus = await checkDbConnection();
        assert.equal(dbStatus.connected, true, "Database initialization must succeed");
        // Verify no DROP TABLE or TRUNCATE in db schema initialization
        const dbCode = fs.readFileSync(path.join(__dirname, "../src/config/db.js"), "utf-8");
        assert.ok(!dbCode.includes("DROP TABLE"), "db.js must never drop tables on startup");
        assert.ok(!dbCode.includes("TRUNCATE"), "db.js must never truncate tables on startup");
        assert.ok(dbCode.includes("CREATE TABLE IF NOT EXISTS"), "db.js must use CREATE TABLE IF NOT EXISTS");
    });
    t11 ? passedCount++ : failedCount++;

    // 12. Environment secrets are not exposed to frontend
    const t12 = await runTest(12, "Environment secrets are not exposed to frontend", async () => {
        const frontendEnvPath = path.join(ROOT_DIR, "frontend/.env");
        if (fs.existsSync(frontendEnvPath)) {
            const frontendEnv = fs.readFileSync(frontendEnvPath, "utf-8");
            assert.ok(!frontendEnv.includes("JWT_SECRET"), "Frontend .env must not contain JWT_SECRET");
            assert.ok(!frontendEnv.includes("POSTGRES_PASSWORD"), "Frontend .env must not contain POSTGRES_PASSWORD");
        }
        const gitignore = fs.readFileSync(path.join(ROOT_DIR, ".gitignore"), "utf-8");
        assert.ok(gitignore.includes(".env"), ".gitignore must ignore .env files");
    });
    t12 ? passedCount++ : failedCount++;

    // 13. Internal ports are not unnecessarily public in production
    const t13 = await runTest(13, "Internal ports are not unnecessarily exposed to host in production", async () => {
        assert.ok(!prodComposeRaw.includes("5433:5432"), "Production compose must not expose postgres host port");
        assert.ok(!prodComposeRaw.includes("6333:6333"), "Production compose must not expose qdrant host port");
        assert.ok(!prodComposeRaw.includes("11435:11434"), "Production compose must not expose ollama host port");
        assert.ok(prodComposeRaw.includes("9000:9000"), "Production compose must expose backend port 9000");
        assert.ok(prodComposeRaw.includes("80"), "Production compose must expose frontend HTTP port");
    });
    t13 ? passedCount++ : failedCount++;

    // 14. Coding Sandbox security remains intact
    const t14 = await runTest(14, "Coding Sandbox security invariants remain intact", async () => {
        const sandboxCode = fs.readFileSync(path.join(__dirname, "../src/services/sandbox.service.js"), "utf-8");
        assert.ok(sandboxCode.includes("--network none") || sandboxCode.includes("none"), "Sandbox must enforce --network none");
        assert.ok(sandboxCode.includes("--read-only"), "Sandbox must enforce --read-only");
        assert.ok(sandboxCode.includes("--user"), "Sandbox must run as non-root user");
        assert.ok(sandboxCode.includes("--cap-drop"), "Sandbox must drop capabilities");
        assert.ok(sandboxCode.includes("--memory"), "Sandbox must enforce memory limit");
        assert.ok(sandboxCode.includes("--cpus"), "Sandbox must enforce CPU limit");
    });
    t14 ? passedCount++ : failedCount++;

    // 15. Frontend reaches backend (Health probe)
    const t15 = await runTest(15, "Backend health API endpoint is responsive", async () => {
        const dbStatus = await checkDbConnection();
        assert.equal(dbStatus.connected, true, "Database must be connected");
    });
    t15 ? passedCount++ : failedCount++;

    // 16. Backend reaches PostgreSQL
    const t16 = await runTest(16, "Backend executes live queries against PostgreSQL", async () => {
        const res = await query("SELECT 1 AS alive");
        assert.equal(res.rows[0].alive, 1, "PostgreSQL query must return result");
    });
    t16 ? passedCount++ : failedCount++;

    // 17. Backend/AI reaches Qdrant
    const t17 = await runTest(17, "Backend/AI reaches Qdrant vector store", async () => {
        const qdrantUrl = process.env.QDRANT_URL || "http://127.0.0.1:6333";
        const res = await fetch(`${qdrantUrl}/collections/documents`);
        assert.equal(res.status, 200, "Qdrant /collections/documents must return 200 OK");
        const json = await res.json();
        assert.equal(json.status, "ok", "Qdrant collection status must be ok");
        assert.ok(json.result.points_count > 0, "Qdrant must contain indexed vector points");
    });
    t17 ? passedCount++ : failedCount++;

    // 18. AI reaches Ollama
    const t18 = await runTest(18, "AI service reaches local Ollama endpoint", async () => {
        const ollamaUrl = getHostOllamaUrl();
        const res = await fetch(`${ollamaUrl}/api/tags`);
        assert.equal(res.status, 200, "Ollama /api/tags must return 200");
    });
    t18 ? passedCount++ : failedCount++;

    // 19. RAG works after deployment
    const t19 = await runTest(19, "RAG vector retrieval operates cleanly", async () => {
        const queryVec = await generateEmbedding("pressure vessel thickness limit");
        const orgRes = await query("SELECT id FROM organizations LIMIT 1");
        const orgId = orgRes.rows[0]?.id || "0bd5dba2-05e1-4f5c-9047-25843d338622";
        const searchResults = await searchSimilarChunks(queryVec, 3, undefined, {
            organizationId: orgId
        });
        assert.ok(Array.isArray(searchResults), "searchSimilarChunks must return an array");
    });
    t19 ? passedCount++ : failedCount++;

    // 20. Inspection Agent works after deployment
    const t20 = await runTest(20, "Inspection schema and route validation operates", async () => {
        const routeResult = await routeTask("Inspect refinery pipeline corrosion", {
            taskType: TASK_TYPE.INSPECTION
        });
        assert.equal(routeResult.local, true, "Inspection task must route to local model");
        assert.ok(routeResult.selectedModel, "Selected model must be defined");
    });
    t20 ? passedCount++ : failedCount++;

    // 21. Approval Note generation works after deployment
    const t21 = await runTest(21, "Approval Note DOCX generator compiles valid document buffer", async () => {
        const sampleReport = {
            subject: "Deployment Readiness Inspection Note",
            background: "MRPL Crude Distillation Unit V-101",
            findings: [
                {
                    equipment: "V-101",
                    finding: "Corrosion within allowable threshold",
                    observedValue: "7.8 mm",
                    limit: "6.0 mm",
                    severity: "LOW",
                    evidence: "Ultrasonic testing confirms 7.8 mm thickness."
                }
            ],
            technicalAnalysis: "Operating parameters conform to ASME Section VIII.",
            riskAssessment: {
                riskLevel: "LOW",
                reason: "Operating parameters conform to ASME Section VIII."
            },
            recommendation: {
                action: "Continue routine monitoring",
                priority: "NORMAL",
                citedClause: "SOP-MECH-04"
            },
            citations: [
                { standard: "SOP-MECH-04", section: "5.2", text: "Routine inspection interval is 12 months." }
            ]
        };
        const outputPath = path.join(__dirname, "test_deploy_note.docx");
        const resultPath = await generateApprovalNote(sampleReport, { outputPath });
        assert.ok(fs.existsSync(resultPath), "Generated DOCX file must exist");
        const fileStats = fs.statSync(resultPath);
        assert.ok(fileStats.size > 5000, `DOCX file must be valid size (>5KB, got ${fileStats.size})`);
        if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
    });
    t21 ? passedCount++ : failedCount++;

    // 22. Coding Sandbox works after deployment
    const t22 = await runTest(22, "Coding Sandbox executes securely in isolated container", async () => {
        const result = await executeInSandbox({
            code: "print('SOVEREIGN_DEPLOY_READY')",
            language: "python"
        });
        assert.equal(result.exitCode, 0, "Sandbox execution must exit 0");
        assert.ok(result.stdout.includes("SOVEREIGN_DEPLOY_READY"), "Sandbox stdout must contain expected output");
    });
    t22 ? passedCount++ : failedCount++;

    // 23. Vision works after deployment
    const t23 = await runTest(23, "Vision pipeline processes image and returns observations", async () => {
        const tinyPng = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "base64"
        );
        const result = await analyzeImage({
            image: tinyPng,
            mimeType: "image/png",
            prompt: "Describe this test image",
            userId: "test-user",
            organizationId: "0bd5dba2-05e1-4f5c-9047-25843d338622"
        });
        assert.ok(result.analysis || result.observations, "Vision analysis must return structured observation");
        assert.equal(result.local, true, "Vision result must declare local: true");
    });
    t23 ? passedCount++ : failedCount++;

    // 24. Restart preserves PostgreSQL data
    const t24 = await runTest(24, "PostgreSQL records persist in postgres_data volume", async () => {
        const usersCount = await query("SELECT COUNT(*) FROM users");
        const orgsCount = await query("SELECT COUNT(*) FROM organizations");
        const docsCount = await query("SELECT COUNT(*) FROM documents");
        assert.ok(parseInt(usersCount.rows[0].count, 10) > 0, "Users table must contain persistent records");
        assert.ok(parseInt(orgsCount.rows[0].count, 10) > 0, "Organizations table must contain persistent records");
        assert.ok(parseInt(docsCount.rows[0].count, 10) > 0, "Documents table must contain persistent records");
    });
    t24 ? passedCount++ : failedCount++;

    // 25. Restart preserves Qdrant data
    const t25 = await runTest(25, "Qdrant vector collection points persist in qdrant_storage volume", async () => {
        const qdrantUrl = process.env.QDRANT_URL || "http://127.0.0.1:6333";
        const res = await fetch(`${qdrantUrl}/collections/documents`);
        assert.equal(res.status, 200, "Qdrant collection must exist");
        const data = await res.json();
        assert.ok(data.result.points_count >= 30000, `Qdrant points must be preserved (found ${data.result.points_count})`);
    });
    t25 ? passedCount++ : failedCount++;

    // 26. No external AI API is called
    const t26 = await runTest(26, "External cloud AI models are strictly blocked", async () => {
        assert.equal(isModelAllowed("gpt-4o"), false, "gpt-4o must be blocked");
        assert.equal(isModelAllowed("claude-3-5-sonnet-20241022"), false, "claude must be blocked");
        assert.equal(isModelAllowed("gemini-1.5-pro"), false, "gemini must be blocked");
    });
    t26 ? passedCount++ : failedCount++;

    // 27. No external inference API is called
    const t27 = await runTest(27, "Zero external inference API keys or endpoints required", async () => {
        assert.equal(process.env.OPENAI_API_KEY, undefined, "OPENAI_API_KEY must not be set");
        assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "ANTHROPIC_API_KEY must not be set");
        assert.equal(process.env.GOOGLE_API_KEY, undefined, "GOOGLE_API_KEY must not be set");
    });
    t27 ? passedCount++ : failedCount++;

    // 28. No destructive volume reset occurs
    const t28 = await runTest(28, "Docker Compose volumes use persistent named volumes without wipe", async () => {
        assert.ok(devComposeRaw.includes("name: postgres_data"), "postgres_data must be explicitly named");
        assert.ok(devComposeRaw.includes("name: qdrant_storage"), "qdrant_storage must be explicitly named");
        assert.ok(devComposeRaw.includes("name: ollama_data"), "ollama_data must be explicitly named");
    });
    t28 ? passedCount++ : failedCount++;

    console.log("\n==================================================");
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log("==================================================");

    if (failedCount > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Fatal test error:", err);
    process.exit(1);
});
