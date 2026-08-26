const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

/**
 * Split extracted PDF text into overlapping chunks.
 *
 * @param {string} text - Extracted PDF text
 * @returns {Array<{
 *   chunkIndex: number,
 *   text: string,
 *   startOffset: number,
 *   endOffset: number
 * }>}
 */
function chunkText(text) {
    if (typeof text !== "string") {
        throw new TypeError("Text must be a string");
    }

    if (text.trim().length === 0) {
        throw new Error("Text cannot be empty");
    }

    const chunks = [];

    const step = CHUNK_SIZE - CHUNK_OVERLAP;

    let chunkIndex = 0;

    for(let start = 0;start <text.length; start += step){
        let end = Math.min(start + CHUNK_SIZE, text.length);
        chunks.push({
            chunkIndex,
            text:text.slice(start,end),
            startOffset:start,
            endOffset:end,
        });
        chunkIndex++;
        if(end == text.length){
            break;
        }
    }
    return chunks;
}

export { chunkText };

