/**
 * Phase 1 — Secure Organization Authentication Boundary Test Suite
 *
 * Explicitly validates the 12 required authentication and organization boundary rules:
 *
 * TEST 1: Unauthenticated request to a private document endpoint (401)
 * TEST 2: Unauthenticated request to a private chat endpoint (401)
 * TEST 3: Unauthenticated request to a private inspection endpoint (401)
 * TEST 4: Unauthenticated request to a private reports endpoint (401)
 * TEST 5: Unauthenticated request to a private agent endpoint (401)
 * TEST 6: Unauthenticated request with x-organization-id header (401 - header cannot authenticate)
 * TEST 7: Authenticated Company A user with conflicting x-organization-id header = B (403)
 * TEST 8: Authenticated Company A user with body organizationId = B (must strictly execute under Org A)
 * TEST 9: Authenticated Company A user with query ?organizationId=B (must strictly execute under Org A)
 * TEST 10: Authenticated demo user continues to access demo organization's authorized APIs
 * TEST 11: Invalid JWT to private endpoint (401)
 * TEST 12: Expired JWT to private endpoint (401)
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import { DEFAULT_ORGANIZATION_ID } from "../src/config/organization.js";

function buildMinimalPdf(lines) {
  const parts = [];
  const offsets = {};
  let pos = 0;

  function write(str) {
    const buf = Buffer.from(str, "latin1");
    parts.push(buf);
    pos += buf.length;
  }

  function writeObj(id, str) {
    offsets[id] = pos;
    write(`${id} 0 obj\n${str}\nendobj\n`);
  }

  write("%PDF-1.4\n");
  writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  writeObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  writeObj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
  );

  let stream = "BT\n/F1 12 Tf\n50 720 Td\n18 TL\n";
  for (let j = 0; j < lines.length; j++) {
    const escaped = lines[j].replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    stream += j === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
  }
  stream += "ET\n";

  const streamBytes = Buffer.from(stream, "latin1");
  offsets[4] = pos;
  write(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  parts.push(streamBytes);
  pos += streamBytes.length;
  write("\nendstream\nendobj\n");

  const startXref = pos;
  write(`xref\n0 5\n0000000000 65535 f \n`);
  for (let i = 1; i <= 4; i++) {
    write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

async function runAuthBoundarySuite() {
  console.log("==================================================");
  console.log("Phase 1: Organization Authentication Boundary Suite");
  console.log("==================================================");

  // Initialize schema and demo seeds if needed
  try {
    await initDb();
  } catch (err) {
    console.warn("DB init warning:", err.message);
  }

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const cleanupOrgIds = [];
  const cleanupUserIds = [];
  const cleanupDocIds = [];

  try {
    // Setup test organizations and users
    const orgAId = randomUUID();
    const orgBId = randomUUID();
    cleanupOrgIds.push(orgAId, orgBId);

    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgAId, `Company A ${orgAId.slice(0, 6)}`]);
    await query("INSERT INTO organizations (id, name) VALUES ($1, $2)", [orgBId, `Company B ${orgBId.slice(0, 6)}`]);

    const userAId = randomUUID();
    const userBId = randomUUID();
    cleanupUserIds.push(userAId, userBId);

    const tokenA = generateToken({
      userId: userAId,
      organizationId: orgAId,
      email: `alice_${orgAId.slice(0, 6)}@company-a.local`,
      role: "engineer",
    });

    const tokenB = generateToken({
      userId: userBId,
      organizationId: orgBId,
      email: `bob_${orgBId.slice(0, 6)}@company-b.local`,
      role: "engineer",
    });

    // Seed a document belonging to Org A
    const docAId = randomUUID();
    cleanupDocIds.push(docAId);
    await query(
      "INSERT INTO documents (id, organization_id, filename, original_filename, status) VALUES ($1, $2, $3, $4, $5)",
      [docAId, orgAId, "DocA_Spec.pdf", "DocA_Spec.pdf", "Indexed"]
    );

    // ----------------------------------------------------
    // TEST 1: Unauthenticated request to private documents
    // ----------------------------------------------------
    console.log("\n[TEST 1] Unauthenticated request to private document endpoint");
    const test1Res = await fetch(`${baseUrl}/api/v1/documents`);
    assert.equal(test1Res.status, 401, "GET /api/v1/documents without token must return 401");
    console.log("  ✅ PASS: Unauthenticated GET /api/v1/documents rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 2: Unauthenticated request to private chat
    // ----------------------------------------------------
    console.log("\n[TEST 2] Unauthenticated request to private chat endpoint");
    const test2Res = await fetch(`${baseUrl}/api/v1/chat/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Hello" }),
    });
    assert.equal(test2Res.status, 401, "POST /api/v1/chat/ask without token must return 401");
    console.log("  ✅ PASS: Unauthenticated POST /api/v1/chat/ask rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 3: Unauthenticated request to private inspection
    // ----------------------------------------------------
    console.log("\n[TEST 3] Unauthenticated request to private inspection endpoint");
    const test3Res = await fetch(`${baseUrl}/api/v1/inspection/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: docAId }),
    });
    assert.equal(test3Res.status, 401, "POST /api/v1/inspection/analyze without token must return 401");
    console.log("  ✅ PASS: Unauthenticated POST /api/v1/inspection/analyze rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 4: Unauthenticated request to private reports
    // ----------------------------------------------------
    console.log("\n[TEST 4] Unauthenticated request to private reports endpoint");
    const test4Res = await fetch(`${baseUrl}/api/v1/reports`);
    assert.equal(test4Res.status, 401, "GET /api/v1/reports without token must return 401");
    console.log("  ✅ PASS: Unauthenticated GET /api/v1/reports rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 5: Unauthenticated request to private agent
    // ----------------------------------------------------
    console.log("\n[TEST 5] Unauthenticated request to private agent endpoint");
    const test5Res = await fetch(`${baseUrl}/api/v1/agent/runs`);
    assert.equal(test5Res.status, 401, "GET /api/v1/agent/runs without token must return 401");
    console.log("  ✅ PASS: Unauthenticated GET /api/v1/agent/runs rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 6: Unauthenticated request with x-organization-id header
    // ----------------------------------------------------
    console.log("\n[TEST 6] Unauthenticated request with x-organization-id header (spoofing attempt)");
    const test6Res = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { "x-organization-id": orgAId },
    });
    assert.equal(test6Res.status, 401, "Unauthenticated request with x-organization-id header must return 401");
    console.log("  ✅ PASS: Header x-organization-id cannot authenticate; rejected with HTTP 401");

    // ----------------------------------------------------
    // TEST 7: Authenticated Company A user with header x-organization-id = Company B
    // ----------------------------------------------------
    console.log("\n[TEST 7] Authenticated Company A user with conflicting x-organization-id = Company B");
    const test7Res = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "x-organization-id": orgBId,
      },
    });
    assert.equal(test7Res.status, 403, "Conflicting x-organization-id header must return 403 Forbidden");
    console.log("  ✅ PASS: Header conflicting with JWT organizationId rejected with HTTP 403 Forbidden");

    // ----------------------------------------------------
    // TEST 8: Authenticated Company A user with body organizationId = Company B
    // ----------------------------------------------------
    console.log("\n[TEST 8] Authenticated Company A user with body organizationId = Company B");
    const testPdfBuffer = buildMinimalPdf([
      "ORG A CONFIDENTIAL SPECIFICATION",
      "Company A Confidential Operational Manual",
    ]);

    const formData = new FormData();
    formData.append(
      "document",
      new Blob([testPdfBuffer], { type: "application/pdf" }),
      "OrgA_TestDoc.pdf"
    );
    formData.append("organizationId", orgBId); // Attempt to switch tenant via body

    const test8Res = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenA}`,
      },
      body: formData,
    });
    const test8Data = await test8Res.json();
    assert.equal(test8Res.status, 200, "POST /api/v1/documents should succeed");
    assert.equal(
      test8Data.organizationId,
      orgAId,
      "Document must be created under authenticated Org A, ignoring body.organizationId"
    );
    cleanupDocIds.push(test8Data.documentId);

    // Verify in PostgreSQL that the document record was strictly saved with orgAId, NOT orgBId
    const docInDb = await query("SELECT organization_id FROM documents WHERE id = $1", [test8Data.documentId]);
    assert.equal(docInDb.rows[0]?.organization_id, orgAId, "PostgreSQL record must be bound to orgAId");
    console.log("  ✅ PASS: Client body.organizationId ignored; bound strictly to JWT organizationId (Company A)");

    // ----------------------------------------------------
    // TEST 9: Authenticated Company A user with query ?organizationId=Company B
    // ----------------------------------------------------
    console.log("\n[TEST 9] Authenticated Company A user with query ?organizationId=Company B");
    const test9Res = await fetch(`${baseUrl}/api/v1/documents?organizationId=${orgBId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const test9Data = await test9Res.json();
    assert.equal(test9Res.status, 200, "GET /api/v1/documents should succeed");
    // All documents returned must belong to Org A, never Org B
    for (const doc of test9Data.documents) {
      assert.equal(
        doc.organizationId,
        orgAId,
        "All returned documents must belong to Org A, ignoring query.organizationId"
      );
    }
    console.log("  ✅ PASS: Client query ?organizationId ignored; returned only Company A documents");

    // ----------------------------------------------------
    // TEST 10: Authenticated demo user continues to access demo organization APIs
    // ----------------------------------------------------
    console.log("\n[TEST 10] Authenticated demo user login & authorized access");
    const demoLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "engineer@example.com",
        password: process.env.DEMO_USER_PASSWORD || "DemoPassword123!",
      }),
    });
    assert.equal(demoLoginRes.status, 200, "Demo user login must return HTTP 200");
    const demoLoginData = await demoLoginRes.json();
    assert.equal(Boolean(demoLoginData.data?.token), true, "Demo login must return JWT token");
    const demoToken = demoLoginData.data.token;
    const demoOrgId = demoLoginData.data.user.organizationId;
    assert.ok(demoOrgId, "Demo user must belong to an organization");

    // Access private documents with demo token
    const demoDocsRes = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${demoToken}` },
    });
    assert.equal(demoDocsRes.status, 200, "Demo user can access private documents endpoint");
    const demoDocsData = await demoDocsRes.json();
    assert.equal(Array.isArray(demoDocsData.documents), true, "Demo user receives documents array");
    for (const doc of demoDocsData.documents) {
      assert.equal(
        doc.organizationId,
        demoOrgId,
        "Returned documents must belong to the demo user's organization"
      );
    }
    console.log("  ✅ PASS: Authenticated demo user successfully logs in and accesses Demo Organization data");

    // ----------------------------------------------------
    // TEST 11: Invalid JWT to private endpoint
    // ----------------------------------------------------
    console.log("\n[TEST 11] Invalid JWT to private endpoint");
    const test11Res = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: "Bearer totally.invalid.forgedtoken" },
    });
    assert.equal(test11Res.status, 401, "Invalid JWT must return 401");
    console.log("  ✅ PASS: Invalid JWT rejected with HTTP 401 Unauthorized");

    // ----------------------------------------------------
    // TEST 12: Expired JWT to private endpoint
    // ----------------------------------------------------
    console.log("\n[TEST 12] Expired JWT to private endpoint");
    const secret = process.env.JWT_SECRET || "sovereign-ai-workbench-dev-jwt-secret-key-replace-in-production";
    const expiredToken = jwt.sign(
      { sub: userAId, userId: userAId, organizationId: orgAId },
      secret,
      { expiresIn: "-1h" }
    );
    const test12Res = await fetch(`${baseUrl}/api/v1/documents`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(test12Res.status, 401, "Expired JWT must return 401");
    console.log("  ✅ PASS: Expired JWT rejected with HTTP 401 Unauthorized");

    console.log("\n==================================================");
    console.log("✅ ALL 12 PHASE 1 AUTH BOUNDARY TESTS PASSED");
    console.log("==================================================");
  } finally {
    // Cleanup temporary test data
    for (const docId of cleanupDocIds) {
      await query("DELETE FROM documents WHERE id = $1", [docId]).catch(() => {});
    }
    for (const orgId of cleanupOrgIds) {
      await query("DELETE FROM documents WHERE organization_id = $1", [orgId]).catch(() => {});
      await query("DELETE FROM users WHERE organization_id = $1", [orgId]).catch(() => {});
      await query("DELETE FROM organizations WHERE id = $1", [orgId]).catch(() => {});
    }
    for (const userId of cleanupUserIds) {
      await query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
    }
    server.close();
  }
}

runAuthBoundarySuite().catch((err) => {
  console.error("❌ Phase 1 test failure:", err);
  process.exit(1);
});
