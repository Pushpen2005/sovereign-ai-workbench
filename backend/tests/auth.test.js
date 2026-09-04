import assert from "node:assert";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import { query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { createDocument } from "../src/repositories/documents.repository.js";
import { createReportRecord } from "../src/services/reports.service.js";

/**
 * Phase 2 — Authentication & Multi-Tenant Authorization Test Suite
 * Validates all 25 required auth security dimensions.
 */
async function runAuthTests() {
  console.log("==================================================");
  console.log("Phase 2: Authentication & Multi-Tenant Test Suite");
  console.log("==================================================");

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];
  const cleanupReportIds = [];

  try {
    // ----------------------------------------------------
    // [1] Public Health Check Remains Accessible
    // ----------------------------------------------------
    console.log("\n[1] Public Health Endpoint Access");
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200, "Health endpoint must return HTTP 200");
    const healthData = await healthRes.json();
    assert.equal(healthData.status, "ok");
    console.log("  ✅ PASS: /api/v1/health is publicly accessible without token");

    // ----------------------------------------------------
    // [2] Registration Validations
    // ----------------------------------------------------
    console.log("\n[2] Registration Input Validation");

    // 2a. Weak Password (< 6 chars)
    const weakPassRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: `weak_${randomUUID().slice(0, 8)}@example.com`,
        password: "123",
      }),
    });
    assert.equal(weakPassRes.status, 400, "Weak password must be rejected with HTTP 400");
    console.log("  ✅ PASS: Weak password (< 6 chars) rejected");

    // 2b. Invalid Email Format
    const badEmailRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "not-an-email",
        password: "Password123!",
      }),
    });
    assert.equal(badEmailRes.status, 400, "Invalid email format must return HTTP 400");
    console.log("  ✅ PASS: Malformed email rejected");

    // 2c. Successful Registration
    const testEmail1 = `engineer_${randomUUID().slice(0, 8)}@refinery.local`;
    const regRes1 = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Plant Operator A",
        email: testEmail1,
        password: "SecurePassword123!",
        organizationName: "MRPL Phase2 Testing Unit",
      }),
    });
    assert.equal(regRes1.status, 201, "Registration must succeed with HTTP 201");
    const regData1 = await regRes1.json();
    assert.equal(regData1.success, true);
    assert.ok(regData1.data.token, "Response must include signed JWT");
    assert.equal(regData1.data.user.email, testEmail1.toLowerCase());
    assert.strictEqual(regData1.data.user.password_hash, undefined, "Never leak password hash");
    cleanupUserIds.push(regData1.data.user.id);
    cleanupOrgIds.push(regData1.data.user.organizationId);
    console.log("  ✅ PASS: Successful user registration with JWT token issuance");

    // 2d. Duplicate Email Registration
    const dupRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Duplicate User",
        email: testEmail1,
        password: "AnotherPassword123!",
      }),
    });
    assert.equal(dupRes.status, 409, "Duplicate email registration must return HTTP 409 Conflict");
    console.log("  ✅ PASS: Duplicate registration rejected with HTTP 409 Conflict");

    // ----------------------------------------------------
    // [3] Login Flow & Credential Validation
    // ----------------------------------------------------
    console.log("\n[3] Login Flow & Authentication");

    // 3a. Unknown Email
    const unknownRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nonexistent_user@example.com",
        password: "SomePassword123!",
      }),
    });
    assert.equal(unknownRes.status, 401, "Unknown email must return HTTP 401");
    console.log("  ✅ PASS: Unknown email rejected with generic 401 message");

    // 3b. Wrong Password
    const wrongPassRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail1,
        password: "IncorrectPassword!",
      }),
    });
    assert.equal(wrongPassRes.status, 401, "Wrong password must return HTTP 401");
    console.log("  ✅ PASS: Wrong password rejected with generic 401 message");

    // 3c. Successful Login
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail1,
        password: "SecurePassword123!",
      }),
    });
    assert.equal(loginRes.status, 200, "Valid login must return HTTP 200");
    const loginData = await loginRes.json();
    assert.equal(loginData.success, true);
    assert.ok(loginData.data.token, "Login must return a JWT");
    assert.strictEqual(loginData.data.user.password_hash, undefined, "Password hash must not be returned");
    const token1 = loginData.data.token;
    console.log("  ✅ PASS: Successful login returned valid JWT");

    // ----------------------------------------------------
    // [4] Current User Profile (/api/v1/auth/me)
    // ----------------------------------------------------
    console.log("\n[4] Profile Retrieval via /api/v1/auth/me");

    // 4a. Without token
    const meNoTokenRes = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(meNoTokenRes.status, 401, "Missing token must return HTTP 401");
    console.log("  ✅ PASS: /auth/me without token rejected (401)");

    // 4b. With valid token
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(meRes.status, 200, "/auth/me with token must return HTTP 200");
    const meData = await meRes.json();
    assert.equal(meData.data.email, testEmail1.toLowerCase());
    assert.equal(meData.data.id, regData1.data.user.id);
    console.log("  ✅ PASS: /auth/me returns authenticated user identity");

    // ----------------------------------------------------
    // [5] JWT Signature, Format & Expiration Validation
    // ----------------------------------------------------
    console.log("\n[5] Token Integrity & Boundary Checks");

    // 5a. Malformed Header (missing 'Bearer ')
    const malformedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: token1 },
    });
    assert.equal(malformedRes.status, 401, "Malformed Authorization header must return 401");
    console.log("  ✅ PASS: Malformed authorization header rejected");

    // 5b. Forged / Tampered Token
    const forgedToken = token1.slice(0, -5) + "abcde";
    const forgedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    assert.equal(forgedRes.status, 401, "Forged token signature must return 401");
    console.log("  ✅ PASS: Tampered token signature rejected");

    // 5c. Expired Token
    const expiredToken = generateToken(
      { id: regData1.data.user.id, email: testEmail1, organizationId: regData1.data.user.organizationId },
      { expiresIn: "-10s" }
    );
    const expiredRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredRes.status, 401, "Expired token must return 401");
    console.log("  ✅ PASS: Expired token safely rejected");

    // ----------------------------------------------------
    // [6] Mandatory Multi-Tenant Security & Header Spoofing Isolation Test
    // ----------------------------------------------------
    console.log("\n[6] Multi-Tenant Organization Isolation (Mandatory Security Test)");

    // Step A: Setup Organization A and Organization B
    const orgAId = randomUUID();
    const orgBId = randomUUID();
    cleanupOrgIds.push(orgAId, orgBId);

    await query(`INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`, [
      orgAId,
      "Refinery Unit A (Isolated)",
    ]);
    await query(`INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`, [
      orgBId,
      "Chemical Processing B (Isolated)",
    ]);

    // Step B: Setup User A and User B
    const userAEmail = `user_a_${randomUUID().slice(0, 6)}@refinery-a.local`;
    const userBEmail = `user_b_${randomUUID().slice(0, 6)}@chem-b.local`;

    const userAReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Engineer A",
        email: userAEmail,
        password: "PasswordOrgA123!",
        organizationId: orgAId,
      }),
    });
    const userAData = await userAReg.json();
    const tokenA = userAData.data.token;
    cleanupUserIds.push(userAData.data.user.id);

    const userBReg = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Engineer B",
        email: userBEmail,
        password: "PasswordOrgB123!",
        organizationId: orgBId,
      }),
    });
    const userBData = await userBReg.json();
    const tokenB = userBData.data.token;
    cleanupUserIds.push(userBData.data.user.id);

    // Step C: Setup Document A and Document B
    const docAId = randomUUID();
    const docBId = randomUUID();
    cleanupDocIds.push(docAId, docBId);

    await createDocument({
      id: docAId,
      organizationId: orgAId,
      filename: `Confidential_Turbine_A_${docAId.slice(0, 6)}.pdf`,
      originalFilename: "Turbine_Manual_A.pdf",
      status: "Indexed",
      chunksStored: 10,
    });

    await createDocument({
      id: docBId,
      organizationId: orgBId,
      filename: `Proprietary_Reactor_B_${docBId.slice(0, 6)}.pdf`,
      originalFilename: "Reactor_Design_B.pdf",
      status: "Indexed",
      chunksStored: 12,
    });

    // Verification 1: User A lists documents -> sees Document A, does NOT see Document B
    const listARes = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listARes.status, 200);
    const listAData = await listARes.json();
    const userADocIds = listAData.documents.map((d) => d.documentId || d.id);
    assert.ok(userADocIds.includes(docAId), "User A must see Document A");
    assert.ok(!userADocIds.includes(docBId), "User A must NOT see Document B");
    console.log("  ✅ PASS: User A document listing strictly isolated to Organization A");

    // Verification 2: User B lists documents -> sees Document B, does NOT see Document A
    const listBRes = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(listBRes.status, 200);
    const listBData = await listBRes.json();
    const userBDocIds = listBData.documents.map((d) => d.documentId || d.id);
    assert.ok(userBDocIds.includes(docBId), "User B must see Document B");
    assert.ok(!userBDocIds.includes(docAId), "User B must NOT see Document A");
    console.log("  ✅ PASS: User B document listing strictly isolated to Organization B");

    // Verification 3: Direct document lookup isolation
    // User A fetches Document A -> ALLOWED (200)
    const getAforARes = await fetch(`${baseUrl}/api/v1/documents/${docAId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getAforARes.status, 200, "User A must be allowed to read Document A");

    // User A fetches Document B -> DENIED (404)
    const getBforARes = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getBforARes.status, 404, "User A direct lookup of Document B must return 404");

    // User B fetches Document B -> ALLOWED (200)
    const getBforBRes = await fetch(`${baseUrl}/api/v1/documents/${docBId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(getBforBRes.status, 200, "User B must be allowed to read Document B");

    // User B fetches Document A -> DENIED (404)
    const getAforBRes = await fetch(`${baseUrl}/api/v1/documents/${docAId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(getAforBRes.status, 404, "User B direct lookup of Document A must return 404");
    console.log("  ✅ PASS: Cross-organization direct document lookups strictly blocked (404)");

    // ----------------------------------------------------
    // Verification 4: Header Spoofing Attack
    // User A provides valid User A JWT, but sends x-organization-id: Org B
    // Expected: 403 Forbidden
    // ----------------------------------------------------
    const spoofRes = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "x-organization-id": orgBId,
      },
    });
    assert.equal(spoofRes.status, 403, "Cross-organization header spoofing must be rejected with 403");
    const spoofData = await spoofRes.json();
    assert.equal(spoofData.success, false);
    console.log("  ✅ PASS: Cross-organization header spoofing attack blocked (HTTP 403 Forbidden)");

    // ----------------------------------------------------
    // [7] Report Isolation
    // ----------------------------------------------------
    console.log("\n[7] Report Isolation Across Organizations");

    const reportB = await createReportRecord({
      documentId: docBId,
      organizationId: orgBId,
      title: "Confidential Inspection Note B",
      filename: `Approval_Note_B_${randomUUID().slice(0, 6)}.docx`,
      riskLevel: "HIGH",
      status: "GENERATED",
      task: "Inspection Analysis Unit B",
    });
    cleanupReportIds.push(reportB.id);

    // User A attempts to list reports -> Report B must NOT be visible
    const reportsARes = await fetch(`${baseUrl}/api/v1/reports`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(reportsARes.status, 200);
    const reportsAData = await reportsARes.json();
    const aReportIds = reportsAData.data.map((r) => r.id);
    assert.ok(!aReportIds.includes(reportB.id), "User A must not see Report B in listing");

    // User A attempts direct get by ID of Report B -> 404
    const getReportARes = await fetch(`${baseUrl}/api/v1/reports/${reportB.id}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getReportARes.status, 404, "User A direct access to Report B must return 404");

    // User B attempts direct get by ID of Report B -> 200
    const getReportBRes = await fetch(`${baseUrl}/api/v1/reports/${reportB.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(getReportBRes.status, 200, "User B direct access to Report B must succeed");
    console.log("  ✅ PASS: Report listing and direct lookup strictly isolated by organization");

    // ----------------------------------------------------
    // [8] Pre-Seeded SIH Demo Account Login
    // ----------------------------------------------------
    console.log("\n[8] SIH Demo Account Verification");
    const demoEmail = process.env.DEMO_USER_EMAIL || "engineer@example.com";
    const demoPassword = process.env.DEMO_USER_PASSWORD || "DemoPassword123!";

    const demoLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: demoEmail,
        password: demoPassword,
      }),
    });
    assert.equal(demoLoginRes.status, 200, "Default demo account must authenticate successfully");
    const demoLoginData = await demoLoginRes.json();
    assert.equal(demoLoginData.success, true);
    assert.ok(demoLoginData.data.token);
    assert.equal(demoLoginData.data.user.email, demoEmail.toLowerCase());
    console.log(`  ✅ PASS: Pre-seeded demo account '${demoEmail}' successfully logs in`);

    console.log("\n==================================================");
    console.log("✅ ALL PHASE 2 AUTHENTICATION & ISOLATION TESTS PASSED");
    console.log("==================================================");
  } finally {
    server.close();

    // Clean up created test entities
    try {
      if (cleanupDocIds.length > 0) {
        await query(`DELETE FROM documents WHERE id = ANY($1)`, [cleanupDocIds]);
      }
      if (cleanupReportIds.length > 0) {
        await query(`DELETE FROM reports WHERE id = ANY($1)`, [cleanupReportIds]);
      }
      if (cleanupUserIds.length > 0) {
        await query(`DELETE FROM users WHERE id = ANY($1)`, [cleanupUserIds]);
      }
      if (cleanupOrgIds.length > 0) {
        await query(`DELETE FROM organizations WHERE id = ANY($1)`, [cleanupOrgIds]);
      }
    } catch (cleanupErr) {
      console.warn("Notice: Test cleanup had non-fatal warning:", cleanupErr.message);
    }
  }
}

runAuthTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Auth test suite failed:", err);
  process.exit(1);
});
