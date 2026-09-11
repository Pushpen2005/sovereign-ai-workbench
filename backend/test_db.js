import { query } from "./src/config/db.js";

async function run() {
    try {
        // Find the most recently active organization with real docs
        const res = await query(`
            SELECT id, filename, original_filename, document_type, status, chunks_stored, organization_id, created_at
            FROM documents 
            WHERE status = 'Indexed' AND chunks_stored > 0
            ORDER BY created_at DESC
            LIMIT 30`
        );
        console.table(res.rows);
        
        // Show distinct orgs with their doc counts
        const orgRes = await query(`
            SELECT organization_id, COUNT(*) as doc_count, MAX(created_at) as last_upload
            FROM documents
            WHERE status = 'Indexed' AND chunks_stored > 0
            GROUP BY organization_id
            ORDER BY last_upload DESC
            LIMIT 10`
        );
        console.log("\\n=== Orgs by recent activity ===");
        console.table(orgRes.rows);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run();
