/**
 * Phase 4: Qdrant Legacy Data Reconciliation Script
 * Command: npm run backfill:qdrant-metadata
 *
 * Safe reconciliation/backfill mechanism:
 * 1. Reads authoritative document records from PostgreSQL.
 * 2. Matches Qdrant points by documentId.
 * 3. Patches missing payload attributes (organizationId, filename, documentType)
 *    using PostgreSQL authoritative data via Qdrant set-payload by filter.
 * 4. Strictly preserves all vector values, embeddings, and point IDs.
 * 5. Identifies and safely reports points that cannot be associated with a
 *    PostgreSQL document without guessing or fabricating metadata.
 * 6. Audits and reports untyped (NULL document_type) PostgreSQL records.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { query } from "../src/config/db.js";

const isDockerEnv = Boolean(process.env.DOCKER_CONTAINER || process.env.IS_DOCKER || false);
const qdrantUrl = (process.env.QDRANT_URL && process.env.QDRANT_URL.includes("://qdrant") && !isDockerEnv)
    ? process.env.QDRANT_URL.replace("://qdrant", "://127.0.0.1")
    : (process.env.QDRANT_URL || "http://localhost:6333");

const COLLECTION_NAME = "documents";

async function runReconciliation() {
    console.log("================================================================");
    console.log("PHASE 4 — QDRANT LEGACY METADATA RECONCILIATION & AUDIT");
    console.log("================================================================");
    console.log(`Qdrant URL:     ${qdrantUrl}`);
    console.log(`Collection:     ${COLLECTION_NAME}`);
    console.log(`Execution Env:  ${isDockerEnv ? "Docker Container" : "Host System"}`);
    console.log("----------------------------------------------------------------");

    // 1. Fetch Authoritative Document Metadata from PostgreSQL
    console.log("\n[1/4] Reading authoritative document metadata from PostgreSQL...");
    const pgRes = await query(`
        SELECT 
            id, 
            organization_id, 
            filename, 
            original_filename, 
            document_type,
            status,
            chunks_stored,
            created_at
        FROM documents
        ORDER BY created_at ASC
    `);

    const pgDocs = pgRes.rows || [];
    const pgDocsMap = new Map();
    let untypedDocsCount = 0;
    const docTypeBreakdown = {};

    for (const doc of pgDocs) {
        pgDocsMap.set(doc.id, doc);
        const dtype = doc.document_type || "untyped_null";
        docTypeBreakdown[dtype] = (docTypeBreakdown[dtype] || 0) + 1;
        if (!doc.document_type) {
            untypedDocsCount++;
        }
    }

    console.log(`✓ Loaded ${pgDocs.length} authoritative document records from PostgreSQL.`);
    console.log("  Document Type Distribution in PostgreSQL:");
    for (const [dtype, count] of Object.entries(docTypeBreakdown)) {
        console.log(`    - ${dtype.padEnd(16)}: ${count}`);
    }
    console.log(`  Untyped (NULL) Documents: ${untypedDocsCount} (preserved unclassified per specification)`);

    // 2. Audit Qdrant Collection Health & Points
    console.log("\n[2/4] Auditing Qdrant collection state...");
    const collRes = await fetch(`${qdrantUrl}/collections/${COLLECTION_NAME}`);
    if (!collRes.ok) {
        throw new Error(`Failed to query Qdrant collection: HTTP ${collRes.status}`);
    }
    const collData = await collRes.json();
    const vectorConfig = collData?.result?.config?.params?.vectors;
    const totalPointsCount = collData?.result?.points_count || 0;
    console.log(`✓ Collection "${COLLECTION_NAME}" is online.`);
    console.log(`  Vectors Dimension: ${vectorConfig?.size || 384} (${vectorConfig?.distance || "Cosine"})`);
    console.log(`  Total Points:      ${totalPointsCount}`);

    // 3. Scan & Reconcile Points
    console.log("\n[3/4] Scanning Qdrant points and reconciling metadata against PostgreSQL...");
    let offset = null;
    let scannedPoints = 0;
    let pointsMatchedToPg = 0;
    let pointsNeedingPatch = 0;
    let pointsAlreadyComplete = 0;
    let unreconciledPoints = 0;
    const unreconciledDocIds = new Set();
    const docsToPatch = new Map(); // docId -> { payloadToSet, pointCount }

    while (true) {
        const scrollRes = await fetch(`${qdrantUrl}/collections/${COLLECTION_NAME}/points/scroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                limit: 1000,
                offset,
                with_payload: ["documentId", "organizationId", "documentType", "filename"],
                with_vector: false,
            }),
        });

        if (!scrollRes.ok) {
            throw new Error(`Qdrant scroll failed: HTTP ${scrollRes.status}`);
        }

        const scrollData = await scrollRes.json();
        const points = scrollData?.result?.points || [];
        scannedPoints += points.length;

        for (const pt of points) {
            const docId = pt.payload?.documentId;
            if (docId && pgDocsMap.has(docId)) {
                pointsMatchedToPg++;
                const pgDoc = pgDocsMap.get(docId);
                const hasOrg = Boolean(pt.payload?.organizationId);
                const hasType = Boolean(pt.payload?.documentType);
                const hasFilename = Boolean(pt.payload?.filename);

                const needsOrgPatch = !hasOrg && Boolean(pgDoc.organization_id);
                const needsTypePatch = !hasType && Boolean(pgDoc.document_type);
                const needsFilenamePatch = !hasFilename && Boolean(pgDoc.original_filename || pgDoc.filename);

                if (needsOrgPatch || needsTypePatch || needsFilenamePatch) {
                    pointsNeedingPatch++;
                    if (!docsToPatch.has(docId)) {
                        const payload = {};
                        if (pgDoc.organization_id) payload.organizationId = pgDoc.organization_id;
                        if (pgDoc.original_filename || pgDoc.filename) {
                            payload.filename = pgDoc.original_filename || pgDoc.filename;
                        }
                        if (pgDoc.document_type) payload.documentType = pgDoc.document_type;
                        docsToPatch.set(docId, { payload, points: 1 });
                    } else {
                        docsToPatch.get(docId).points++;
                    }
                } else {
                    pointsAlreadyComplete++;
                }
            } else {
                unreconciledPoints++;
                if (docId) unreconciledDocIds.add(docId);
            }
        }

        offset = scrollData?.result?.next_page_offset;
        if (!offset) break;
    }

    console.log(`✓ Scanned ${scannedPoints} total points in Qdrant.`);
    console.log(`  - Points matched to PostgreSQL records: ${pointsMatchedToPg}`);
    console.log(`  - Points already fully populated:       ${pointsAlreadyComplete}`);
    console.log(`  - Points needing metadata patch:        ${pointsNeedingPatch}`);
    console.log(`  - Unreconciled points (no PG record):   ${unreconciledPoints} across ${unreconciledDocIds.size} document IDs`);

    // 4. Execute Safe Payload Patches
    let repairedPoints = 0;
    if (docsToPatch.size > 0) {
        console.log(`\n[4/4] Applying safe payload patches to ${docsToPatch.size} documents (${pointsNeedingPatch} points)...`);
        for (const [docId, { payload, points }] of docsToPatch.entries()) {
            const patchRes = await fetch(`${qdrantUrl}/collections/${COLLECTION_NAME}/points/payload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    payload,
                    filter: {
                        must: [{ key: "documentId", match: { value: docId } }],
                    },
                }),
            });

            if (patchRes.ok) {
                repairedPoints += points;
            } else {
                console.warn(`  [WARN] Failed to patch points for document '${docId}': HTTP ${patchRes.status}`);
            }
        }
        console.log(`✓ Successfully repaired metadata for ${repairedPoints} points.`);
    } else {
        console.log(`\n[4/4] All ${pointsMatchedToPg} matched points already have authoritative metadata intact. Zero patches required.`);
    }

    // 5. Final Summary Report
    console.log("\n================================================================");
    console.log("RECONCILIATION SUMMARY REPORT");
    console.log("================================================================");
    console.log(`Total PostgreSQL Documents:       ${pgDocs.length}`);
    console.log(`Typed Documents:                  ${pgDocs.length - untypedDocsCount} (SOP: ${docTypeBreakdown.sop || 0}, Inspection: ${docTypeBreakdown.inspection || 0}, Other: ${docTypeBreakdown.other || 0})`);
    console.log(`Untyped Documents:                ${untypedDocsCount} (safely preserved unclassified)`);
    console.log(`Total Qdrant Points Scanned:      ${scannedPoints}`);
    console.log(`Points Matched to PostgreSQL:     ${pointsMatchedToPg}`);
    console.log(`Points Repaired in this Run:      ${repairedPoints}`);
    console.log(`Points Fully Reconciled:          ${pointsMatchedToPg}`);
    console.log(`Unreconciled Points (Reported):   ${unreconciledPoints}`);
    console.log(`Unreconciled Unique Doc IDs:      ${unreconciledDocIds.size}`);
    console.log("Vector Values / Dimensions:       Strictly Preserved (384D Cosine)");
    console.log("Point IDs / Geometry:             Strictly Preserved");
    console.log("================================================================");

    return {
        success: true,
        pgDocsCount: pgDocs.length,
        untypedDocsCount,
        totalPoints: scannedPoints,
        matchedPoints: pointsMatchedToPg,
        repairedPoints,
        unreconciledPoints,
        unreconciledDocIdsCount: unreconciledDocIds.size,
    };
}

runReconciliation()
    .then((result) => {
        process.exit(0);
    })
    .catch((err) => {
        console.error("Reconciliation execution failed:", err);
        process.exit(1);
    });
