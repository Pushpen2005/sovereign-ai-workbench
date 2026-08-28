const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Split extracted PDF pages into overlapping chunks.
 *
 * Chunking is performed independently for each page.
 * chunkIndex remains global across the document.
 *
 * @param {Array<{
 *   page: number,
 *   text: string
 * }>} pages - Page-aware extracted PDF text
 *
 * @param {string} documentId - Unique ID of the source document
 *
 * @returns {Array<{
 *   documentId: string,
 *   page: number,
 *   chunkIndex: number,
 *   text: string,
 *   pageStartOffset: number,
 *   pageEndOffset: number
 * }>}
 */
function chunkText(pages, documentId) {
    if (!Array.isArray(pages)) {
        throw new TypeError("Pages must be an array");
    }

    if (pages.length === 0) {
        throw new Error("Pages cannot be empty");
    }

    if (
        typeof documentId !== "string" ||
        documentId.trim().length === 0
    ) {
        throw new TypeError(
            "documentId must be a non-empty string"
        );
    }

    const chunks = [];

    const step = CHUNK_SIZE - CHUNK_OVERLAP;

    // IMPORTANT:
    // Keep this outside the page loop.
    // This makes chunkIndex global across the document.
    let chunkIndex = 0;

    for (const pageData of pages) {
        if (!pageData || typeof pageData.text !== "string") {
            continue;
        }

        const page = pageData.page;
        const text = pageData.text;

        // Skip empty pages
        if (text.trim().length === 0) {
            continue;
        }

        // Chunk this page independently
        for (
            let start = 0;
            start < text.length;
            start += step
        ) {
            const end = Math.min(
                start + CHUNK_SIZE,
                text.length
            );

            chunks.push({
                documentId,
                page,
                chunkIndex,
                text: text.slice(start, end),
                pageStartOffset: start,
                pageEndOffset: end,
            });

            chunkIndex++;

            if (end === text.length) {
                break;
            }
        }
    }

    return chunks;
}

export { chunkText };