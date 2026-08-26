const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Split extracted PDF text into overlapping chunks.
 *
 * @param {string} text - Extracted PDF text
 * @param {string} documentId - Unique ID of the source document
 * @returns {Array<{
 *   documentId: string,
 *   chunkIndex: number,
 *   text: string,
 *   startOffset: number,
 *   endOffset: number
 * }>}
 */
function chunkText(text, documentId) {
    if (typeof text !== "string") {
        throw new TypeError("Text must be a string");
    }

    if (text.trim().length === 0) {
        throw new Error("Text cannot be empty");
    }

    if (
        typeof documentId !== "string" ||
        documentId.trim().length === 0
    ) {
        throw new TypeError("documentId must be a non-empty string");
    }

    const chunks = [];
    const step = CHUNK_SIZE - CHUNK_OVERLAP;

    let chunkIndex = 0;

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
            chunkIndex,
            text: text.slice(start, end),
            startOffset: start,
            endOffset: end,
        });

        chunkIndex++;

        if (end === text.length) {
            break;
        }
    }

    return chunks;
}

export { chunkText };