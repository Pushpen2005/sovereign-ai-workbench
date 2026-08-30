import assert from "node:assert/strict";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";

async function run() {
  console.log("=== Testing One-Click Inspection Workflow on Existing Document ===\n");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test backend server running at ${baseUrl}`);

  try {
    // 1. Fetch available documents from PostgreSQL
    console.log("\n[1] Fetching existing documents from PostgreSQL...");
    const listRes = await fetch(`${baseUrl}/api/v1/documents`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.documents && listData.documents.length > 0, "Must have at least 1 document");
    const targetDoc = listData.documents[0];
    const initialDocCount = listData.documents.length;
    console.log(`    ✓ Selected existing document: ${targetDoc.filename} (${targetDoc.documentId})`);

    // 2. Call POST /api/v1/inspection/workflow with { documentId }
    console.log("\n[2] Executing POST /api/v1/inspection/workflow on existing documentId...");
    const workflowRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: targetDoc.documentId,
        task: "Analyze this inspection report and identify findings",
      }),
    });

    assert.equal(workflowRes.status, 200, `Expected 200, got ${workflowRes.status}`);
    const workflowJson = await workflowRes.json();
    assert.equal(workflowJson.success, true);
    assert.ok(workflowJson.data, "Response must have data object");
    assert.equal(workflowJson.data.documentId, targetDoc.documentId);
    assert.ok(workflowJson.data.approvalNote?.filename, "Must return generated approvalNote filename");
    assert.ok(workflowJson.data.approvalNote?.downloadUrl, "Must return downloadUrl");
    assert.ok(Array.isArray(workflowJson.data.findings), "findings must be an array");
    assert.ok(Array.isArray(workflowJson.data.riskAssessments), "riskAssessments must be an array");
    assert.ok(Array.isArray(workflowJson.data.recommendations), "recommendations must be an array");
    assert.ok(Array.isArray(workflowJson.data.citations), "citations must be an array");

    console.log(`    ✓ Workflow finished:`);
    console.log(`      • Findings: ${workflowJson.data.findings.length}`);
    console.log(`      • Risk level: ${workflowJson.data.riskAssessments[0]?.level || "N/A"}`);
    console.log(`      • Approval Note: ${workflowJson.data.approvalNote.filename}`);
    console.log(`      • Download URL: ${workflowJson.data.approvalNote.downloadUrl}`);

    // 3. Verify no duplicate document was created in PostgreSQL
    console.log("\n[3] Verifying no duplicate document was created in PostgreSQL...");
    const checkListRes = await fetch(`${baseUrl}/api/v1/documents`);
    const checkListData = await checkListRes.json();
    assert.equal(
      checkListData.documents.length,
      initialDocCount,
      "Document count in PostgreSQL must remain unchanged (no duplicate documents created)"
    );
    console.log(`    ✓ Verified: Document count unchanged at ${initialDocCount}`);

    // 4. Test downloading the generated DOCX file
    console.log("\n[4] Testing GET download endpoint for generated DOCX...");
    const downloadRes = await fetch(`${baseUrl}${workflowJson.data.approvalNote.downloadUrl}`);
    assert.equal(downloadRes.status, 200);
    const contentType = downloadRes.headers.get("content-type");
    assert.ok(
      contentType.includes("wordprocessingml") || contentType.includes("octet-stream"),
      `Expected DOCX content type, got: ${contentType}`
    );
    const docxBuffer = await downloadRes.arrayBuffer();
    assert.ok(docxBuffer.byteLength > 1000, `Downloaded DOCX file must be non-empty, got ${docxBuffer.byteLength} bytes`);
    console.log(`    ✓ Downloaded valid DOCX (${docxBuffer.byteLength} bytes)`);

    // 5. Test negative cases
    console.log("\n[5] Testing edge and error cases...");

    // Case 5a: Missing documentId
    const missingRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingRes.status, 400);
    const missingJson = await missingRes.json();
    assert.equal(missingJson.success, false);
    console.log("    ✓ Missing documentId correctly rejected with 400");

    // Case 5b: Empty string documentId
    const emptyRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: "   " }),
    });
    assert.equal(emptyRes.status, 400);
    console.log("    ✓ Empty documentId correctly rejected with 400");

    // Case 5c: Non-existent documentId
    const notFoundRes = await fetch(`${baseUrl}/api/v1/inspection/workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: "non-existent-uuid-99999" }),
    });
    assert.equal(notFoundRes.status, 404);
    const notFoundJson = await notFoundRes.json();
    assert.equal(notFoundJson.success, false);
    console.log("    ✓ Non-existent documentId correctly rejected with 404");

    console.log("\n=======================================================");
    console.log("✅ All One-Click Existing Document Workflow tests passed!");
    console.log("=======================================================\n");
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
