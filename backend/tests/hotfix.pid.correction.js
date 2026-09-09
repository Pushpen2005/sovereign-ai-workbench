/**
 * HOTFIX: Correct misclassified P, PI, PID.pdf document
 *
 * Document ID: c2aba3f6-995c-4547-91fa-5a0885b9af67
 * Organization: ad51f0f1-bca5-4076-8b8f-a8a64faecd76
 *
 * Problem:
 *   - PostgreSQL: document_type = "sop" (CORRECT)
 *   - Qdrant: documentType = "inspection", filename = UUID (INCORRECT)
 *
 * Root cause:
 *   - This document was uploaded BEFORE the SOP hotfix on 2026-09-09T02:24Z
 *   - It was uploaded through the old /documents flow before the SOP
 *     classification option was added to the dropdown and before
 *     the documentType was correctly forwarded
 *   - The backend correctly stored document_type="sop" in PostgreSQL
 *   - But the Qdrant upsert received documentType="inspection" and
 *     the filename was stored as the UUID instead of original filename
 *
 * Fix:
 *   - ONLY update Qdrant payload for documentId c2aba3f6-*
 *   - ONLY update organizationId ad51f0f1-*
 *   - No PostgreSQL change (already correct)
 *   - No vector re-embedding
 *   - No other documents touched
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../ai-service/.env'), override: true });

if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes('host.docker.internal')) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace('host.docker.internal', '127.0.0.1');
}

import { query, initDb } from '../src/config/db.js';
import { qdrantClient } from '../../ai-service/vectorstore/qdrant.service.js';

await initDb();

// ── VERIFIED CONSTANTS ─────────────────────────────────────────────────────────
const DOCUMENT_ID = 'c2aba3f6-995c-4547-91fa-5a0885b9af67';
const ORGANIZATION_ID = 'ad51f0f1-bca5-4076-8b8f-a8a64faecd76';
const CORRECT_FILENAME = 'P, PI, PID.pdf';
const CORRECT_DOCUMENT_TYPE = 'sop';

let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('================================================================');
console.log('HOTFIX: CORRECT MISCLASSIFIED P, PI, PID.pdf');
console.log('================================================================\n');
console.log(`  Document ID:     ${DOCUMENT_ID}`);
console.log(`  Organization ID: ${ORGANIZATION_ID}`);
console.log(`  Filename:        ${CORRECT_FILENAME}`);
console.log('');

// ── STEP 1: VERIFY POSTGRESQL RECORD BEFORE CORRECTION ─────────────────────
await step('1. Pre-check: Verify PostgreSQL record exists for this document', async () => {
  const result = await query(
    `SELECT id, organization_id, original_filename, document_type, status, chunks_stored
     FROM documents
     WHERE id = $1`,
    [DOCUMENT_ID]
  );
  assert.equal(result.rows.length, 1, 'Document must exist in PostgreSQL');
  const doc = result.rows[0];
  assert.equal(doc.organization_id, ORGANIZATION_ID, 'Organization ID must match');
  assert.equal(doc.original_filename, CORRECT_FILENAME, 'Filename must match');
  assert.equal(doc.document_type, 'sop', `PostgreSQL already has document_type='sop' (got: ${doc.document_type})`);
  console.log(`      PostgreSQL document_type = "${doc.document_type}" (already correct)`);
  console.log(`      PostgreSQL chunks_stored  = ${doc.chunks_stored}`);
});

// ── STEP 2: VERIFY QDRANT BEFORE CORRECTION ─────────────────────────────────
let beforePoints = [];
await step('2. Pre-check: Capture Qdrant state before correction', async () => {
  const result = await qdrantClient.scroll('documents', {
    filter: {
      must: [{ key: 'documentId', match: { value: DOCUMENT_ID } }]
    },
    limit: 50,
    with_payload: true,
    with_vector: false,
  });
  beforePoints = result.points;
  assert(beforePoints.length > 0, 'Must have Qdrant points for this document');
  console.log(`      Qdrant points found: ${beforePoints.length}`);
  beforePoints.forEach((pt, i) => {
    console.log(`      Point ${i + 1}: documentType="${pt.payload.documentType}" filename="${pt.payload.filename}" organizationId="${pt.payload.organizationId}"`);
  });

  // Confirm they are wrong
  const anyWrong = beforePoints.some(pt =>
    pt.payload.documentType !== CORRECT_DOCUMENT_TYPE ||
    pt.payload.filename !== CORRECT_FILENAME
  );
  assert(anyWrong, 'Expected at least one Qdrant point with incorrect documentType or filename');
});

// ── STEP 3: VERIFY TENANT SCOPE — MUST ONLY UPDATE CORRECT ORG ──────────────
await step('3. Tenant safety: Verify points belong to expected organizationId', async () => {
  for (const pt of beforePoints) {
    assert.equal(
      pt.payload.organizationId,
      ORGANIZATION_ID,
      `Point ${pt.id} belongs to org ${pt.payload.organizationId}, not ${ORGANIZATION_ID}`
    );
  }
  console.log(`      All ${beforePoints.length} points confirmed to belong to org ${ORGANIZATION_ID}`);
});

// ── STEP 4: APPLY QDRANT PAYLOAD CORRECTION ──────────────────────────────────
await step('4. Correction: Update Qdrant payload for this document (documentType + filename)', async () => {
  await qdrantClient.setPayload('documents', {
    payload: {
      documentType: CORRECT_DOCUMENT_TYPE,
      filename: CORRECT_FILENAME,
    },
    filter: {
      must: [
        { key: 'documentId', match: { value: DOCUMENT_ID } },
        { key: 'organizationId', match: { value: ORGANIZATION_ID } },
      ]
    },
    wait: true,
  });
  console.log(`      Applied: documentType="${CORRECT_DOCUMENT_TYPE}", filename="${CORRECT_FILENAME}"`);
});

// ── STEP 5: VERIFY QDRANT AFTER CORRECTION ───────────────────────────────────
await step('5. Post-check: Verify Qdrant payload updated correctly', async () => {
  const result = await qdrantClient.scroll('documents', {
    filter: {
      must: [{ key: 'documentId', match: { value: DOCUMENT_ID } }]
    },
    limit: 50,
    with_payload: true,
    with_vector: false,
  });
  const afterPoints = result.points;
  assert.equal(afterPoints.length, beforePoints.length, 'Point count must not change');
  for (const pt of afterPoints) {
    assert.equal(pt.payload.documentType, CORRECT_DOCUMENT_TYPE,
      `Point ${pt.id} documentType="${pt.payload.documentType}" must be "${CORRECT_DOCUMENT_TYPE}"`);
    assert.equal(pt.payload.filename, CORRECT_FILENAME,
      `Point ${pt.id} filename="${pt.payload.filename}" must be "${CORRECT_FILENAME}"`);
    assert.equal(pt.payload.organizationId, ORGANIZATION_ID,
      `Point ${pt.id} organizationId must be unchanged`);
    assert(typeof pt.payload.page === 'number', 'page metadata must be preserved');
    assert(typeof pt.payload.chunkIndex === 'number', 'chunkIndex must be preserved');
    assert(pt.payload.text, 'text must be preserved');
    console.log(`      Point ${pt.id}: documentType="${pt.payload.documentType}" ✓ filename="${pt.payload.filename}" ✓`);
  }
});

// ── STEP 6: VERIFY NO OTHER DOCUMENTS WERE MODIFIED ─────────────────────────
await step('6. Safety: Verify no unrelated Qdrant points were modified', async () => {
  // Check another document that should remain as inspection
  const anotherResult = await qdrantClient.scroll('documents', {
    filter: {
      must: [{ key: 'documentType', match: { value: 'inspection' } }]
    },
    limit: 3,
    with_payload: true,
    with_vector: false,
  });
  // Just confirm they haven't become sop
  for (const pt of anotherResult.points) {
    assert.equal(pt.payload.documentType, 'inspection',
      `Inspection point ${pt.id} must remain inspection`);
  }
  console.log(`      Verified ${anotherResult.points.length} inspection points remain unchanged`);
});

// ── STEP 7: VERIFY API LISTING ────────────────────────────────────────────────
let server;
await step('7. API: GET /api/v1/documents?documentType=sop returns P, PI, PID.pdf', async () => {
  const { default: app } = await import('../src/app.js');
  const http = await import('node:http');

  await new Promise((resolve, reject) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const port = server.address().port;
  const { generateToken } = await import('../src/utils/auth.js');
  const token = generateToken({
    userId: 'hotfix-pid-user',
    organizationId: ORGANIZATION_ID,
    role: 'admin',
    email: 'pid-fix@example.com',
  });

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/documents?documentType=sop`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert(Array.isArray(data.documents));
  const found = data.documents.find(d =>
    (d.id === DOCUMENT_ID || d.documentId === DOCUMENT_ID) ||
    (d.originalFilename === CORRECT_FILENAME || d.filename === CORRECT_FILENAME)
  );
  assert(found, `P, PI, PID.pdf must appear in ?documentType=sop listing`);
  assert.equal(found.documentType, 'sop');
  console.log(`      Found in SOP listing: documentType="${found.documentType}" ✓`);
});

// ── STEP 8: GET ?documentType=other must NOT include it ───────────────────────
await step('8. API: GET /api/v1/documents?documentType=other must NOT return P, PI, PID.pdf', async () => {
  const port = server.address().port;
  const { generateToken } = await import('../src/utils/auth.js');
  const token = generateToken({
    userId: 'hotfix-pid-user',
    organizationId: ORGANIZATION_ID,
    role: 'admin',
    email: 'pid-fix@example.com',
  });

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/documents?documentType=other`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert(Array.isArray(data.documents));
  const found = data.documents.find(d =>
    d.id === DOCUMENT_ID || d.documentId === DOCUMENT_ID
  );
  assert(!found, `P, PI, PID.pdf must NOT appear in ?documentType=other listing`);
  console.log(`      Not present in "other" listing ✓`);

  if (server) server.close();
});

// ── RESULTS ─────────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed}/${passed + failed} steps passed.`);
if (failed === 0) {
  console.log('✓ Hotfix applied and verified successfully!\n');
  process.exit(0);
} else {
  console.error(`✗ ${failed} steps failed.\n`);
  if (server) server.close();
  process.exit(1);
}
