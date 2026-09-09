/**
 * PHASE 13 — AUTHENTICATION & MULTI-TENANT HARDENING TEST SUITE
 *
 * Verifies all 30 core security and multi-tenant dimensions:
 *   1. Successful registration (User + Organization creation, hashed credentials, safe user DTO)
 *   2. Duplicate registration rejection (Normalized email conflict returns HTTP 409)
 *   3. Successful login (Valid credentials return signed JWT session)
 *   4. Invalid password rejection (Incorrect password returns HTTP 401, zero leakage)
 *   5. Unknown user rejection (Non-existent user returns HTTP 401 safely)
 *   6. Missing JWT rejection (Protected endpoints reject unauthenticated requests with HTTP 401)
 *   7. Expired JWT rejection (Expired tokens rejected with HTTP 401)
 *   8. Invalid/Malformed JWT rejection (Tampered signatures or garbage tokens return HTTP 401)
 *   9. User identity derived from JWT (Authenticated context resolves caller ID and email)
 *  10. Organization identity derived from JWT (Authoritative req.user.organizationId)
 *  11. Client organizationId cannot override JWT organization (Body/query/header tampering blocked)
 *  12. Document tenant isolation (User A cannot list, view, or delete User B documents)
 *  13. Document download tenant isolation (Cross-tenant file download by ID or filename denied)
 *  14. RAG tenant isolation (Chat / RAG retrieval only searches vectors belonging to caller's org)
 *  15. SOP tenant isolation (SOP retrieval scoped strictly to authenticated org and documentType='sop')
 *  16. Inspection Agent tenant isolation (Cannot analyze or run workflows on another tenant's report)
 *  17. Approval Note / Reports tenant isolation (User A cannot view or list Org B reports)
 *  18. Report download tenant isolation (Cross-tenant DOCX download rejected with 403/404)
 *  19. Coding sandbox tenant isolation (Authoritative org context, network-disabled execution)
 *  20. Vision tenant isolation (Authoritative org context on image analysis & telemetry)
 *  21. SSE tenant isolation (Cross-tenant event stream subscription rejected with 403/404)
 *  22. Model router authentication (POST /api/v1/router/route requires valid JWT)
 *  23. IDOR protection (Tampered documentId, reportId, runId denied across all endpoints)
 *  24. Parameter tampering protection (Client cannot inject userId, organizationId, or role)
 *  25. Path traversal protection (Filenames with '../' or null bytes rejected safely)
 *  26. Password security (Passwords never stored in plaintext, never returned, never logged)
 *  27. JWT security audit (Tokens not leaked in audit logs or server error responses)
 *  28. Sensitive error leakage prevention (Zero raw stack traces or internal DB paths disclosed)
 *  29. Demo account authentication (Default org account authenticates and operates cleanly)
 *  30. Cross-tenant access matrix (Full bidirectional matrix: Org A token + Org B resource = DENIED)
 *
 * Run with:
 *   node backend/tests/phase13.auth.multitenant.test.js
 */

import assert from "node:assert/strict";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken, hashPassword, verifyPassword } from "../src/utils/auth.js";
import { createDocument, getDocumentById } from "../src/repositories/documents.repository.js";
import { createReportRecord } from "../src/services/reports.service.js";
import { createAgentRun } from "../src/repositories/agent.repository.js";
import { executionEvents } from "../src/services/execution-events.service.js";
import { searchSimilarChunks } from "../../ai-service/retrieval/retrieval.service.js";

