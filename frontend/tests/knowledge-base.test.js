/**
 * Phase 2 — Dedicated Knowledge Base Workspace Verification Suite
 * Tests:
 *  1. Knowledge Base page renders and exports component.
 *  2. Sidebar contains Knowledge Base navigation item (/knowledge-base).
 *  3. /knowledge-base route is registered in AppRoutes.
 *  4. Upload action in Knowledge Base sends canonical documentType="sop".
 *  5. Knowledge Base upload enforces SOP classification without inspection option.
 *  6. SOP documents are fetched with ?documentType=sop and displayed.
 *  7. Non-SOP documents are filtered out from the Knowledge Base view.
 *  8. Status (Indexed, Processing, Failed), chunks, extraction method displayed from backend.
 *  9. Delete action uses existing deleteDocument API with confirmation modal.
 * 10. Empty state renders helpful message and upload CTA.
 * 11. Loading state renders "Loading knowledge base...".
 * 12. Error messages are sanitized (no stack traces, SQL, internal paths).
 * 13. Organization identity is session-controlled, not client-supplied in request body.
 * 14. Documents page remains functional for operational documents.
 * 15. Knowledge Base and Documents pages maintain clear visual and conceptual separation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('================================================================');
console.log('PHASE 2: DEDICATED KNOWLEDGE BASE WORKSPACE VERIFICATION');
console.log('================================================================\n');

// 1. Knowledge Base page renders and exports component
test('1. Knowledge Base page component exists and exports correctly', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  assert(fs.existsSync(kbPath), 'KnowledgeBasePage.jsx must exist');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('export function KnowledgeBasePage'), 'KnowledgeBasePage named export must exist');
  assert(content.includes('export default KnowledgeBasePage'), 'KnowledgeBasePage default export must exist');
});

// 2. Sidebar contains Knowledge Base
test('2. Sidebar contains Knowledge Base navigation item', () => {
  const sidebarPath = path.join(srcDir, 'components/layout/Sidebar.jsx');
  const content = fs.readFileSync(sidebarPath, 'utf8');
  assert(content.includes('/knowledge-base'), 'Sidebar must contain /knowledge-base path');
  assert(content.includes('Knowledge Base'), 'Sidebar must contain "Knowledge Base" label');
  assert(content.includes('📚'), 'Sidebar should use 📚 icon for Knowledge Base');
  assert(content.includes('/documents'), 'Sidebar must preserve /documents');
});

// 3. /knowledge-base route works
test('3. /knowledge-base route is registered under ProtectedRoute', () => {
  const routesPath = path.join(srcDir, 'routes/routes.jsx');
  const content = fs.readFileSync(routesPath, 'utf8');
  assert(content.includes("path=\"/knowledge-base\""), 'routes.jsx must declare /knowledge-base route');
  assert(content.includes("element={<KnowledgeBasePage />}"), 'Route must render KnowledgeBasePage');
});

// 4. Upload sends documentType=sop
test('4. Upload action sends canonical documentType="sop"', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes("uploadDocument(file, 'sop')"), "Upload handler must pass documentType='sop'");
});

// 5. Upload does not allow inspection classification on KB page
test('5. Knowledge Base upload enforces SOP classification without inspection options', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(!content.includes('<option value="inspection">'), 'KB page must not provide option to classify as inspection');
  assert(content.includes('SOP / Knowledge Base'), 'KB page must show SOP / Knowledge Base category tag');
});

// 6. SOP documents are listed with documentType=sop filter hook
test('6. SOP documents are requested via backend documentType=sop hook', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes("useDocuments({ documentType: 'sop' })"), 'useDocuments hook must be called with documentType: sop');
});

// 7. Non-SOP documents are not displayed in Knowledge Base
test('7. Filtered documents strictly ensure documentType is sop', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes("docType !== 'sop'"), 'Knowledge Base client memo filter must exclude non-sop documents');
});

// 8. Indexed status, chunks, and extraction method displayed from backend
test('8. Status, chunks stored, and extraction method (PDF Text / OCR) displayed from backend', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('chunksStored'), 'Must read chunksStored from backend response');
  assert(content.includes('extractionMethod') || content.includes('extraction_method'), 'Must read extractionMethod from backend response');
  assert(content.includes('StatusBadge'), 'Must render StatusBadge with backend status');
  assert(content.includes("'OCR'") && content.includes("'PDF Text'"), 'Must display OCR / PDF Text extraction method');
});

// 9. Delete uses existing document API with confirmation modal
test('9. Delete uses existing document deletion API and requires confirmation', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('DeleteConfirmModal'), 'Must include confirmation modal before deleting');
  assert(content.includes('Delete this knowledge document?'), 'Must prompt with "Delete this knowledge document?"');
  assert(content.includes('deleteDocument(docId)'), 'Must call existing deleteDocument API hook');
});

// 10. Empty state renders correctly
test('10. Empty state displays standard copy and upload CTA', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Knowledge Base is empty.'), 'Must display "Knowledge Base is empty."');
  assert(content.includes('Upload your first SOP'), 'Must display empty state descriptive guidance');
  assert(content.includes('Upload Knowledge Document'), 'Must include upload action button in empty state');
});

// 11. Loading state renders correctly
test('11. Loading state renders standard "Loading knowledge base..." copy', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Loading knowledge base…'), 'Must show loading knowledge base message');
});

// 12. Error state is sanitized
test('12. Error state is sanitized and user-friendly without internal details', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Unable to index this knowledge document.'), 'Must provide sanitized upload error fallback');
  assert(content.includes('Unable to delete knowledge document.'), 'Must provide sanitized delete error');
  assert(!content.includes('stack'), 'Must not expose stack traces');
});

// 13. Organization identity is not client-controlled
test('13. Organization identity is session-controlled by backend JWT, not client-supplied', () => {
  const docsApiPath = path.join(srcDir, 'api/documents.api.js');
  const content = fs.readFileSync(docsApiPath, 'utf8');
  assert(!content.includes('organizationId:'), 'Client API must not pass arbitrary organizationId in request body');
  assert(!content.includes('tenantId:'), 'Client API must not pass arbitrary tenantId');
});

// 14. Documents page remains functional for operational documents
test('14. Documents page remains functional for operational documents', () => {
  const docPagePath = path.join(srcDir, 'pages/Documents/DocumentsPage.jsx');
  const content = fs.readFileSync(docPagePath, 'utf8');
  assert(content.includes('Operational inspection reports') || content.includes('operational inspection reports'), 'Documents page subtitle must focus on operational files');
  assert(content.includes('Inspection Reports'), 'Documents page must support Inspection Reports filtering');
  assert(content.includes('uploadDocument'), 'Documents page upload must remain functional');
  assert(content.includes('handleAnalyzeInAgent'), 'Documents page Inspection Agent action must remain intact');
});

// 15. Knowledge Base and Documents are visually separated
test('15. Knowledge Base and Documents pages maintain clear visual and conceptual separation', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const docPagePath = path.join(srcDir, 'pages/Documents/DocumentsPage.jsx');
  const kbContent = fs.readFileSync(kbPath, 'utf8');
  const docContent = fs.readFileSync(docPagePath, 'utf8');

  assert(kbContent.includes('Company Knowledge Base'), 'KB page must have dedicated title');
  assert(kbContent.includes('Manage the SOPs, procedures, manuals'), 'KB page must have dedicated subtitle');
  assert(docContent.includes('Operational inspection reports') || docContent.includes('operational inspection reports'), 'Documents page must have operational subtitle');
  assert(!docContent.includes("['All', 'Inspection Reports', 'SOPs / Knowledge Base', 'Other']"), 'Documents filter bar must remove confusing SOP tab');
});

// 16. Knowledge Search section and query input present
test('16. Knowledge Search section and finding textarea present', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Knowledge Search'), 'Must contain "Knowledge Search" section title');
  assert(content.includes('Finding / Query Input'), 'Must contain query input label');
  assert(content.includes('Enter an engineering finding or question'), 'Must provide descriptive placeholder');
});

// 17. Search button and searching indicator present
test('17. Search button and dynamic loading state present', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Search Knowledge Base'), 'Must contain "Search Knowledge Base" button label');
  assert(content.includes('Searching knowledge base...'), 'Must contain searching loading copy');
});

// 18. Results card renders metadata: filename, page, score, extraction method
test('18. Result card renders metadata and similarity score', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Score:'), 'Must label similarity score cleanly');
  assert(content.includes('Page'), 'Must display page metadata');
  assert(content.includes('Chunk #'), 'Must display chunk index when available');
});

// 19. Zero result copy present
test('19. Zero result state displays standard no-evidence message', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('No relevant knowledge-base evidence found.'), 'Must display standard zero-result copy');
});

// 20. Sanitized search error copy present
test('20. Sanitized search error copy present without exposing internal details', () => {
  const kbPath = path.join(srcDir, 'pages/KnowledgeBase/KnowledgeBasePage.jsx');
  const content = fs.readFileSync(kbPath, 'utf8');
  assert(content.includes('Unable to search the knowledge base.'), 'Must display sanitized search error message');
});

console.log(`\nResults: ${passed}/${total} tests passed.`);
if (passed === total) {
  console.log('✓ All Knowledge Base frontend tests PASSED!\n');
  process.exit(0);
} else {
  console.error(`✗ ${total - passed} tests failed.\n`);
  process.exit(1);
}

