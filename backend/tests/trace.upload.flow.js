/**
 * REAL UPLOAD TRACE: Simulate the exact browser upload flow
 * and trace every value at each step.
 * Uses Node 18+ built-in FormData and fetch.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../ai-service/.env'), override: true });

if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes('host.docker.internal')) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace('host.docker.internal', '127.0.0.1');
}

import { initDb, query } from '../src/config/db.js';
import { default as app } from '../src/app.js';
import { generateToken } from '../src/utils/auth.js';
import http from 'node:http';

await initDb();

// Get a real organization ID
const orgResult = await query('SELECT organization_id FROM users LIMIT 1');
const orgId = orgResult.rows[0]?.organization_id || 'ad51f0f1-bca5-4076-8b8f-a8a64faecd76';
console.log('Using orgId:', orgId);

const token = generateToken({
  userId: 'upload-trace-user',
  organizationId: orgId,
  role: 'admin',
  email: 'trace@example.com',
});

// Start server
const server = http.createServer(app).listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.on('listening', resolve);
  server.on('error', reject);
});
const port = server.address().port;
console.log('Test server on port', port);

// Create a minimal test PDF with text-extractable content
const TEST_PDF_PATH = path.resolve(__dirname, 'trace_test.pdf');
if (!fs.existsSync(TEST_PDF_PATH)) {
  const pdfContent = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Times-Roman>>>>>>>>endobj\n4 0 obj<</Length 44>>\nstream\nBT /F1 12 Tf 100 700 Td (SOP TRACE TEST DOCUMENT) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000274 00000 n\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n366\n%%EOF\n';
  fs.writeFileSync(TEST_PDF_PATH, pdfContent);
}

async function doUpload(label, documentTypeValue) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${label}`);
  console.log(`documentType to send: ${documentTypeValue === undefined ? 'NOT SENT' : `"${documentTypeValue}"`}`);
  console.log('='.repeat(60));

  // Simulate exactly what documents.api.js does
  const formData = new FormData();
  const pdfBlob = new Blob([fs.readFileSync(TEST_PDF_PATH)], { type: 'application/pdf' });
  formData.append('document', pdfBlob, 'trace_test.pdf');

  // documents.api.js line 37-39:
  // if (documentType && typeof documentType === 'string' && documentType.trim()) {
  //   form.append('documentType', documentType.trim().toLowerCase());
  // }
  if (documentTypeValue && typeof documentTypeValue === 'string' && documentTypeValue.trim()) {
    formData.append('documentType', documentTypeValue.trim().toLowerCase());
    console.log(`  → FormData.append('documentType', '${documentTypeValue.trim().toLowerCase()}')`);
  } else {
    console.log(`  → documentType NOT appended (condition: ${documentTypeValue} && typeof=string && trim ← FALSE)`);
  }

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const data = await res.json();

  console.log(`  → HTTP status: ${res.status}`);
  if (data.success) {
    console.log(`  → Backend response.documentType: "${data.documentType}"`);
    console.log(`  → Backend response.documentId: "${data.documentId}"`);
  } else {
    console.log(`  → Backend error: ${data.message}`);
    return;
  }

  // Verify PostgreSQL
  if (data.documentId) {
    const dbResult = await query('SELECT document_type FROM documents WHERE id = $1', [data.documentId]);
    const dbType = dbResult.rows[0]?.document_type;
    console.log(`  → PostgreSQL document_type: "${dbType}"`);

    // Check Qdrant
    try {
      const { qdrantClient } = await import('../../ai-service/vectorstore/qdrant.service.js');
      const scroll = await qdrantClient.scroll('documents', {
        filter: { must: [{ key: 'documentId', match: { value: data.documentId } }] },
        limit: 3, with_payload: true, with_vector: false,
      });
      const qdrantType = scroll.points[0]?.payload?.documentType;
      console.log(`  → Qdrant documentType: "${qdrantType}"`);
    } catch (e) {
      console.log(`  → Qdrant check: ${e.message}`);
    }

    // Clean up this test record
    try {
      await query('DELETE FROM documents WHERE id = $1', [data.documentId]);
    } catch(e) {}
  }
}

// ── SCENARIO 1: Correct SOP flow ─────────────────────────────────────────────
await doUpload('User selected SOP → documentType="sop"', 'sop');

// ── SCENARIO 2: Default inspection ───────────────────────────────────────────
await doUpload('User left default → documentType="inspection"', 'inspection');

// ── SCENARIO 3: documentType omitted ─────────────────────────────────────────
await doUpload('documentType NOT sent (undefined)', undefined);

// ── SCENARIO 4: documentType=other ───────────────────────────────────────────
await doUpload('documentType="other" explicitly', 'other');

console.log('\n' + '='.repeat(60));
console.log('FRONTEND ANALYSIS:');
console.log('documents.api.js guard: documentType && typeof === string && .trim()');
console.log('  "sop"        → TRUE  → sends "sop"');
console.log('  "inspection" → TRUE  → sends "inspection"');
console.log('  undefined    → FALSE → NOT sent → backend default "inspection"');
console.log('  ""           → FALSE → NOT sent → backend default "inspection"');
console.log('');
console.log('documentState.jsx SET_DOCUMENTS fallback: doc.documentType || doc.document_type || "inspection"');
console.log('  doc.documentType=null → falls back to "inspection" → displays as "Inspection Report"!');
console.log('');
console.log('EXPECTED USER COMPLAINT: "shows Other" NOT "shows Inspection"');
console.log('→ If user sees "Other", backend MUST be returning documentType="other"');
console.log('→ OR display logic is wrong');

server.close();
process.exit(0);