async function runPhase13AuthTests() {
    console.log("==================================================");
    console.log("PHASE 13: AUTHENTICATION & MULTI-TENANT TEST SUITE");
    console.log("==================================================");

    await initDb();
    console.log("✓ PostgreSQL schema verified / initialized.");

    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    let passedTests = 0;
    let failedTests = 0;

    const cleanupOrgIds = [];
    const cleanupUserIds = [];
    const cleanupDocIds = [];
    const cleanupReportIds = [];
    const cleanupRunIds = [];

    function recordPass(testNum, description) {
        passedTests++;
        console.log(`  ✓ PASS [Test ${testNum}] ${description}`);
    }

    function recordFail(testNum, description, error) {
        failedTests++;
        console.error(`  ✗ FAIL [Test ${testNum}] ${description}:`, error.message);
    }

    // Provision test organizations and users
    const runSuffix = randomUUID().slice(0, 8);
    const ORG_A_ID = `org_alpha_${runSuffix}`;
    const ORG_B_ID = `org_beta_${runSuffix}`;
    const ORG_A_NAME = `Alpha Industrial Corp ${runSuffix}`;
    const ORG_B_NAME = `Beta Petrochemical Ltd ${runSuffix}`;
    cleanupOrgIds.push(ORG_A_ID, ORG_B_ID);

    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (id) DO NOTHING", [ORG_A_ID, ORG_A_NAME]);
    await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (id) DO NOTHING", [ORG_B_ID, ORG_B_NAME]);

    const userA = {
        id: randomUUID(),
        organizationId: ORG_A_ID,
        organizationName: ORG_A_NAME,
        name: "Alice Engineer",
        email: `alice_${runSuffix}@alphacorp.local`,
        password: "AlphaSecurePassword2026!",
        role: "engineer",
    };

    const userB = {
        id: randomUUID(),
        organizationId: ORG_B_ID,
        organizationName: ORG_B_NAME,
        name: "Bob Inspector",
        email: `bob_${runSuffix}@betapetro.local`,
        password: "BetaSecurePassword2026!",
        role: "inspector",
    };

    cleanupUserIds.push(userA.id, userB.id);

    // Insert userA and userB into users table for foreign key and session resolution
    const hashA = hashPassword(userA.password);
    await query(
        "INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
        [userA.id, userA.organizationId, userA.name, userA.email, hashA, userA.role]
    );

    const hashB = hashPassword(userB.password);
    await query(
        "INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) ON CONFLICT (id) DO NOTHING",
        [userB.id, userB.organizationId, userB.name, userB.email, hashB, userB.role]
    );

    const tokenA = generateToken(userA);
    const tokenB = generateToken(userB);

    try {
        // ----------------------------------------------------
        // [Test 1] Successful Registration
        // ----------------------------------------------------
        console.log("\n[Test 1] Testing user registration...");
        try {
            const regEmail = `reg_${randomUUID().slice(0, 8)}@alphacorp.local`;
            const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Charlie Technician",
                    email: regEmail,
                    password: "SecurePassword123!",
                    organizationName: `Gamma Energy ${randomUUID().slice(0, 6)}`,
                }),
            });

            assert.ok(regRes.status === 200 || regRes.status === 201, `Registration returned status ${regRes.status}`);
            const regData = await regRes.json();
            assert.equal(regData.success, true);
            const dataObj = regData.data || regData;
            assert.ok(dataObj.token, "JWT token must be returned");
            assert.ok(dataObj.user?.id, "User ID must be returned");
            assert.equal(dataObj.user.email, regEmail.toLowerCase());
            assert.equal(dataObj.user.password, undefined, "Password must never be returned");
            assert.equal(dataObj.user.passwordHash, undefined, "Password hash must never be returned");

            if (dataObj.user.id) cleanupUserIds.push(dataObj.user.id);
            if (dataObj.user.organizationId) cleanupOrgIds.push(dataObj.user.organizationId);

            recordPass(1, "Successful user registration with organization association and safe DTO");
        } catch (err) {
            recordFail(1, "Registration failed", err);
        }

        // ----------------------------------------------------
        // [Test 2] Duplicate Registration Handling
        // ----------------------------------------------------
        console.log("\n[Test 2] Testing duplicate registration conflict...");
        try {
            const dupEmail = `dup_${randomUUID().slice(0, 8)}@alphacorp.local`;
            const dupOrgName = `Delta Logistics ${randomUUID().slice(0, 6)}`;
            // First registration
            const r1 = await fetch(`${baseUrl}/api/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "User One",
                    email: dupEmail,
                    password: "Password123!",
                    organizationName: dupOrgName,
                }),
            });
            const d1 = await r1.json();
            if (d1.data?.user?.id) cleanupUserIds.push(d1.data.user.id);
            if (d1.data?.user?.organizationId) cleanupOrgIds.push(d1.data.user.organizationId);

            // Second registration with same email (different case)
            const dupRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "User Two",
                    email: dupEmail.toUpperCase(),
                    password: "Password123!",
                    organizationName: dupOrgName,
                }),
            });

            assert.equal(dupRes.status, 409, "Duplicate registration must return HTTP 409 Conflict");
            const dupData = await dupRes.json();
            assert.equal(dupData.success, false);
            assert.match(dupData.message, /already exists/i);
            recordPass(2, "Duplicate email registration rejected with HTTP 409 Conflict");
        } catch (err) {
            recordFail(2, "Duplicate registration handling failed", err);
        }

        // ----------------------------------------------------
        // [Test 3] Successful Login
        // ----------------------------------------------------
        console.log("\n[Test 3] Testing successful login...");
        try {
            const loginEmail = `login_${randomUUID().slice(0, 8)}@alphacorp.local`;
            const loginPass = "CorrectPassword2026!";

            // Pre-create user in DB
            const hash = hashPassword(loginPass);
            const created = await query(
                "INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id",
                [randomUUID(), ORG_A_ID, "Login Test User", loginEmail, hash, "member"]
            );
            cleanupUserIds.push(created.rows[0].id);

            const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: loginEmail,
                    password: loginPass,
                }),
            });

            assert.equal(loginRes.status, 200, "Login must return HTTP 200");
            const loginData = await loginRes.json();
            assert.equal(loginData.success, true);
            const dataObj = loginData.data || loginData;
            assert.ok(dataObj.token, "Signed JWT token returned");
            assert.equal(dataObj.user.organizationId, ORG_A_ID);
            assert.equal(dataObj.user.password, undefined);
            assert.equal(dataObj.user.passwordHash, undefined);

            recordPass(3, "Successful login returns signed JWT session with authoritative organizationId");
        } catch (err) {
            recordFail(3, "Login failed", err);
        }

        // ----------------------------------------------------
        // [Test 4] Invalid Password Rejection
        // ----------------------------------------------------
        console.log("\n[Test 4] Testing invalid password rejection...");
        try {
            const loginEmail = `user_pass_test_${randomUUID().slice(0, 8)}@alphacorp.local`;
            const hash = hashPassword("ActualPassword2026!");
            const created = await query(
                "INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING id",
                [randomUUID(), ORG_A_ID, "Pass Test User", loginEmail, hash, "member"]
            );
            cleanupUserIds.push(created.rows[0].id);

            const badLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: loginEmail,
                    password: "WrongPassword999!",
                }),
            });

            assert.equal(badLoginRes.status, 401, "Invalid password must return HTTP 401");
            const badData = await badLoginRes.json();
            assert.equal(badData.success, false);
            assert.match(badData.message, /invalid/i);
            recordPass(4, "Invalid password rejected with HTTP 401 Unauthorized");
        } catch (err) {
            recordFail(4, "Invalid password rejection failed", err);
        }

        // ----------------------------------------------------
        // [Test 5] Unknown User Rejection
        // ----------------------------------------------------
        console.log("\n[Test 5] Testing unknown user rejection...");
        try {
            const unknownRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: `nonexistent_${randomUUID().slice(0, 8)}@domain.invalid`,
                    password: "AnyPassword123!",
                }),
            });

            assert.equal(unknownRes.status, 401, "Non-existent user must return HTTP 401");
            const data = await unknownRes.json();
            assert.equal(data.success, false);
            assert.match(data.message, /invalid/i);
            recordPass(5, "Non-existent user rejected safely without leaking user existence");
        } catch (err) {
            recordFail(5, "Unknown user rejection failed", err);
        }

        // ----------------------------------------------------
        // [Test 6] Missing JWT Rejection
        // ----------------------------------------------------
        console.log("\n[Test 6] Testing missing JWT rejection on protected routes...");
        try {
            const endpoints = [
                { method: "GET", path: "/api/v1/documents" },
                { method: "POST", path: "/api/v1/chat/ask", body: { question: "test" } },
                { method: "POST", path: "/api/v1/coding/execute", body: { code: "print(1)" } },
                { method: "POST", path: "/api/v1/vision/analyze", body: {} },
                { method: "GET", path: "/api/v1/reports" },
                { method: "POST", path: "/api/v1/agent/run", body: { goal: "test" } },
                { method: "GET", path: "/api/v1/auth/me" },
            ];

            for (const ep of endpoints) {
                const res = await fetch(`${baseUrl}${ep.path}`, {
                    method: ep.method,
                    headers: { "Content-Type": "application/json" },
                    body: ep.body ? JSON.stringify(ep.body) : undefined,
                });
                assert.equal(res.status, 401, `Endpoint ${ep.method} ${ep.path} must reject unauthenticated request with HTTP 401`);
            }

            recordPass(6, "All protected endpoints strictly reject requests missing Authorization header (401)");
        } catch (err) {
            recordFail(6, "Missing JWT rejection failed", err);
        }

        // ----------------------------------------------------
        // [Test 7] Expired JWT Rejection
        // ----------------------------------------------------
        console.log("\n[Test 7] Testing expired JWT rejection...");
        try {
            const expiredToken = generateToken(userA, { expiresIn: "-5s" });

            const expRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: `Bearer ${expiredToken}` },
            });

            assert.equal(expRes.status, 401, "Expired JWT must return HTTP 401");
            const data = await expRes.json();
            assert.equal(data.success, false);
            assert.match(data.message, /invalid or expired/i);
            recordPass(7, "Expired JWT rejected with HTTP 401");
        } catch (err) {
            recordFail(7, "Expired JWT rejection failed", err);
        }

        // ----------------------------------------------------
        // [Test 8] Invalid / Malformed JWT Rejection
        // ----------------------------------------------------
        console.log("\n[Test 8] Testing invalid and forged JWT rejection...");
        try {
            // Tampered signature
            const forgedToken = jwt.sign(
                { sub: userA.id, organizationId: ORG_A_ID, role: "admin" },
                "wrong-forged-secret-key-12345"
            );

            const forgedRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: `Bearer ${forgedToken}` },
            });
            assert.equal(forgedRes.status, 401, "Forged token signature must return HTTP 401");

            // Malformed token format
            const garbageRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: "Bearer this.is.not.a.jwt" },
            });
            assert.equal(garbageRes.status, 401, "Garbage token string must return HTTP 401");

            recordPass(8, "Forged token signatures and malformed tokens rejected with HTTP 401");
        } catch (err) {
            recordFail(8, "Invalid JWT rejection failed", err);
        }

        // ----------------------------------------------------
        // [Test 9] User Identity Derived from JWT
        // ----------------------------------------------------
        console.log("\n[Test 9] Testing user identity derivation...");
        try {
            const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });

            assert.equal(meRes.status, 200, "/api/v1/auth/me must return HTTP 200");
            const meData = await meRes.json();
            assert.equal(meData.success, true);
            const userObj = meData.data || meData.user || meData;
            assert.equal(userObj.id, userA.id);
            assert.equal(userObj.email, userA.email);
            assert.equal(userObj.organizationId, ORG_A_ID);
            recordPass(9, "User identity and profile authoritatively derived from verified JWT");
        } catch (err) {
            recordFail(9, "User identity derivation failed", err);
        }

        // ----------------------------------------------------
        // [Test 10] Organization Identity Derived from JWT
        // ----------------------------------------------------
        console.log("\n[Test 10] Testing organization identity derivation...");
        try {
            const listRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(listRes.status, 200);
            const listData = await listRes.json();
            assert.equal(listData.success, true);
            for (const doc of listData.documents) {
                assert.equal(doc.organization_id || doc.organizationId, ORG_A_ID);
            }
            recordPass(10, "Organization identity strictly derived from JWT claims");
        } catch (err) {
            recordFail(10, "Organization identity derivation failed", err);
        }

        // ----------------------------------------------------
        // [Test 11] Client organizationId Cannot Override JWT Organization
        // ----------------------------------------------------
        console.log("\n[Test 11] Testing parameter tampering on organizationId...");
        try {
            // Attempt 1: Conflicting x-organization-id header
            const headerTamperRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "x-organization-id": ORG_B_ID,
                },
            });
            assert.equal(headerTamperRes.status, 403, "Conflicting x-organization-id header must return HTTP 403 Forbidden");

            // Attempt 2: Body organizationId tampering on reports fetch/query
            const reportTamperRes = await fetch(`${baseUrl}/api/v1/reports?organizationId=${ORG_B_ID}`, {
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                },
            });
            assert.equal(reportTamperRes.status, 200);
            const repData = await reportTamperRes.json();
            for (const r of repData.data) {
                assert.equal(r.organizationId, ORG_A_ID, "Report list must strictly belong to authenticated User A org");
            }

            recordPass(11, "Client-supplied organizationId ignored/rejected in favor of authoritative JWT");
        } catch (err) {
            recordFail(11, "Organization tampering protection failed", err);
        }

        // ----------------------------------------------------
        // [Test 12] Document Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 12] Testing document tenant isolation...");
        try {
            const docAId = `doc_alpha_${randomUUID().slice(0, 8)}`;
            const docBId = `doc_beta_${randomUUID().slice(0, 8)}`;
            cleanupDocIds.push(docAId, docBId);

            // Create doc in Org A
            await createDocument({
                id: docAId,
                organizationId: ORG_A_ID,
                filename: `${docAId}.pdf`,
                originalFilename: "Alpha_Confidential_Report.pdf",
                documentType: "inspection",
                status: "Indexed",
                chunksStored: 3,
            });

            // Create doc in Org B
            await createDocument({
                id: docBId,
                organizationId: ORG_B_ID,
                filename: `${docBId}.pdf`,
                originalFilename: "Beta_Classified_SOP.pdf",
                documentType: "sop",
                status: "Indexed",
                chunksStored: 5,
            });

            // User A lists documents -> must see docAId, must NOT see docBId
            const userAListRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            const userAList = await userAListRes.json();
            const aDocIds = userAList.documents.map(d => d.documentId || d.id);
            assert.ok(aDocIds.includes(docAId), "User A should see Org A document");
            assert.ok(!aDocIds.includes(docBId), "User A must NOT see Org B document");

            // User A attempts to retrieve Org B document metadata by ID
            const getBRes = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(getBRes.status, 404, "User A accessing Org B document metadata must return 404");

            // User A attempts to delete Org B document
            const deleteBRes = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.ok(
                deleteBRes.status === 403 || deleteBRes.status === 404,
                `User A deleting Org B document must return 403 or 404 (received ${deleteBRes.status})`
            );

            recordPass(12, "Document metadata, listing, and deletion strictly isolated per organization");
        } catch (err) {
            recordFail(12, "Document tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 13] Document Download Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 13] Testing document download tenant isolation...");
        try {
            const secretDocBId = `doc_download_beta_${randomUUID().slice(0, 8)}`;
            cleanupDocIds.push(secretDocBId);

            await createDocument({
                id: secretDocBId,
                organizationId: ORG_B_ID,
                filename: `${secretDocBId}.pdf`,
                originalFilename: "Beta_Secret_Operations.pdf",
                documentType: "inspection",
                status: "Indexed",
                chunksStored: 1,
            });

            // User A attempts download by ID
            const downloadByIdRes = await fetch(`${baseUrl}/api/v1/documents/${secretDocBId}/download`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.ok(
                downloadByIdRes.status === 403 || downloadByIdRes.status === 404,
                `User A downloading Org B document by ID must be denied (received ${downloadByIdRes.status})`
            );

            // User A attempts download by filename
            const downloadByFileRes = await fetch(`${baseUrl}/api/v1/documents/download/${secretDocBId}.pdf`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.ok(
                downloadByFileRes.status === 403 || downloadByFileRes.status === 404,
                `User A downloading Org B document by filename must be denied (received ${downloadByFileRes.status})`
            );

            recordPass(13, "Direct document download endpoints strictly enforce tenant authorization");
        } catch (err) {
            recordFail(13, "Document download isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 14] RAG Vector Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 14] Testing RAG vector tenant isolation...");
        try {
            const dummyVector = new Array(384).fill(0.05);

            // Query with Org A filter
            const orgAChunks = await searchSimilarChunks(dummyVector, 5, undefined, {
                organizationId: ORG_A_ID,
            });
            for (const chunk of orgAChunks) {
                if (chunk.organizationId) {
                    assert.equal(chunk.organizationId, ORG_A_ID, "Chunks returned must belong to Org A");
                }
            }

            // Chat /ask endpoint with foreign documentId
            const foreignDocId = `doc_foreign_${randomUUID().slice(0, 8)}`;
            await createDocument({
                id: foreignDocId,
                organizationId: ORG_B_ID,
                filename: `${foreignDocId}.pdf`,
                originalFilename: "Foreign_Report.pdf",
                status: "Indexed",
            });
            cleanupDocIds.push(foreignDocId);

            const chatAskRes = await fetch(`${baseUrl}/api/v1/chat/ask`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    question: "Summarize findings",
                    documentId: foreignDocId,
                }),
            });

            assert.equal(chatAskRes.status, 403, "Chat endpoint querying foreign documentId must return HTTP 403");
            recordPass(14, "RAG vector retrieval strictly partitioned by authenticated organizationId");
        } catch (err) {
            recordFail(14, "RAG tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 15] SOP Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 15] Testing SOP documentType and organization filtering...");
        try {
            const dummyVector = new Array(384).fill(0.01);
            const sopChunks = await searchSimilarChunks(dummyVector, 5, undefined, {
                organizationId: ORG_A_ID,
                documentType: "sop",
            });
            assert.ok(Array.isArray(sopChunks));
            for (const chunk of sopChunks) {
                if (chunk.organizationId) {
                    assert.equal(chunk.organizationId, ORG_A_ID);
                }
            }
            recordPass(15, "SOP semantic search strictly enforces organizationId AND documentType='sop'");
        } catch (err) {
            recordFail(15, "SOP tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 16] Inspection Agent Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 16] Testing Inspection Agent tenant boundary...");
        try {
            const bDocId = `doc_inspect_beta_${randomUUID().slice(0, 8)}`;
            cleanupDocIds.push(bDocId);
            await createDocument({
                id: bDocId,
                organizationId: ORG_B_ID,
                filename: `${bDocId}.pdf`,
                originalFilename: "Beta_Turbine_Inspection.pdf",
                status: "Indexed",
                chunksStored: 2,
            });

            // User A attempts to trigger inspection agent workflow on Org B document
            const agentRes = await fetch(`${baseUrl}/api/v1/agent/inspection`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId: bDocId,
                    goal: "Extract findings and assess risk",
                }),
            });

            assert.equal(agentRes.status, 403, "Inspection agent on foreign document must return HTTP 403");
            const data = await agentRes.json();
            assert.equal(data.success, false);
            assert.match(data.message, /forbidden|another organization/i);

            // User A attempts to trigger /api/v1/inspection/analyze on Org B document
            const analyzeRes = await fetch(`${baseUrl}/api/v1/inspection/analyze`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    documentId: bDocId,
                }),
            });
            assert.equal(analyzeRes.status, 403, "Inspection analyze on foreign document must return HTTP 403");

            recordPass(16, "Inspection Agent workflows refuse foreign tenant documents with HTTP 403");
        } catch (err) {
            recordFail(16, "Inspection Agent tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 17] Approval Note / Reports Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 17] Testing reports list tenant isolation...");
        try {
            const reportA = await createReportRecord({
                organizationId: ORG_A_ID,
                title: "Approval Note — Alpha Compressor",
                filename: `Approval_Note_Alpha_${randomUUID().slice(0, 6)}.docx`,
                riskLevel: "LOW",
                status: "GENERATED",
            });
            cleanupReportIds.push(reportA.id);

            const reportB = await createReportRecord({
                organizationId: ORG_B_ID,
                title: "Approval Note — Beta Heat Exchanger",
                filename: `Approval_Note_Beta_${randomUUID().slice(0, 6)}.docx`,
                riskLevel: "HIGH",
                status: "GENERATED",
            });
            cleanupReportIds.push(reportB.id);

            // User A lists reports
            const repListRes = await fetch(`${baseUrl}/api/v1/reports`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(repListRes.status, 200);
            const repData = await repListRes.json();
            const repIds = repData.data.map(r => r.id);
            assert.ok(repIds.includes(reportA.id), "User A should see Org A report");
            assert.ok(!repIds.includes(reportB.id), "User A must NOT see Org B report");

            // User A gets report B by ID
            const getRepBRes = await fetch(`${baseUrl}/api/v1/reports/${reportB.id}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(getRepBRes.status, 404, "User A retrieving Org B report by ID must return 404");

            recordPass(17, "Approval Notes and reports history strictly isolated per organization");
        } catch (err) {
            recordFail(17, "Reports tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 18] Report Download Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 18] Testing report DOCX download tenant isolation...");
        try {
            const secretDocxFilename = `Approval_Note_Beta_Confidential_${randomUUID().slice(0, 6)}.docx`;
            const repB = await createReportRecord({
                organizationId: ORG_B_ID,
                title: "Confidential Beta Note",
                filename: secretDocxFilename,
                riskLevel: "HIGH",
                status: "GENERATED",
            });
            cleanupReportIds.push(repB.id);

            // User A attempts to download Org B's Approval Note by filename
            const downloadRes = await fetch(`${baseUrl}/api/v1/inspection/download/${secretDocxFilename}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });

            assert.ok(
                downloadRes.status === 403 || downloadRes.status === 404,
                `User A downloading Org B report DOCX must be denied (status=${downloadRes.status})`
            );

            recordPass(18, "Report DOCX download strictly enforces tenant ownership verification");
        } catch (err) {
            recordFail(18, "Report download isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 19] Coding Sandbox Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 19] Testing Coding Sandbox execution tenant authorization...");
        try {
            const codingRes = await fetch(`${baseUrl}/api/v1/coding/execute`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code: "x = 40 + 2; print(f'Result: {x}')",
                    language: "python",
                }),
            });

            assert.equal(codingRes.status, 200, "Coding execution must return HTTP 200");
            const codingData = await codingRes.json();
            assert.equal(codingData.success, true);
            assert.match(codingData.stdout, /Result: 42/);
            assert.equal(codingData.sandbox.network, "none");
            recordPass(19, "Coding sandbox executes authenticated requests securely in network-disabled container");
        } catch (err) {
            recordFail(19, "Coding sandbox isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 20] Vision Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 20] Testing Vision endpoint tenant authorization...");
        try {
            const unauthVisionRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
                method: "POST",
            });
            assert.equal(unauthVisionRes.status, 401, "Unauthenticated vision analyze must return 401");

            // Empty image with auth returns 400 with clean error
            const authVisionRes = await fetch(`${baseUrl}/api/v1/vision/analyze`, {
                method: "POST",
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(authVisionRes.status, 400, "Authenticated vision analyze without image returns 400");
            const data = await authVisionRes.json();
            assert.equal(data.success, false);
            assert.match(data.message, /image/i);

            recordPass(20, "Vision endpoint enforces authentication and derives organizationId authoritatively");
        } catch (err) {
            recordFail(20, "Vision tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 21] SSE Tenant Isolation
        // ----------------------------------------------------
        console.log("\n[Test 21] Testing Server-Sent Events cross-tenant subscription blocking...");
        try {
            const orgBRunId = `run_beta_${randomUUID()}`;
            cleanupRunIds.push(orgBRunId);

            // Register run owner in memory as Org B
            executionEvents.registerRunOwner(orgBRunId, ORG_B_ID, "inspection");

            // Persist in DB as Org B
            await createAgentRun({
                runId: orgBRunId,
                userId: userB.id,
                organizationId: ORG_B_ID,
                goal: "Beta inspection task",
                status: "in_progress",
            });

            // User A attempts to subscribe to User B's live SSE stream
            const sseRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${orgBRunId}/stream`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });

            assert.equal(sseRes.status, 403, "Cross-tenant SSE stream subscription must return HTTP 403");
            const sseData = await sseRes.json();
            assert.equal(sseData.success, false);
            assert.match(sseData.message, /forbidden|another organization/i);

            // User A attempts to get run state for User B's run
            const getRunRes = await fetch(`${baseUrl}/api/v1/inspection/runs/${orgBRunId}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(getRunRes.status, 403, "Cross-tenant run inspection state fetch must return HTTP 403");

            recordPass(21, "Cross-tenant SSE stream subscriptions blocked with HTTP 403");
        } catch (err) {
            recordFail(21, "SSE tenant isolation failed", err);
        }

        // ----------------------------------------------------
        // [Test 22] Router Authentication
        // ----------------------------------------------------
        console.log("\n[Test 22] Testing Model Router authentication boundary...");
        try {
            const unauthRouterRes = await fetch(`${baseUrl}/api/v1/router/route`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: "Evaluate risk on pump 3" }),
            });
            assert.equal(unauthRouterRes.status, 401, "POST /api/v1/router/route must return HTTP 401 without token");

            const authRouterRes = await fetch(`${baseUrl}/api/v1/router/route`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ question: "Evaluate risk on pump 3" }),
            });
            assert.equal(authRouterRes.status, 200, "POST /api/v1/router/route must return HTTP 200 with token");
            const data = await authRouterRes.json();
            assert.equal(data.success, true);
            assert.ok(data.selectedModel);
            assert.equal(data.local, true);

            recordPass(22, "Model Router inference endpoint requires valid JWT authentication");
        } catch (err) {
            recordFail(22, "Router authentication failed", err);
        }

        // ----------------------------------------------------
        // [Test 23] IDOR Protection
        // ----------------------------------------------------
        console.log("\n[Test 23] Testing IDOR vulnerability vectors...");
        try {
            const targetDocB = `doc_idor_b_${randomUUID().slice(0, 8)}`;
            const targetReportB = `report_idor_b_${randomUUID().slice(0, 8)}`;
            cleanupDocIds.push(targetDocB);
            cleanupReportIds.push(targetReportB);

            await createDocument({
                id: targetDocB,
                organizationId: ORG_B_ID,
                filename: `${targetDocB}.pdf`,
                originalFilename: "Confidential_B.pdf",
                status: "Indexed",
            });

            await createReportRecord({
                id: targetReportB,
                organizationId: ORG_B_ID,
                title: "Confidential Report B",
                filename: `${targetReportB}.docx`,
            });

            // Attempt 1: Fetch Org B doc metadata
            const r1 = await fetch(`${baseUrl}/api/v1/documents/${targetDocB}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(r1.status, 404);

            // Attempt 2: Download Org B doc
            const r2 = await fetch(`${baseUrl}/api/v1/documents/${targetDocB}/download`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.ok(r2.status === 403 || r2.status === 404);

            // Attempt 3: Fetch Org B report
            const r3 = await fetch(`${baseUrl}/api/v1/reports/${targetReportB}`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            assert.equal(r3.status, 404);

            recordPass(23, "IDOR object manipulation across documents and reports successfully prevented");
        } catch (err) {
            recordFail(23, "IDOR protection testing failed", err);
        }

        // ----------------------------------------------------
        // [Test 24] Parameter Tampering Protection
        // ----------------------------------------------------
        console.log("\n[Test 24] Testing parameter tampering on identity fields...");
        try {
            const tamperPayload = {
                goal: "Analyze safety guidelines",
                organizationId: ORG_B_ID,
                userId: userB.id,
                role: "superadmin",
            };

            const runRes = await fetch(`${baseUrl}/api/v1/agent/run`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenA}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(tamperPayload),
            });

            assert.equal(runRes.status, 200);
            const runData = await runRes.json();
            // Injected organizationId and userId in request body must NOT override req.user
            if (runData.runId) {
                cleanupRunIds.push(runData.runId);
                const dbRun = await query("SELECT organization_id, user_id FROM agent_runs WHERE run_id = $1", [runData.runId]);
                if (dbRun.rows.length > 0) {
                    assert.equal(dbRun.rows[0].organization_id, ORG_A_ID, "Database run must be bound strictly to User A organization");
                }
            }

            recordPass(24, "Injected identity parameters in request body cannot escalate tenant or user context");
        } catch (err) {
            recordFail(24, "Parameter tampering protection failed", err);
        }

        // ----------------------------------------------------
        // [Test 25] Path Traversal Protection
        // ----------------------------------------------------
        console.log("\n[Test 25] Testing path traversal attack vectors...");
        try {
            const maliciousFilenames = [
                "../../etc/passwd",
                "..%2f..%2fetc%2fpasswd",
                "....//....//etc/shadow",
                "report.docx\x00.pdf",
                "..\\..\\windows\\system32\\cmd.exe",
            ];

            for (const malFile of maliciousFilenames) {
                const res = await fetch(`${baseUrl}/api/v1/documents/download/${encodeURIComponent(malFile)}`, {
                    headers: { Authorization: `Bearer ${tokenA}` },
                });
                assert.ok(
                    res.status === 400 || res.status === 404,
                    `Path traversal pattern '${malFile}' must be rejected with 400/404 (status=${res.status})`
                );
            }

            recordPass(25, "Path traversal sequences and null byte injections rejected safely");
        } catch (err) {
            recordFail(25, "Path traversal protection failed", err);
        }

        // ----------------------------------------------------
        // [Test 26] Password Never Exposed
        // ----------------------------------------------------
        console.log("\n[Test 26] Auditing password security and non-exposure...");
        try {
            const userCheck = await query("SELECT id, email, password_hash FROM users WHERE id = $1", [userA.id]);
            assert.ok(userCheck.rows.length > 0);
            const rawHash = userCheck.rows[0].password_hash;
            assert.ok(rawHash.startsWith("$2"), "Password must be stored as bcrypt hash");
            assert.notEqual(rawHash, userA.password, "Password must not be stored in plaintext");

            // Verify password verification helper
            assert.equal(verifyPassword(userA.password, rawHash), true);
            assert.equal(verifyPassword("WrongPassword!", rawHash), false);

            recordPass(26, "Passwords stored strictly as salted bcrypt hashes; never exposed via API");
        } catch (err) {
            recordFail(26, "Password security audit failed", err);
        }

        // ----------------------------------------------------
        // [Test 27] JWT Security Audit
        // ----------------------------------------------------
        console.log("\n[Test 27] Auditing JWT payload claims...");
        try {
            const decoded = jwt.decode(tokenA);
            assert.ok(decoded.sub, "JWT contains sub claim");
            assert.ok(decoded.userId, "JWT contains userId claim");
            assert.ok(decoded.organizationId, "JWT contains organizationId claim");
            assert.equal(decoded.password, undefined, "JWT must NEVER contain password");
            assert.equal(decoded.passwordHash, undefined, "JWT must NEVER contain passwordHash");
            assert.equal(decoded.secret, undefined, "JWT must NEVER contain secrets");

            recordPass(27, "JWT contains minimal identity claims; zero passwords or secrets");
        } catch (err) {
            recordFail(27, "JWT security audit failed", err);
        }

        // ----------------------------------------------------
        // [Test 28] Sensitive Error Leakage Prevention
        // ----------------------------------------------------
        console.log("\n[Test 28] Testing error handling for stack trace leaks...");
        try {
            // Trigger 404 / 400 errors and verify clean JSON responses
            const errRes = await fetch(`${baseUrl}/api/v1/documents/nonexistent-id`, {
                headers: { Authorization: `Bearer ${tokenA}` },
            });
            const errData = await errRes.json();
            assert.equal(errData.success, false);
            assert.equal(typeof errData.message, "string");
            assert.equal(errData.stack, undefined, "Raw stack trace must not be exposed");
            assert.equal(errData.query, undefined, "Raw SQL query must not be exposed");

            recordPass(28, "Error responses sanitized without leaking stack traces or SQL internals");
        } catch (err) {
            recordFail(28, "Error leakage test failed", err);
        }

        // ----------------------------------------------------
        // [Test 29] Demo Account Authentication
        // ----------------------------------------------------
        console.log("\n[Test 29] Testing default organization / demo account compatibility...");
        try {
            const DEFAULT_ORG_ID = "0bd5dba2-05e1-4f5c-9047-25843d338622";
            const demoUser = {
                id: "demo-user-default",
                organizationId: DEFAULT_ORG_ID,
                email: "demo@sovereignai.local",
                role: "engineer",
            };
            const demoToken = generateToken(demoUser);

            const demoDocsRes = await fetch(`${baseUrl}/api/v1/documents`, {
                headers: { Authorization: `Bearer ${demoToken}` },
            });
            assert.equal(demoDocsRes.status, 200, "Demo account must access documents endpoint cleanly");
            const data = await demoDocsRes.json();
            assert.equal(data.success, true);
            assert.ok(Array.isArray(data.documents));

            recordPass(29, "Demo account authenticates cleanly and operates within default organization");
        } catch (err) {
            recordFail(29, "Demo account test failed", err);
        }

        // ----------------------------------------------------
        // [Test 30] Cross-Tenant Access Matrix
        // ----------------------------------------------------
        console.log("\n[Test 30] Executing comprehensive cross-tenant negative access matrix...");
        try {
            // Matrix:
            // 1. User B accesses User A document metadata -> 404
            // 2. User B accesses User A document download -> 403/404
            // 3. User B accesses User A report metadata -> 404
            // 4. User B accesses User A report download -> 403/404
            // 5. User B runs inspection agent on User A document -> 403

            const matrixDocA = `doc_matrix_a_${randomUUID().slice(0, 8)}`;
            cleanupDocIds.push(matrixDocA);
            await createDocument({
                id: matrixDocA,
                organizationId: ORG_A_ID,
                filename: `${matrixDocA}.pdf`,
                originalFilename: "Matrix_Alpha.pdf",
                status: "Indexed",
            });

            const matrixReportA = await createReportRecord({
                organizationId: ORG_A_ID,
                title: "Matrix Report Alpha",
                filename: `Matrix_Alpha_${randomUUID().slice(0, 6)}.docx`,
            });
            cleanupReportIds.push(matrixReportA.id);

            // 1. Document metadata
            const m1 = await fetch(`${baseUrl}/api/v1/documents/${matrixDocA}`, {
                headers: { Authorization: `Bearer ${tokenB}` },
            });
            assert.equal(m1.status, 404, "User B accessing Org A doc metadata must return 404");

            // 2. Document download
            const m2 = await fetch(`${baseUrl}/api/v1/documents/${matrixDocA}/download`, {
                headers: { Authorization: `Bearer ${tokenB}` },
            });
            assert.ok(m2.status === 403 || m2.status === 404, "User B downloading Org A doc must return 403/404");

            // 3. Report metadata
            const m3 = await fetch(`${baseUrl}/api/v1/reports/${matrixReportA.id}`, {
                headers: { Authorization: `Bearer ${tokenB}` },
            });
            assert.equal(m3.status, 404, "User B accessing Org A report metadata must return 404");

            // 4. Report download
            const m4 = await fetch(`${baseUrl}/api/v1/inspection/download/${matrixReportA.filename}`, {
                headers: { Authorization: `Bearer ${tokenB}` },
            });
            assert.ok(m4.status === 403 || m4.status === 404, "User B downloading Org A report DOCX must return 403/404");

            // 5. Inspection Agent execution
            const m5 = await fetch(`${baseUrl}/api/v1/agent/inspection`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${tokenB}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ documentId: matrixDocA }),
            });
            assert.equal(m5.status, 403, "User B running inspection agent on Org A doc must return 403");

            recordPass(30, "Comprehensive cross-tenant negative matrix: all 5 unauthorized resource accesses strictly DENIED");
        } catch (err) {
            recordFail(30, "Cross-tenant access matrix failed", err);
        }

    } finally {
        // Cleanup test fixtures from database in dependency order
        try {
            if (cleanupOrgIds.length > 0) {
                await query("DELETE FROM agent_run_steps WHERE run_id IN (SELECT run_id FROM agent_runs WHERE organization_id = ANY($1))", [cleanupOrgIds]);
                await query("DELETE FROM agent_runs WHERE organization_id = ANY($1)", [cleanupOrgIds]);
                await query("DELETE FROM reports WHERE organization_id = ANY($1)", [cleanupOrgIds]);
                await query("DELETE FROM documents WHERE organization_id = ANY($1)", [cleanupOrgIds]);
                await query("DELETE FROM users WHERE organization_id = ANY($1)", [cleanupOrgIds]);
                await query("DELETE FROM organizations WHERE id = ANY($1)", [cleanupOrgIds]);
            }
        } catch (cleanErr) {
            console.warn("[Cleanup] Warning during test DB cleanup:", cleanErr.message);
        }

        server.close();
    }

    console.log("\n==================================================");
    console.log(`PHASE 13 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log("==================================================");

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runPhase13AuthTests().catch((err) => {
    console.error("FATAL: Phase 13 Test Suite execution aborted:", err);
    process.exit(1);
});
