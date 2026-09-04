import assert from "node:assert";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import app from "../src/app.js";
import { generateToken } from "../src/utils/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runReportsTests() {
  console.log("==============================================");
  console.log("PR #19 — Reports API & Persistence Test Suite");
  console.log("==============================================\n");

  const server = app.listen(0);
  const port = server.address().port;
  const BASE_URL = process.env.TEST_BASE_URL || `http://127.0.0.1:${port}`;

  try {
    // Authenticate demo user for private reports operations
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.DEMO_USER_EMAIL || "engineer@example.com",
        password: process.env.DEMO_USER_PASSWORD || "DemoPassword123!",
      }),
    });
    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    const authHeaders = { Authorization: `Bearer ${token}` };

    // 1. GET /api/v1/reports
    console.log("[1] Testing GET /api/v1/reports (initial)...");
    const initRes = await fetch(`${BASE_URL}/api/v1/reports`, { headers: authHeaders });
    assert.equal(initRes.status, 200, "Must return HTTP 200");
    const initData = await initRes.json();
    assert.equal(initData.success, true, "Must have success: true");
    assert.ok(Array.isArray(initData.data), "data must be an array");
    const initialTotal = initData.total !== undefined ? initData.total : initData.data.length;
    console.log(`    ✓ Returned HTTP 200 with ${initialTotal} existing report(s)`);

    // 2. GET /api/v1/reports/:id (non-existent)
    console.log("\n[2] Testing GET /api/v1/reports/:id with non-existent ID...");
    const notFoundRes = await fetch(`${BASE_URL}/api/v1/reports/00000000-0000-0000-0000-000000000000`, { headers: authHeaders });
    assert.equal(notFoundRes.status, 404, "Must return HTTP 404 for unknown report");
    console.log("    ✓ Handled non-existent report ID with HTTP 404");

    // 3. Trigger inspection workflow to create a real report
    const docId = "127a43a0-a49f-434e-8deb-2fb106d1f599";
    console.log(`\n[3] Triggering POST /api/v1/inspection/workflow with docId: ${docId}...`);
    const wfRes = await fetch(`${BASE_URL}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ documentId: docId }),
    });
    assert.equal(wfRes.status, 200, "Workflow must return HTTP 200");
    const wfBody = await wfRes.json();
    assert.equal(wfBody.success, true);
    assert.ok(wfBody.data.report, "Response must include persisted report record");
    assert.ok(wfBody.data.reportId, "Response must include reportId");
    const createdReport = wfBody.data.report;
    console.log(`    ✓ Workflow succeeded. Persisted report ID: ${createdReport.id}`);
    console.log(`    ✓ Stored filename: ${createdReport.filename}`);
    console.log(`    ✓ Stored risk level: ${createdReport.riskLevel}`);
    console.log(`    ✓ Stored status: ${createdReport.status}`);

    // 4. Verify report is listed in GET /api/v1/reports
    console.log("\n[4] Verifying report appears in GET /api/v1/reports...");
    const listRes = await fetch(`${BASE_URL}/api/v1/reports`, { headers: authHeaders });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    const currentTotal = listData.total !== undefined ? listData.total : listData.data.length;
    assert.equal(currentTotal, initialTotal + 1, "Report count must increment by 1");
    const foundReport = listData.data.find((r) => r.id === createdReport.id);
    assert.ok(foundReport, "Newly created report must be present in listing");
    assert.equal(foundReport.filename, createdReport.filename);
    assert.equal(foundReport.status, "GENERATED");
    assert.ok(foundReport.createdAt, "createdAt must be populated");
    assert.ok(foundReport.downloadUrl, "downloadUrl must be populated");
    console.log("    ✓ Report correctly listed with document metadata and downloadUrl");

    // 5. Verify GET /api/v1/reports/:id
    console.log(`\n[5] Verifying GET /api/v1/reports/${createdReport.id}...`);
    const singleRes = await fetch(`${BASE_URL}/api/v1/reports/${createdReport.id}`, { headers: authHeaders });
    assert.equal(singleRes.status, 200);
    const singleData = await singleRes.json();
    assert.equal(singleData.success, true);
    assert.equal(singleData.data.id, createdReport.id);
    assert.equal(singleData.data.filename, createdReport.filename);
    console.log("    ✓ Retrieved exact report by ID");

    // 6. Test organization scoping using an authenticated token from another organization
    console.log("\n[6] Testing organization scoping for reports...");
    const otherToken = generateToken({
      userId: "00000000-0000-0000-0000-888888888888",
      organizationId: "00000000-0000-0000-0000-999999999999",
      email: "other@tenant.local",
      role: "engineer",
    });
    const otherOrgRes = await fetch(`${BASE_URL}/api/v1/reports`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    assert.equal(otherOrgRes.status, 200);
    const otherOrgData = await otherOrgRes.json();
    const leakedReport = otherOrgData.data.find((r) => r.id === createdReport.id);
    assert.strictEqual(leakedReport, undefined, "Report must not leak into another organization");
    console.log("    ✓ Organization isolation confirmed (0 leaked reports)");

    // 7. Negative test: Failed workflow does not create report
    console.log("\n[7] Testing failed workflow does not create report...");
    const failRes = await fetch(`${BASE_URL}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({}),
    });
    assert.equal(failRes.status, 400, "Invalid workflow call must return 400");
    const postFailList = await fetch(`${BASE_URL}/api/v1/reports`, { headers: authHeaders });
    const postFailData = await postFailList.json();
    const postFailTotal = postFailData.total !== undefined ? postFailData.total : postFailData.data.length;
    assert.equal(postFailTotal, initialTotal + 1, "Report count must not change on failed call");
    console.log("    ✓ Failed request did not create any phantom reports");

    console.log("\n==============================================");
    console.log("✅ ALL PR #19 REPORTS TESTS PASSED SUCCESSFULLY");
    console.log("==============================================\n");
  } finally {
    server.close();
  }
}

runReportsTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Reports test failed:", err);
  process.exit(1);
});
