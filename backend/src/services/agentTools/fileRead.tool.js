/**
 * PR #26 — Safe File Read Agent Tool
 *
 * Reads indexed document metadata and text content from PostgreSQL & Qdrant.
 * STRICT SECURITY BOUNDARY:
 *   - Prohibits arbitrary filesystem paths (/etc/passwd, ../, ./, /)
 *   - Only accepts validated document IDs (UUID / alphanumeric string)
 *   - Queries PostgreSQL documents table and Qdrant points
 */

import { query } from "../../config/db.js";

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION_NAME = "documents";

export class FileReadError extends Error {
    constructor(message) {
        super(message);
        this.name = "FileReadError";
    }
}

const SAFE_DOC_ID_REGEX = /^[a-zA-Z0-9_\-.:]{1,128}$/;

/**
 * Reads document metadata and extracted text chunks using a validated document identifier.
 *
 * @param {object} args
 * @param {string} args.documentId - Document UUID or identifier
 * @param {number} [args.maxChunks=5] - Maximum text chunks to retrieve (1-10)
 * @returns {Promise<{ documentId: string, filename: string, status: string, totalChunks: number, textExcerpt: string, chunks: Array<object> }>}
 */
export async function executeFileRead(args, context = {}) {
    if (!args || typeof args !== "object") {
        throw new FileReadError("Arguments must be an object with a 'documentId' field");
    }

    const organizationId = context?.organizationId;
    if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
        throw new FileReadError("Execution context missing authenticated organizationId for file read");
    }

    const { documentId, maxChunks: rawMax } = args;

    if (typeof documentId !== "string" || !documentId.trim()) {
        throw new FileReadError("documentId must be a non-empty string");
    }

    const cleanId = documentId.trim();

    // 1. Strict path traversal / security check
    if (cleanId.includes("/") || cleanId.includes("\\") || cleanId.includes("..") || !SAFE_DOC_ID_REGEX.test(cleanId)) {
        throw new FileReadError(
            `Access Denied: Invalid documentId '${cleanId}'. Path traversal and filesystem access are strictly prohibited.`
        );
    }

    const maxChunks = Math.min(Math.max(Number.isInteger(rawMax) ? rawMax : 5, 1), 10);

    // 2. Query PostgreSQL metadata store strictly scoped to the authenticated organization
    let docRow = null;
    try {
        const sql = `
            SELECT id, organization_id, filename, original_filename, status, chunks_stored, created_at, updated_at
            FROM documents
            WHERE (id::text = $1 OR filename = $1 OR original_filename = $1)
              AND organization_id = $2
            LIMIT 1;
        `;
        const res = await query(sql, [cleanId, organizationId.trim()]);
        if (res.rows.length > 0) {
            docRow = res.rows[0];
        }
    } catch (dbErr) {
        console.warn(`[FileReadTool] PostgreSQL query warning: ${dbErr.message}`);
    }

    // 3. Query Qdrant for document chunks strictly filtered by organizationId
    const retrievedChunks = [];
    const targetDocId = docRow ? docRow.id : cleanId;

    try {
        const scrollUrl = `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`;
        const scrollRes = await fetch(scrollUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filter: {
                    must: [
                        {
                            key: "documentId",
                            match: { value: targetDocId },
                        },
                        {
                            key: "organizationId",
                            match: { value: organizationId.trim() },
                        },
                    ],
                },
                limit: maxChunks,
                with_payload: true,
            }),
            signal: AbortSignal.timeout(3000),
        });

        if (scrollRes.ok) {
            const data = await scrollRes.json();
            const points = data?.result?.points || [];
            for (const pt of points) {
                if (pt.payload?.text) {
                    retrievedChunks.push({
                        page: pt.payload.page ?? 1,
                        chunkIndex: pt.payload.chunkIndex ?? 0,
                        text: pt.payload.text.trim(),
                    });
                }
            }
        }
    } catch (qdrantErr) {
        console.warn(`[FileReadTool] Qdrant scroll warning: ${qdrantErr.message}`);
    }

    if (!docRow && retrievedChunks.length === 0) {
        throw new FileReadError(`Document '${cleanId}' was not found in the persistent store.`);
    }

    const filename = docRow?.original_filename || docRow?.filename || "document.pdf";
    const status = docRow?.status || "Indexed";
    const totalChunks = docRow?.chunks_stored || retrievedChunks.length;

    // Concatenate excerpts for agent context (capped at 3000 chars)
    const textExcerpt = retrievedChunks
        .map((c) => `[Page ${c.page}] ${c.text}`)
        .join("\n\n")
        .slice(0, 3000);

    return {
        documentId: targetDocId,
        filename,
        status,
        totalChunks,
        chunksRetrieved: retrievedChunks.length,
        textExcerpt: textExcerpt || "(No text content indexed for this document)",
        chunks: retrievedChunks,
    };
}
