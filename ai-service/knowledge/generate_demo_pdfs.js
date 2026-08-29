/**
 * Generates valid minimal PDF files for the 3 demo SOP documents.
 * Uses only built-in Node.js APIs — no external PDF library needed.
 *
 * Run once:
 *   node ai-service/knowledge/generate_demo_pdfs.js
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build a minimal but valid PDF (PDF 1.4) containing plain ASCII text.
 * Each element in `pages` is an array of lines for that page.
 *
 * @param {string[][]} pages
 * @returns {Buffer}
 */
function buildPdf(pages) {
    // We accumulate the byte stream and record cross-reference offsets.
    const parts = [];
    const offsets = {}; // objectId → byte offset

    let pos = 0;
    function write(str) {
        const buf = Buffer.from(str, "latin1");
        parts.push(buf);
        pos += buf.length;
    }
    function writeObj(id, str) {
        offsets[id] = pos;
        write(`${id} 0 obj\n${str}\nendobj\n`);
    }

    // Header
    write("%PDF-1.4\n");

    // We build one page at a time.
    // Object layout:
    //   1 = Catalog
    //   2 = Pages
    //   3..N = Page + Content stream pairs (2 objects each)

    const pageObjectIds = [];
    const contentObjectIds = [];

    let nextId = 3;

    for (const lines of pages) {
        const pageId = nextId++;
        const contentId = nextId++;
        pageObjectIds.push(pageId);
        contentObjectIds.push(contentId);

        // Build content stream (BT...ET text block)
        const textLines = lines.map((line, i) => {
            // Escape parentheses and backslashes for PDF string syntax
            const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            if (i === 0) {
                return `BT /F1 11 Tf 50 750 Td (${safe}) Tj T*`;
            }
            return `(${safe}) Tj T*`;
        });
        // Close text block
        textLines.push("ET");
        const stream = textLines.join("\n");

        // Write content stream object
        offsets[contentId] = pos;
        write(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

        // Write page object (points to content stream)
        offsets[pageId] = pos;
        write(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n`);
    }

    // Write Pages object (object 2)
    const kidsStr = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
    offsets[2] = pos;
    write(`2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>\nendobj\n`);

    // Write Catalog (object 1)
    offsets[1] = pos;
    write(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

    // Cross-reference table
    const xrefOffset = pos;
    const totalObjects = nextId - 1;
    write(`xref\n0 ${totalObjects + 1}\n`);
    write(`0000000000 65535 f \n`);
    for (let i = 1; i <= totalObjects; i++) {
        const off = String(offsets[i] ?? 0).padStart(10, "0");
        write(`${off} 00000 n \n`);
    }

    // Trailer
    write(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n`);
    write(`startxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.concat(parts);
}

// ─── Document content ─────────────────────────────────────────────────────────

const MAINTENANCE_SOP_PAGES = [
    [
        "DEMO MAINTENANCE SOP",
        "",
        "Document ID: SOP-MAINT-001",
        "Version: 1.0",
        "",
        "1. Bearing Temperature Monitoring",
        "",
        "Normal bearing operating temperature is up to 80 degrees C.",
        "",
        "If bearing temperature exceeds 80 degrees C:",
        "  1. Record the observed temperature.",
        "  2. Inspect the bearing assembly.",
        "  3. Check lubrication condition.",
        "  4. Check for abnormal vibration.",
        "  5. Do not return equipment to service until inspection is complete.",
    ],
    [
        "2. Abnormal Vibration",
        "",
        "If abnormal vibration is observed:",
        "  1. Record the observation.",
        "  2. Inspect the rotating assembly.",
        "  3. Check bearing condition.",
        "  4. Check alignment where applicable.",
        "",
        "3. Maintenance Evidence",
        "",
        "All observations must be recorded with the equipment identifier,",
        "observed value where applicable, and inspection date.",
    ],
];

const SAFETY_SOP_PAGES = [
    [
        "DEMO SAFETY SOP",
        "",
        "Document ID: SOP-SAFETY-001",
        "Version: 1.0",
        "",
        "1. Personal Protective Equipment",
        "",
        "All personnel entering the industrial floor must wear:",
        "  - Safety helmet",
        "  - Steel-toe boots",
        "  - High-visibility vest",
        "  - Safety glasses",
        "",
        "2. Emergency Shutdown Procedure",
        "",
        "In case of fire or critical equipment failure:",
        "  1. Press the nearest emergency stop button.",
        "  2. Evacuate personnel from the area.",
        "  3. Notify the control room immediately.",
        "  4. Do not re-enter until cleared by safety officer.",
    ],
    [
        "3. Lockout/Tagout Procedure",
        "",
        "Before any maintenance work on energized equipment:",
        "  1. Identify all energy sources.",
        "  2. Notify the affected personnel.",
        "  3. Shut down the equipment using normal procedure.",
        "  4. Isolate the energy source.",
        "  5. Apply lockout/tagout device.",
        "  6. Verify that energy is isolated before proceeding.",
    ],
];

const INSPECTION_GUIDELINES_PAGES = [
    [
        "DEMO INSPECTION GUIDELINES",
        "",
        "Document ID: SOP-INSP-001",
        "Version: 1.0",
        "",
        "1. Inspection Frequency",
        "",
        "Routine inspection of rotating equipment must be conducted daily.",
        "Comprehensive inspection must be conducted monthly.",
        "",
        "2. Inspection Checklist",
        "",
        "For each equipment unit record:",
        "  - Temperature (ambient and bearing)",
        "  - Vibration levels",
        "  - Lubrication condition",
        "  - Visual inspection for leaks",
        "  - Noise and operational anomalies",
    ],
    [
        "3. Reporting Requirements",
        "",
        "All findings must be documented in the inspection report.",
        "Critical findings must be escalated to the maintenance team within 2 hours.",
        "Non-critical findings must be logged within 24 hours.",
        "",
        "4. Severity Classification",
        "",
        "High   - Immediate shutdown required.",
        "Medium - Schedule repair within 48 hours.",
        "Low    - Monitor and log; schedule at next maintenance window.",
    ],
];

// ─── Generate and write ───────────────────────────────────────────────────────

async function generate() {
    const files = [
        ["Demo_Maintenance_SOP.pdf", MAINTENANCE_SOP_PAGES],
        ["Demo_Safety_SOP.pdf", SAFETY_SOP_PAGES],
        ["Demo_Inspection_Guidelines.pdf", INSPECTION_GUIDELINES_PAGES],
    ];

    for (const [filename, pages] of files) {
        const outPath = path.join(__dirname, filename);
        const pdfBuffer = buildPdf(pages);
        await fs.writeFile(outPath, pdfBuffer);
        console.log(`✓ Generated ${filename} (${pdfBuffer.length} bytes, ${pages.length} page(s))`);
    }

    console.log("\n✅ All demo SOP PDFs generated");
}

await generate();
