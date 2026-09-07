/**
 * Generates the authoritative internal industrial Knowledge Base PDFs.
 * 
 * 1. knowledge/Maintenance_SOP.pdf
 * 2. knowledge/Safety_SOP.pdf
 * 3. knowledge/Inspection_Guidelines.pdf
 *
 * Uses built-in Node.js buffer operations to produce valid PDF 1.4 files.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");

function buildPdf(pages) {
    const parts = [];
    const offsets = {};
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

    write("%PDF-1.4\n");

    const pageObjectIds = [];
    const contentObjectIds = [];
    let nextId = 3;

    for (const lines of pages) {
        const pageId = nextId++;
        const contentId = nextId++;
        pageObjectIds.push(pageId);
        contentObjectIds.push(contentId);

        const textLines = lines.map((line, i) => {
            const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            if (i === 0) {
                return `BT /F1 11 Tf 50 740 Td 15 TL (${safe}) Tj T*`;
            }
            return `(${safe}) Tj T*`;
        });
        textLines.push("ET");
        const stream = textLines.join("\n");

        offsets[contentId] = pos;
        write(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

        offsets[pageId] = pos;
        write(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n`);
    }

    // Pages object
    offsets[2] = pos;
    write(`2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

    // Catalog object
    offsets[1] = pos;
    write(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

    // Cross-reference table
    const startXref = pos;
    const totalObjs = nextId;
    write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
    for (let i = 1; i < totalObjs; i++) {
        write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
    }

    // Trailer
    write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

    return Buffer.concat(parts);
}

const MAINTENANCE_SOP_PAGES = [
    [
        "STANDARD OPERATING PROCEDURE — PUMP BEARING TEMPERATURE MAINTENANCE",
        "",
        "Document ID: SOP-MAINT-001",
        "Document Type: sop",
        "Revision: Rev 3.2",
        "Effective Date: 2026-01-15",
        "Department: Industrial Rotating Equipment Division",
        "",
        "1. Scope and Equipment Applicability",
        "This standard operating procedure governs centrifugal pumps, crude transfer pumps,",
        "and heavy rotating equipment including Pump-01, Pump-02, and Pump-03.",
        "",
        "2. Thermal Operating Limits",
        "Normal operating temperature for centrifugal pump bearings is 60 to 75 degrees Celsius.",
        "The continuous operating limit for bearing temperature is 80 degrees Celsius (80 C).",
        "Any observed bearing temperature exceeding 80 degrees Celsius is an abnormal excursion.",
        "",
        "3. Corrective Action Requirements",
        "If bearing temperature exceeds 80 degrees Celsius:",
        "  1. Reduce operating load immediately.",
        "  2. Inspect lubrication condition, oil level, and lubricant viscosity.",
        "  3. Check bearing condition and alignment for mechanical degradation.",
        "  4. Escalate for maintenance inspection within 2 hours.",
    ],
    [
        "STANDARD OPERATING PROCEDURE — PUMP BEARING TEMPERATURE MAINTENANCE",
        "",
        "Document ID: SOP-MAINT-001 (Page 2)",
        "",
        "4. Critical Escalation and Emergency Thresholds",
        "If bearing temperature reaches or exceeds 95 degrees Celsius:",
        "  - Immediate shutdown of the pump unit is mandatory to prevent seizure.",
        "  - Tag unit as OUT OF SERVICE under Lockout/Tagout protocol.",
        "  - Drain and replace bearing oil reservoir.",
        "  - Perform vibration spectral analysis before restart.",
        "",
        "5. Documentation and Quality Records",
        "All thermal excursions and maintenance actions must be logged in the shift logbook.",
        "Inspection approval notes must cite SOP-MAINT-001 and record measured deviations.",
    ],
];

const SAFETY_SOP_PAGES = [
    [
        "STANDARD OPERATING PROCEDURE — INDUSTRIAL PLANT SAFETY & ISOLATION",
        "",
        "Document ID: SOP-SAFE-002",
        "Document Type: sop",
        "Revision: Rev 2.1",
        "Effective Date: 2026-02-01",
        "Department: Health, Safety & Environment (HSE)",
        "",
        "1. Mandatory Personal Protective Equipment (PPE)",
        "All personnel entering rotating equipment areas and operating units must wear:",
        "  - Industrial safety helmet (EN 397 certified)",
        "  - Steel-toe boots with puncture-resistant soles",
        "  - High-visibility safety vest",
        "  - Safety glasses with side shields",
        "  - Heat-resistant gloves when inspecting hot surfaces",
        "",
        "2. Emergency Isolation and Shutdown Procedure",
        "In case of fire, bearing seizure, or catastrophic equipment vibration:",
        "  1. Depress the nearest emergency trip button immediately.",
        "  2. Evacuate non-essential personnel to the designated muster point.",
        "  3. Notify the central control room via direct radio channel 4.",
        "  4. Do not re-enter the area until cleared by the safety officer.",
    ],
    [
        "STANDARD OPERATING PROCEDURE — INDUSTRIAL PLANT SAFETY & ISOLATION",
        "",
        "Document ID: SOP-SAFE-002 (Page 2)",
        "",
        "3. Lockout/Tagout (LOTO) Procedure",
        "Before performing any mechanical or electrical maintenance on rotating machinery:",
        "  1. Identify all electrical, hydraulic, and pneumatic energy sources.",
        "  2. Notify operations supervisor and affected shift personnel.",
        "  3. Open circuit breakers and isolate feed valves.",
        "  4. Apply standardized LOTO padlock and danger warning tag.",
        "  5. Verify zero energy state using voltage detector and manual rotation check.",
        "  6. Maintain lockout key in authorized lockbox during entire work duration.",
    ],
];

const INSPECTION_GUIDELINES_PAGES = [
    [
        "INDUSTRIAL INSPECTION GUIDELINES & SEVERITY STANDARDS",
        "",
        "Document ID: SOP-INSP-003",
        "Document Type: sop",
        "Revision: Rev 1.4",
        "Effective Date: 2026-02-15",
        "Department: Quality Assurance & Reliability",
        "",
        "1. Inspection Regimes and Frequency",
        "Rotating machinery must undergo systematic surveillance:",
        "  - Daily routine inspection: Thermal imaging, surface temperature, audible checks.",
        "  - Monthly comprehensive inspection: Vibration spectral analysis, oil sampling.",
        "  - Quarterly shutdown audit: Internal bearing clearance, seal inspection.",
        "",
        "2. Severity Classification Matrix",
        "Observations must be categorized according to deviation from baseline:",
        "  - HIGH SEVERITY: Parameter exceeds continuous limit by > 10% (e.g. Temp > 88 C).",
        "    Action: Immediate operational restriction and expedited maintenance review.",
        "  - MEDIUM SEVERITY: Parameter between normal baseline and limit (75 C - 80 C).",
        "    Action: Schedule maintenance inspection within 48 hours.",
        "  - LOW SEVERITY: Minor aesthetic or non-functional observation (e.g. minor paint wear).",
        "    Action: Log observation and monitor during next scheduled cycle.",
    ],
    [
        "INDUSTRIAL INSPECTION GUIDELINES & SEVERITY STANDARDS",
        "",
        "Document ID: SOP-INSP-003 (Page 2)",
        "",
        "3. Evidence Recording and Traceability",
        "Every recorded inspection finding must capture:",
        "  - Asset / equipment identifier (e.g. Pump-03)",
        "  - Quantitative observed value with physical unit of measurement (e.g. 92 C)",
        "  - Benchmark operating limit from authoritative SOP (e.g. 80 C)",
        "  - Exact document source, page number, and paragraph citation.",
        "",
        "4. Approval Note Preparation",
        "Approval notes must synthesize findings, technical analysis against SOP thresholds,",
        "risk rating, recommended remedial actions, and authoritative references.",
    ],
];

export async function generateKnowledgeBase() {
    await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });

    const files = [
        ["Maintenance_SOP.pdf", MAINTENANCE_SOP_PAGES],
        ["Safety_SOP.pdf", SAFETY_SOP_PAGES],
        ["Inspection_Guidelines.pdf", INSPECTION_GUIDELINES_PAGES],
    ];

    const results = [];
    for (const [filename, pages] of files) {
        const outPath = path.join(KNOWLEDGE_DIR, filename);
        const pdfBuffer = buildPdf(pages);
        await fs.writeFile(outPath, pdfBuffer);
        results.push({ filename, path: outPath, bytes: pdfBuffer.length, pages: pages.length });
        console.log(`✓ Created ${filename} in knowledge/ (${pdfBuffer.length} bytes, ${pages.length} pages)`);
    }

    return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    generateKnowledgeBase()
        .then(() => console.log("\n✅ Authoritative knowledge/ directory generated successfully."))
        .catch((err) => {
            console.error("Failed to generate knowledge base:", err);
            process.exit(1);
        });
}
