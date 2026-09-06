import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "../backend/node_modules/canvas/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEMO_DIR = path.resolve(__dirname, "../documents/demo");

function buildMinimalPdf(pages) {
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
            const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
            return i === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
        });

        const streamContent = ["BT", "/F1 11 Tf", "14.5 TL", "50 750 Td", ...textLines, "ET"].join("\n") + "\n";
        const streamLen = Buffer.byteLength(streamContent, "latin1");
        writeObj(contentId, `<< /Length ${streamLen} >>\nstream\n${streamContent}endstream`);
    }

    const pagesObjStr =
        `<< /Type /Pages\n` +
        `/Count ${pages.length}\n` +
        `/Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}]\n` +
        `>>`;
    writeObj(2, pagesObjStr);

    for (let i = 0; i < pages.length; i++) {
        const pageId = pageObjectIds[i];
        const contentId = contentObjectIds[i];
        const pageObjStr =
            `<< /Type /Page\n` +
            `/Parent 2 0 R\n` +
            `/MediaBox [0 0 612 792]\n` +
            `/Contents ${contentId} 0 R\n` +
            `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>\n` +
            `>>`;
        writeObj(pageId, pageObjStr);
    }

    writeObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);

    const xrefOffset = pos;
    const totalObjs = nextId;
    write(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
    for (let id = 1; id < totalObjs; id++) {
        const offsetStr = String(offsets[id]).padStart(10, "0");
        write(`${offsetStr} 00000 n \n`);
    }
    write(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.concat(parts);
}

function generateDemoFiles() {
    if (!fs.existsSync(DEMO_DIR)) {
        fs.mkdirSync(DEMO_DIR, { recursive: true });
    }

    // 1. Pump03_Inspection.pdf
    const inspectionPdf = buildMinimalPdf([
        [
            "SYNTHETIC DEMONSTRATION DATA -- FOR EVALUATION ONLY",
            "EQUIPMENT INSPECTION REPORT -- PUMP-03",
            "Asset ID: Pump-03 (Crude Distillation Unit Cooling Water Booster)",
            "Inspection Date: 2026-08-15",
            "Observed Bearing Temperature: 92 degrees C under full operating load.",
            "Visual Inspection: Heavy casing vibration detected on bearing housing.",
            "Operating Status: Continuous service; abnormal heating observed during routine daily round.",
            "Reported By: Senior Reliability Engineer (Demo Account)"
        ],
        [
            "SYNTHETIC DEMONSTRATION DATA -- FOR EVALUATION ONLY",
            "PUMP-03 HISTORICAL LOGS AND SENSOR READINGS",
            "Vibration Level: 6.8 mm/s RMS (ISO 10816-3 Zone C/D Limit is 4.5 mm/s)",
            "Lubrication Oil Level: Low with slight discoloration.",
            "Maintenance Urgency: High priority inspection recommended."
        ]
    ]);
    fs.writeFileSync(path.join(DEMO_DIR, "Pump03_Inspection.pdf"), inspectionPdf);
    console.log("Created documents/demo/Pump03_Inspection.pdf");

    // 2. Maintenance_SOP.pdf
    const maintenanceSopPdf = buildMinimalPdf([
        [
            "SYNTHETIC DEMONSTRATION DATA -- FOR EVALUATION ONLY",
            "REFINERY STANDARD OPERATING PROCEDURE",
            "Document ID: SOP-MAINT-001 (Version 2.4)",
            "Title: Rotating Equipment Bearing Temperature & Vibration Monitoring",
            "1. Operating Limits:",
            "Normal bearing operating temperature for pumps and motors is up to 80 degrees C.",
            "Maximum continuous operating limit is 80 degrees C.",
            "2. Mandatory Actions:",
            "If bearing temperature exceeds 80 degrees C, record temperature and inspect bearing immediately.",
            "Schedule maintenance inspection within 24 hours to prevent cataclysmic bearing seizure."
        ],
        [
            "SYNTHETIC DEMONSTRATION DATA -- FOR EVALUATION ONLY",
            "SOP-MAINT-001 -- CORRECTIVE ACTIONS & APPROVAL PROCESS",
            "3. Corrective Actions for Thermal Exceedance (> 80 C):",
            "- Isolate secondary bypass if safe to do so.",
            "- Check oil reservoir and replace contaminated lubricant.",
            "- Check axial alignment and mechanical seal condition.",
            "4. Approval Authority:",
            "All repairs on Class-1 rotating equipment require an Approval Note signed by Lead Maintenance Engineer."
        ]
    ]);
    fs.writeFileSync(path.join(DEMO_DIR, "Maintenance_SOP.pdf"), maintenanceSopPdf);
    console.log("Created documents/demo/Maintenance_SOP.pdf");

    // 3. Safety_SOP.pdf
    const safetySopPdf = buildMinimalPdf([
        [
            "SYNTHETIC DEMONSTRATION DATA -- FOR EVALUATION ONLY",
            "REFINERY SAFETY STANDARD OPERATING PROCEDURE",
            "Document ID: SOP-SAFETY-004 (Version 3.1)",
            "Title: Thermal Hazard Mitigation & Personnel Protective Equipment",
            "1. Hazard Identification:",
            "Equipment operating above 70 degrees C surface temperature constitutes a burn hazard.",
            "High-temperature thermal hazard signage must be displayed within a 2-meter radius.",
            "2. Required PPE: Heat-resistant gloves and full fire-retardant coveralls required."
        ]
    ]);
    fs.writeFileSync(path.join(DEMO_DIR, "Safety_SOP.pdf"), safetySopPdf);
    console.log("Created documents/demo/Safety_SOP.pdf");

    // 4. Pump03_Vibration_Gauge.png
    const canvas = createCanvas(500, 260);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#0f172a"; // Dark slate
    ctx.fillRect(0, 0, 500, 260);

    // Border
    ctx.strokeStyle = "#38bdf8"; // Cyan border
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 476, 236);

    // Title
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("SYNTHETIC DEMO DATA -- PUMP-03 VIBRATION GAUGE", 30, 42);

    // Main Reading
    ctx.fillStyle = "#ef4444"; // Red alarm
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("6.8 mm/s", 130, 115);

    // Label
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("BEARING HOUSING RMS VELOCITY", 75, 155);

    // Threshold details
    ctx.fillStyle = "#fbbf24"; // Amber warning
    ctx.font = "15px sans-serif";
    ctx.fillText("ISO 10816-3 Threshold: 4.5 mm/s [ALARM EXCEEDED]", 65, 195);

    // Asset ID
    ctx.fillStyle = "#64748b";
    ctx.font = "13px sans-serif";
    ctx.fillText("Asset ID: Pump-03  |  Sensor ID: VIB-P03-Z  |  Status: ACTIVE", 60, 225);

    const imageBuffer = canvas.toBuffer("image/png");
    fs.writeFileSync(path.join(DEMO_DIR, "Pump03_Vibration_Gauge.png"), imageBuffer);
    console.log("Created documents/demo/Pump03_Vibration_Gauge.png");

    // 5. README.md
    const readmeContent = `# Synthetic Demonstration Data

> [!NOTE]
> All files in this directory are **SYNTHETIC DEMONSTRATION DATA** created exclusively for evaluating and demonstrating the **SovereignAI** industrial workbench.
>
> They do **NOT** contain real-world, confidential, proprietary, or classified industrial records from MRPL or any refinery facility.

## Available Demo Files

1. **\`Pump03_Inspection.pdf\`**
   - Synthetic daily equipment inspection log for a centrifugal cooling pump.
   - Highlights an observed bearing temperature of **92°C** and vibration anomalies.
   - Used for: RAG Q&A, Inspection Agent finding extraction, and Approval Note generation.

2. **\`Maintenance_SOP.pdf\`**
   - Standard Operating Procedure (\`SOP-MAINT-001\`) for rotating equipment.
   - Defines normal operating bearing temperature limit as **80°C**.
   - Used for: Grounded SOP retrieval, numerical technical analysis, and risk assessment.

3. **\`Safety_SOP.pdf\`**
   - Standard Operating Procedure (\`SOP-SAFETY-004\`) covering thermal hazards and PPE.
   - Used for: Multi-document RAG and cross-document citation validation.

4. **\`Pump03_Vibration_Gauge.png\`**
   - Synthetic vibration sensor display graphic showing an alarm reading of **6.8 mm/s**.
   - Used for: Local Multimodal Vision demonstration with \`moondream:latest\`.
`;
    fs.writeFileSync(path.join(DEMO_DIR, "README.md"), readmeContent);
    console.log("Created documents/demo/README.md");
}

generateDemoFiles();
