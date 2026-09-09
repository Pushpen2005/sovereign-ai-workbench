/**
 * HOTFIX AUDIT: Find P, PI, PID.pdf document in PostgreSQL and Qdrant
 * Uses ai-service qdrant service directly (has @qdrant/js-client-rest)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../ai-service/.env'), override: true });

if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes('host.docker.internal')) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace('host.docker.internal', '127.0.0.1');
}

import { query, initDb } from '../src/config/db.js';
import { qdrantClient } from '../../ai-service/vectorstore/qdrant.service.js';

await initDb();

console.log('=== STEP 1: PostgreSQL Audit for P, PI, PID.pdf ===\n');

// Search broadly
const result = await query(
  `SELECT id, organization_id, original_filename, document_type, status, chunks_stored, extraction_method, created_at
   FROM documents
   WHERE original_filename ILIKE '%PID%' 
      OR original_filename ILIKE '%P, PI%' 
      OR original_filename ILIKE '%P PI%'
      OR original_filename ILIKE '%P_PI%'
   ORDER BY created_at DESC`
);

console.log(`Found ${result.rows.length} matching document(s):`);
console.log(JSON.stringify(result.rows, null, 2));

if (result.rows.length === 0) {
  console.log('\nNo exact match. Trying fuzzy search on all non-sop documents...');
  const all = await query(
    `SELECT id, organization_id, original_filename, document_type, status, chunks_stored, created_at
     FROM documents
     WHERE document_type != 'sop'
     ORDER BY created_at DESC LIMIT 30`
  );
  console.log('\nRecent non-SOP type documents:');
  console.log(JSON.stringify(all.rows, null, 2));
  process.exit(0);
}

for (const doc of result.rows) {
  console.log(`\n=== STEP 2: Qdrant Audit for documentId: ${doc.id} (${doc.original_filename}) ===\n`);

  try {
    const scrollResult = await qdrantClient.scroll('documents', {
      filter: {
        must: [
          { key: 'documentId', match: { value: doc.id } }
        ]
      },
      limit: 50,
      with_payload: true,
      with_vector: false,
    });

    console.log(`Found ${scrollResult.points.length} Qdrant point(s):`);
    scrollResult.points.forEach((pt, i) => {
      console.log(`\n  Point ${i + 1}:`);
      console.log('    id:', pt.id);
      console.log('    documentId:', pt.payload.documentId);
      console.log('    documentType:', pt.payload.documentType);
      console.log('    organizationId:', pt.payload.organizationId);
      console.log('    filename:', pt.payload.filename);
      console.log('    page:', pt.payload.page);
      console.log('    chunkIndex:', pt.payload.chunkIndex);
      console.log('    extractionMethod:', pt.payload.extractionMethod);
      console.log('    text (first 120 chars):', (pt.payload.text || '').substring(0, 120));
    });
  } catch (err) {
    console.error('Qdrant error:', err.message);
  }
}

process.exit(0);
