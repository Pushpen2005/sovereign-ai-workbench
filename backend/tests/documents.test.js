import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env") });

import app from "../src/app.js";
import { query, initDb } from "../src/config/db.js";

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

async function run() {
  console.log("=== Testing Persistent Document Metadata (PostgreSQL) ===\n");

  await initDb();

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Backend test server running at ${baseUrl}`);

  try {
    // 1. GET /api/v1/documents
    console.log("\n[1] Testing GET /api/v1/documents...");
    const listRes = await fetch(`${baseUrl}/api/v1/documents`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.success, true);
    assert.ok(Array.isArray(listData.documents), "documents must be an array");
    console.log(`    ✓ Retrieved ${listData.documents.length} document(s) from PostgreSQL`);

    // Verify existing pre-indexed document is in list
    const rilDoc = listData.documents.find((d) => d.originalFilename === "RIL-IAR-2025.pdf");
    assert.ok(rilDoc, "RIL-IAR-2025.pdf must be present in PostgreSQL document library");
    assert.equal(rilDoc.status, "Indexed");
    assert.equal(rilDoc.chunksStored, 1467);
    console.log("    ✓ Pre-indexed RIL-IAR-2025.pdf verified (status=Indexed, chunks=1467)");

    // 2. POST /api/v1/documents with valid PDF
    console.log("\n[2] Testing POST /api/v1/documents...");
    const testPdfBuffer = buildMinimalPdf([
      "WORKBENCH PERSISTENCE TEST DOCUMENT",
      "Section: Quality Assurance",
      "Measurement: Vibration analysis normal at 1.2 mm/s",
      "Status: All equipment within acceptable parameters.",
    ]);

    const formData = new FormData();
    formData.append(
      "document",
      new Blob([testPdfBuffer], { type: "application/pdf" }),
      "QA_Test_Report.pdf"
    );

    const uploadRes = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      body: formData,
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.success, true);
    assert.ok(uploadData.documentId, "documentId must be returned");
    assert.equal(uploadData.status, "Indexed");
    assert.ok(uploadData.chunksStored > 0, "chunksStored must be > 0");
    console.log(`    ✓ Uploaded and indexed: documentId=${uploadData.documentId}, chunks=${uploadData.chunksStored}`);

    // 3. Verify PostgreSQL directly contains the newly indexed document
    console.log("\n[3] Verifying PostgreSQL table directly...");
    const pgRes = await query("SELECT * FROM documents WHERE id = $1", [uploadData.documentId]);
    assert.equal(pgRes.rows.length, 1);
    const docRow = pgRes.rows[0];
    assert.equal(docRow.original_filename, "QA_Test_Report.pdf");
    assert.equal(docRow.status, "Indexed");
    assert.equal(docRow.chunks_stored, uploadData.chunksStored);
    assert.ok(docRow.organization_id, "organization_id must be populated");
    console.log(`    ✓ PostgreSQL row verified: status=${docRow.status}, chunks_stored=${docRow.chunks_stored}, organization_id=${docRow.organization_id}`);

    // 3b. Testing GET /api/v1/documents/:id
    console.log("\n[3b] Testing GET /api/v1/documents/:id...");
    const getDocRes = await fetch(`${baseUrl}/api/v1/documents/${uploadData.documentId}`);
    assert.equal(getDocRes.status, 200);
    const getDocData = await getDocRes.json();
    assert.equal(getDocData.success, true);
    assert.equal(getDocData.document.documentId, uploadData.documentId);
    assert.ok(getDocData.document.organizationId, "document must have organizationId");

    const notFoundRes = await fetch(`${baseUrl}/api/v1/documents/non-existent-doc-id`);
    assert.equal(notFoundRes.status, 404);
    console.log("    ✓ GET /api/v1/documents/:id verified (200 on existing, 404 on missing)");

    // 4. GET /api/v1/documents again to verify persistence
    console.log("\n[4] Re-calling GET /api/v1/documents (Simulating browser refresh)...");
    const refreshRes = await fetch(`${baseUrl}/api/v1/documents`);
    assert.equal(refreshRes.status, 200);
    const refreshData = await refreshRes.json();
    const foundNewDoc = refreshData.documents.find((d) => d.documentId === uploadData.documentId);
    assert.ok(foundNewDoc, "Newly uploaded document must be returned on refresh");
    assert.equal(foundNewDoc.originalFilename, "QA_Test_Report.pdf");
    assert.equal(foundNewDoc.chunksStored, uploadData.chunksStored);
    assert.ok(foundNewDoc.organizationId, "Retrieved document must have organizationId");
    console.log("    ✓ Newly uploaded document persists and is returned on refresh");

    // 5. Validation errors
    console.log("\n[5] Testing validation errors...");
    const badForm = new FormData();
    badForm.append("document", new Blob(["not pdf"], { type: "text/plain" }), "test.txt");
    const badRes = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      body: badForm,
    });
    assert.equal(badRes.status, 400);

    const emptyForm = new FormData();
    const emptyRes = await fetch(`${baseUrl}/api/v1/documents`, {
      method: "POST",
      body: emptyForm,
    });
    assert.equal(emptyRes.status, 400);
    console.log("    ✓ Validation correctly rejected invalid / missing uploads");

    console.log("\n✅ ALL PERSISTENT DOCUMENT TESTS PASSED SUCCESSFULLY!\n");
    process.exit(0);
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
