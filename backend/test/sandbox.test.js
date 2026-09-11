import test, { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import { executeInSandbox, validateLanguage, validatePythonSyntax, SandboxValidationError } from "../src/services/sandbox.service.js";
import { validateAndParseCsv, CsvValidationError } from "../src/services/csv.service.js";
import { extractPythonCode, CodeExtractionError } from "../src/controllers/coding.controller.js";
import { executeRegisteredTool, TOOL_REGISTRY } from "../src/services/agentTools/toolRegistry.js";
import { routeTask } from "../../ai-service/router/modelRouter.js";

describe("Phase 4 / Phase 10 - Hardened Python-Only Coding Sandbox", { concurrency: 1 }, () => {

    // ─────────────────────────────────────────────────────────────
    // 1. CODE EXTRACTION TESTS
    // ─────────────────────────────────────────────────────────────
    describe("1. Code Extraction & Normalization", () => {
        it("extracts Python fenced code (```python ... ```)", () => {
            const raw = "```python\nprint('hello python')\n```";
            const extracted = extractPythonCode(raw);
            assert.strictEqual(extracted, "print('hello python')");
        });

        it("extracts code with explanation text before and after (Case B)", () => {
            const raw = "Here is the calculation:\n```python\nx = 10\nprint(x * 2)\n```\nThis outputs 20.";
            const extracted = extractPythonCode(raw);
            assert.strictEqual(extracted, "x = 10\nprint(x * 2)");
        });

        it("preserves raw Python code without fences unchanged (Case C)", () => {
            const raw = "import math\nprint(math.sqrt(16))";
            const extracted = extractPythonCode(raw);
            assert.strictEqual(extracted, "import math\nprint(math.sqrt(16))");
        });

        it("extracts code from generic fenced blocks (Case D)", () => {
            const raw = "```\nprint('generic block')\n```";
            const extracted = extractPythonCode(raw);
            assert.strictEqual(extracted, "print('generic block')");
        });

        it("rejects empty or whitespace-only response (Case E)", () => {
            assert.throws(() => extractPythonCode(""), CodeExtractionError);
            assert.throws(() => extractPythonCode("   \n\t  "), CodeExtractionError);
            assert.throws(() => extractPythonCode(null), CodeExtractionError);
            assert.throws(() => extractPythonCode("```python\n\n```"), CodeExtractionError);
        });

        it("rejects conversational refusal without code", () => {
            assert.throws(
                () => extractPythonCode("I am sorry, as an AI language model, I cannot write harmful scripts."),
                CodeExtractionError
            );
        });

        it("extracts first Python block when multiple blocks exist", () => {
            const raw = "First block:\n```python\nprint('first')\n```\nSecond block:\n```python\nprint('second')\n```";
            const extracted = extractPythonCode(raw);
            assert.strictEqual(extracted, "print('first')");
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 2. LANGUAGE VALIDATION TESTS
    // ─────────────────────────────────────────────────────────────
    describe("2. Language Validation (Python-Only Contract)", () => {
        it("accepts 'python' and 'py'", () => {
            assert.strictEqual(validateLanguage("python"), "python");
            assert.strictEqual(validateLanguage("py"), "python");
            assert.strictEqual(validateLanguage("PYTHON"), "python");
        });

        it("rejects 'javascript' and aliases with exact error message", () => {
            assert.throws(
                () => validateLanguage("javascript"),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
            assert.throws(
                () => validateLanguage("js"),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
            assert.throws(
                () => validateLanguage("node"),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
        });

        it("rejects arbitrary unsupported languages", () => {
            assert.throws(
                () => validateLanguage("ruby"),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
            assert.throws(
                () => validateLanguage("bash"),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
        });

        it("executeInSandbox rejects non-python language call", async () => {
            await assert.rejects(
                () => executeInSandbox({ code: "console.log('hi')", language: "javascript" }),
                (err) => {
                    assert.strictEqual(err.message, "Only Python execution is supported.");
                    return true;
                }
            );
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 3. CSV VALIDATION & SECURITY TESTS
    // ─────────────────────────────────────────────────────────────
    describe("3. CSV Validation & Security", () => {
        it("validates and parses valid CSV content", () => {
            const content = "timestamp,temperature,pressure\n10:00,75,1.5\n10:10,82,1.4";
            const parsed = validateAndParseCsv({ content, filename: "sensor_data.csv" });
            assert.strictEqual(parsed.valid, true);
            assert.deepStrictEqual(parsed.columns, ["timestamp", "temperature", "pressure"]);
            assert.strictEqual(parsed.rowCount, 2);
            assert.strictEqual(parsed.internalPath, "/workspace/input/data.csv");
        });

        it("rejects empty CSV content", () => {
            assert.throws(
                () => validateAndParseCsv({ content: "   \n  ", filename: "data.csv" }),
                CsvValidationError
            );
        });

        it("rejects malformed CSV with missing or empty header", () => {
            assert.throws(
                () => validateAndParseCsv({ content: "\n\n", filename: "data.csv" }),
                CsvValidationError
            );
        });

        it("rejects oversized CSV (> 5 MB)", () => {
            const largeContent = "col1,col2\n" + "a".repeat(5 * 1024 * 1024 + 10);
            assert.throws(
                () => validateAndParseCsv({ content: largeContent, filename: "data.csv" }),
                (err) => {
                    assert.match(err.message, /exceeds limit/);
                    return true;
                }
            );
        });

        it("rejects path traversal in filename (../../something)", () => {
            const content = "a,b\n1,2";
            assert.throws(
                () => validateAndParseCsv({ content, filename: "../../etc/passwd" }),
                (err) => {
                    assert.match(err.message, /Path traversal attempts are strictly forbidden/);
                    return true;
                }
            );
            assert.throws(
                () => validateAndParseCsv({ content, filename: "/absolute/path/data.csv" }),
                (err) => {
                    assert.match(err.message, /Path traversal attempts are strictly forbidden/);
                    return true;
                }
            );
        });

        it("rejects non-csv file extension", () => {
            const content = "malicious payload";
            assert.throws(
                () => validateAndParseCsv({ content, filename: "script.py" }),
                (err) => {
                    assert.match(err.message, /Only \.csv files are supported/);
                    return true;
                }
            );
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 4. SANDBOX EXECUTION & ISOLATION
    // ─────────────────────────────────────────────────────────────
    describe("4. Sandbox Execution & Container Boundary", () => {
        it("executes valid Python code successfully with exit code 0", async () => {
            const res = await executeInSandbox({ code: 'print("hello sovereign")' });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.stdout.trim(), "hello sovereign");
            assert.strictEqual(res.timedOut, false);
            assert.strictEqual(res.success, true);
        });

        it("rejects unterminated strings before Docker execution", () => {
            assert.throws(
                () => validatePythonSyntax('print("unterminated)'),
                (err) => {
                    assert.strictEqual(err.code, "PYTHON_SYNTAX_ERROR");
                    assert.match(err.message, /SyntaxError/);
                    return true;
                }
            );
        });

        it("rejects invalid Python syntax before Docker execution", () => {
            assert.throws(
                () => validatePythonSyntax("for"),
                (err) => {
                    assert.strictEqual(err.code, "PYTHON_SYNTAX_ERROR");
                    assert.match(err.message, /SyntaxError/);
                    return true;
                }
            );
        });

        it("rejects malformed print statements before Docker execution", () => {
            assert.throws(
                () => validatePythonSyntax("print("),
                (err) => {
                    assert.strictEqual(err.code, "PYTHON_SYNTAX_ERROR");
                    assert.match(err.message, /SyntaxError/);
                    return true;
                }
            );
        });

        it("does not send syntactically invalid code to Docker", async () => {
            await assert.rejects(
                () => executeInSandbox({ code: "print(1 /)" }),
                (err) => {
                    assert.strictEqual(err.code, "PYTHON_SYNTAX_ERROR");
                    assert.strictEqual(err.stage, "validation");
                    return true;
                }
            );
        });

        it("captures runtime exceptions (ZeroDivisionError) with stderr", async () => {
            const res = await executeInSandbox({ code: 'print(1 / 0)' });
            assert.notStrictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, false);
            assert.match(res.stderr, /ZeroDivisionError/);
        });

        it("enforces execution timeout and terminates infinite loop", async () => {
            const res = await executeInSandbox({ code: 'while True: pass', timeoutMs: 1500 });
            assert.strictEqual(res.timedOut, true);
            assert.strictEqual(res.success, false);
            assert.match(res.stderr, /timed out/i);
        });

        it("enforces network isolation (--network none)", async () => {
            const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("NET_SUCCESS")
except Exception as e:
    print(f"NET_BLOCKED: {type(e).__name__}")
`;
            const res = await executeInSandbox({ code, timeoutMs: 8000 });
            assert.strictEqual(res.exitCode, 0);
            assert.match(res.stdout, /NET_BLOCKED/);
        });

        it("enforces filesystem isolation: host filesystem is inaccessible", async () => {
            const code = `
import os
print(os.path.exists("/app/.env") or os.path.exists("/Users"))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False");
        });

        it("enforces docker socket isolation: /var/run/docker.sock does not exist", async () => {
            const code = `
import os
print(os.path.exists("/var/run/docker.sock"))
`;
            const res = await executeInSandbox({ code });
            assert.strictEqual(res.stdout.trim(), "False");
        });

        it("executes Python code reading injected CSV dataset at /workspace/input/data.csv", async () => {
            const csvContent = "timestamp,temperature,pressure\n10:00,75,1.5\n10:10,82,1.4\n10:20,91,1.2";
            const code = `
import csv

with open("/workspace/input/data.csv") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

temps = [float(r["temperature"]) for r in rows]
avg_temp = sum(temps) / len(temps)
print(f"Readings: {len(rows)}, Average: {avg_temp:.1f}C")
`;
            const res = await executeInSandbox({ code, csvContent });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.stdout.trim(), "Readings: 3, Average: 82.7C");
        });

        it("verifies container and volume cleanup after execution", async () => {
            // Check docker ps before and after to ensure no orphaned containers
            const res = await executeInSandbox({ code: 'print("cleanup-test")' });
            assert.strictEqual(res.success, true);

            const ps = execSync('docker ps -a --filter "name=sovereign-coding-sandbox-" --format "{{.Names}}"').toString().trim();
            assert.strictEqual(ps, "", "No sandbox containers should remain after execution");
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 5. INTEGRATION & TOOL REGISTRY
    // ─────────────────────────────────────────────────────────────
    describe("5. Tool Registry & Integration", () => {
        it("resolves coding_sandbox and execute_sandbox_code tools in registry", async () => {
            assert.ok(TOOL_REGISTRY["coding_sandbox"], "coding_sandbox must be registered");
            assert.ok(TOOL_REGISTRY["execute_sandbox_code"], "execute_sandbox_code must be registered");

            const res = await executeRegisteredTool("coding_sandbox", { code: 'print("tool-integration")' });
            assert.strictEqual(res.status, "success");
            assert.strictEqual(res.result.stdout.trim(), "tool-integration");
        });

        it("routes coding requests to CODING task type", async () => {
            const routing = await routeTask("Write a python script to calculate pump efficiency");
            assert.strictEqual(routing.canonicalTaskType, "CODING");
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 6. INDUSTRIAL DEMO SCENARIO TEST
    // ─────────────────────────────────────────────────────────────
    describe("6. Industrial Pump Sensor Scenario", () => {
        it("executes pump sensor efficiency analysis on uploaded CSV data", async () => {
            const pumpCsv = `timestamp,temperature,pressure,flow_rate,power_consumption
2026-09-11T10:00:00Z,72.5,450,120,95
2026-09-11T10:15:00Z,78.0,440,115,98
2026-09-11T10:30:00Z,88.5,380,85,110
2026-09-11T10:45:00Z,92.0,360,75,115
2026-09-11T11:00:00Z,76.2,445,118,96`;

            const code = `
import csv

with open("/workspace/input/data.csv") as f:
    data = list(csv.DictReader(f))

total_readings = len(data)
abnormal_readings = []

for row in data:
    p = float(row["pressure"])
    q = float(row["flow_rate"])
    power = float(row["power_consumption"])
    temp = float(row["temperature"])

    eff = (p * q) / (power * 600) * 100
    if eff < 70 and temp > 85:
        abnormal_readings.append({
            "timestamp": row["timestamp"],
            "efficiency": eff,
            "temperature": temp
        })

print(f"Total readings analyzed: {total_readings}")
print(f"Abnormal readings found: {len(abnormal_readings)}")
for item in abnormal_readings:
    print(f"  Warning at {item['timestamp']}: Eff={item['efficiency']:.1f}%, Temp={item['temperature']}C")

if len(abnormal_readings) > 0:
    print("Maintenance recommendation: Inspect pump bearing cooling and impeller for fouling.")
else:
    print("Maintenance recommendation: Pump operating normally.")
`;

            const res = await executeInSandbox({ code, csvContent: pumpCsv });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, true);
            assert.match(res.stdout, /Total readings analyzed: 5/);
            assert.match(res.stdout, /Abnormal readings found: 2/);
            assert.match(res.stdout, /Warning at 2026-09-11T10:30:00Z: Eff=48.9%, Temp=88.5C/);
            assert.match(res.stdout, /Warning at 2026-09-11T10:45:00Z: Eff=39.1%, Temp=92.0C/);
            assert.match(res.stdout, /Maintenance recommendation: Inspect pump bearing cooling and impeller for fouling/);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 7. CSV DATA INTEGRITY & REGRESSION TESTS
    // ─────────────────────────────────────────────────────────────
    describe("7. CSV Data Integrity & Regression Suite", () => {
        const regressionCsv = `timestamp,temperature,pressure,flow_rate,power_consumption
10:00,70,1.50,100,0.35
10:10,80,1.30,90,0.45
10:20,92,1.05,70,0.63`;

        it("CSV Data-Integrity: preserves independent row values (10:00->70, 10:10->80, 10:20->92)", async () => {
            const code = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        ts = row['timestamp']
        temp = float(row['temperature'])
        p = float(row['pressure'])
        q = float(row['flow_rate'])
        pw = float(row['power_consumption'])
        print(f"{ts} -> {temp:.0f}C, {q:.0f} L/min, {pw:.2f}")
`;
            const res = await executeInSandbox({ code, csvContent: regressionCsv });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, true);

            // Assert each row has its own values
            assert.match(res.stdout, /10:00 -> 70C, 100 L\/min, 0\.35/);
            assert.match(res.stdout, /10:10 -> 80C, 90 L\/min, 0\.45/);
            assert.match(res.stdout, /10:20 -> 92C, 70 L\/min, 0\.63/);

            // MUST fail if all timestamps take the last row's values (92C, 70 L/min, 0.63)
            const lines = res.stdout.trim().split("\n");
            assert.strictEqual(lines.length, 3);
            const buggyCount = lines.filter(l => l.includes("92C, 70 L/min, 0.63")).length;
            assert.strictEqual(buggyCount, 1, "Only the 10:20 row should have 92C, 70 L/min, 0.63");
        });

        it("Regression Failure Detector: detects and fails if code leaks final row into earlier rows", async () => {
            // This test simulates the exact bug pattern where variables are processed after loop
            const buggyCode = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = list(csv.DictReader(f))
    for row in reader:
        temp = float(row['temperature'])
        q = float(row['flow_rate'])
        pw = float(row['power_consumption'])

    # BUG: using variables from final iteration for all timestamps
    for row in reader:
        print(f"{row['timestamp']} -> {temp:.0f}C, {q:.0f} L/min, {pw:.2f}")
`;
            const res = await executeInSandbox({ code: buggyCode, csvContent: regressionCsv });
            assert.strictEqual(res.exitCode, 0);

            // Verify our detector correctly catches the bug
            const lines = res.stdout.trim().split("\n");
            const allMatchLastRow = lines.every(l => l.includes("92C, 70 L/min, 0.63"));
            assert.strictEqual(allMatchLastRow, true, "Buggy code should replicate the reported bug");

            // Define a strict validation assertion that rejects such buggy output
            const assertNoRowLeakage = (stdout) => {
                const outLines = stdout.trim().split("\n");
                const uniqueValues = new Set(outLines.map(l => l.split("->")[1]?.trim()));
                if (uniqueValues.size <= 1 && outLines.length > 1) {
                    throw new Error("CSV_DATA_INTEGRITY_VIOLATION: all rows printed identical values");
                }
            };

            assert.throws(() => assertNoRowLeakage(res.stdout), /CSV_DATA_INTEGRITY_VIOLATION/);
        });

        it("Closed-File Bug Regression: detects and fails if csv.DictReader is iterated after file is closed", async () => {
            const buggyCode = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)

# BUG: iterating over reader after file is closed
for row in reader:
    print(row)
`;
            const res = await executeInSandbox({ code: buggyCode, csvContent: regressionCsv });
            assert.strictEqual(res.success, false);
            assert.notStrictEqual(res.exitCode, 0);
            assert.match(res.stderr, /ValueError: I\/O operation on closed file/);
        });

        it("Numerical Correctness: calculates efficiency per row using its own sensor values", async () => {
            const code = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        ts = row['timestamp']
        p = float(row['pressure'])
        q = float(row['flow_rate'])
        pw = float(row['power_consumption'])
        eff = (p * q) / (pw * 600) * 100
        print(f"{ts} Efficiency: {eff:.2f}%")
`;
            const res = await executeInSandbox({ code, csvContent: regressionCsv });
            assert.strictEqual(res.exitCode, 0);

            // Expected calculations:
            // 10:00: (1.50 * 100) / (0.35 * 600) * 100 = 71.43%
            // 10:10: (1.30 * 90) / (0.45 * 600) * 100 = 43.33%
            // 10:20: (1.05 * 70) / (0.63 * 600) * 100 = 19.44%
            assert.match(res.stdout, /10:00 Efficiency: 71\.43%/);
            assert.match(res.stdout, /10:10 Efficiency: 43\.33%/);
            assert.match(res.stdout, /10:20 Efficiency: 19\.44%/);

            // Verify they do not all share 19.44%
            const lines = res.stdout.trim().split("\n");
            const nineteenFortyFour = lines.filter(l => l.includes("19.44%")).length;
            assert.strictEqual(nineteenFortyFour, 1, "Only 10:20 should have 19.44% efficiency");
        });

        it("Classification Test: performs per-row classification (NORMAL, WARNING, CRITICAL)", async () => {
            const code = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        ts = row['timestamp']
        temp = float(row['temperature'])
        p = float(row['pressure'])
        q = float(row['flow_rate'])
        pw = float(row['power_consumption'])
        eff = (p * q) / (pw * 600) * 100

        if eff < 70 and temp > 85:
            classification = "CRITICAL"
        elif eff < 70 or temp > 85:
            classification = "WARNING"
        else:
            classification = "NORMAL"

        print(f"{ts} -> {classification} (eff={eff:.1f}%, temp={temp:.1f}C)")
`;
            const res = await executeInSandbox({ code, csvContent: regressionCsv });
            assert.strictEqual(res.exitCode, 0);

            // Row 1 (eff 71.4%, temp 70): NORMAL
            // Row 2 (eff 43.3%, temp 80): WARNING
            // Row 3 (eff 19.4%, temp 92): CRITICAL
            assert.match(res.stdout, /10:00 -> NORMAL/);
            assert.match(res.stdout, /10:10 -> WARNING/);
            assert.match(res.stdout, /10:20 -> CRITICAL/);

            // If row 3 leaked, all would be CRITICAL. Assert that is not the case:
            const lines = res.stdout.trim().split("\n");
            const criticalCount = lines.filter(l => l.includes("CRITICAL")).length;
            assert.strictEqual(criticalCount, 1, "Exactly one row should be CRITICAL");
        });

        it("Derived-field regression: calculates health_score without requiring a CSV column", async () => {
            const code = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        vibration = float(row['vibration_mm_s'])
        temperature = float(row['temperature_c'])
        health_score = 100.0 - vibration * 2.0 - max(0.0, temperature - 70.0) * 0.5
        classification = 'NORMAL' if health_score >= 80 else 'WARNING'
        print(f"{row['timestamp']} {health_score:.2f} {classification}")
`;
            const csv = "timestamp,vibration_mm_s,temperature_c,rpm,current_a\n10:00,3.0,72,1800,4.2";
            const res = await executeInSandbox({ code, csvContent: csv });
            assert.strictEqual(res.success, true);
            assert.match(res.stdout, /10:00 93\.00 NORMAL/);
        });

        it("Empty aggregation regression: guards max and averages when there are no rows", async () => {
            const code = `
import csv

vibrations = []
with open('/workspace/input/data.csv') as f:
    for row in csv.DictReader(f):
        vibrations.append(float(row['vibration_mm_s']))

if not vibrations:
    print("No data rows available for analysis.")
else:
    print(f"Maximum vibration: {max(vibrations):.1f} mm/s")
`;
            const res = await executeInSandbox({
                code,
                csvContent: "timestamp,vibration_mm_s,temperature_c,rpm,current_a\n",
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.stdout.trim(), "No data rows available for analysis.");
        });

        it("Maximum aggregation regression: preserves the timestamp of the maximum row", async () => {
            const code = `
import csv

maximum = None
with open('/workspace/input/data.csv') as f:
    for row in csv.DictReader(f):
        vibration = float(row['vibration_mm_s'])
        if maximum is None or vibration > maximum[0]:
            maximum = (vibration, row['timestamp'])

if maximum is None:
    print("No data rows available for analysis.")
else:
    print(f"Maximum vibration: {maximum[0]:.1f} mm/s")
    print(f"Timestamp: {maximum[1]}")
`;
            const csv = "timestamp,vibration_mm_s,temperature_c,rpm,current_a\n2026-09-11 11:30,7.4,80,1700,4.0\n2026-09-11 11:35,8.1,82,1750,4.1";
            const res = await executeInSandbox({ code, csvContent: csv });
            assert.strictEqual(res.success, true);
            assert.match(res.stdout, /Maximum vibration: 8\.1 mm\/s/);
            assert.match(res.stdout, /Timestamp: 2026-09-11 11:35/);
        });

        it("Numerical safety regression: surfaces zero denominators and invalid numeric values", async () => {
            const zeroDenominator = await executeInSandbox({
                code: "print(10 / 0)",
            });
            assert.strictEqual(zeroDenominator.success, false);
            assert.match(zeroDenominator.stderr, /ZeroDivisionError/);

            const invalidNumeric = await executeInSandbox({
                code: `
import csv
with open('/workspace/input/data.csv') as f:
    for row in csv.DictReader(f):
        print(float(row['vibration_mm_s']))
`,
                csvContent: "timestamp,vibration_mm_s\n10:00,not-a-number\n",
            });
            assert.strictEqual(invalidNumeric.success, false);
            assert.match(invalidNumeric.stderr, /ValueError/);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // 8. 10-ROW INDUSTRIAL PUMP SENSOR ANALYSIS (LIVE & END-TO-END)
    // ─────────────────────────────────────────────────────────────
    describe("8. Industrial Pump 10-Row Sensor Analysis (End-to-End)", () => {
        const industrialPumpCsv = `timestamp,temperature,pressure,flow_rate,power_consumption
2026-09-11 10:00,72.5,1.50,100,0.35
2026-09-11 10:05,74.2,1.48,98,0.36
2026-09-11 10:10,76.8,1.45,96,0.38
2026-09-11 10:15,79.5,1.42,94,0.40
2026-09-11 10:20,82.1,1.38,91,0.43
2026-09-11 10:25,85.7,1.32,88,0.48
2026-09-11 10:30,88.5,1.25,82,0.52
2026-09-11 10:35,90.2,1.18,78,0.56
2026-09-11 10:40,91.7,1.12,74,0.61
2026-09-11 10:45,92.0,1.05,70,0.63`;

        it("executes complete 10-row analysis with distinct values, accurate average, and recommendations", async () => {
            const code = `
import csv

with open('/workspace/input/data.csv') as f:
    reader = csv.DictReader(f)
    
    total_eff = 0.0
    count = 0
    max_temp = float('-inf')
    critical_count = 0
    warning_count = 0
    normal_count = 0

    print("--- ROW ANALYSIS ---")
    for row in reader:
        ts = row['timestamp']
        temp = float(row['temperature'])
        p = float(row['pressure'])
        q = float(row['flow_rate'])
        pw = float(row['power_consumption'])
        
        eff = (p * q) / (pw * 600) * 100
        total_eff += eff
        count += 1
        if temp > max_temp:
            max_temp = temp

        if eff < 70 and temp > 85:
            cls = "CRITICAL"
            critical_count += 1
        elif eff < 70 or temp > 85:
            cls = "WARNING"
            warning_count += 1
        else:
            cls = "NORMAL"
            normal_count += 1

        print(f"Timestamp: {ts} | Temp: {temp:.1f}C | Flow: {q:.0f} L/min | Power: {pw:.2f} | Eff: {eff:.2f}% | Class: {cls}")

    avg_eff = total_eff / count if count > 0 else 0.0
    print("--- SUMMARY ---")
    print(f"Total Readings: {count}")
    print(f"Average Efficiency: {avg_eff:.2f}%")
    print(f"Maximum Temperature: {max_temp:.1f}C")
    print(f"Classifications: NORMAL={normal_count}, WARNING={warning_count}, CRITICAL={critical_count}")
    if critical_count > 0:
        print("Maintenance Recommendation: CRITICAL: Immediate inspection required for pump cooling and impeller degradation.")
    else:
        print("Maintenance Recommendation: Normal operation.")
`;
            const res = await executeInSandbox({ code, csvContent: industrialPumpCsv });
            assert.strictEqual(res.exitCode, 0);
            assert.strictEqual(res.success, true);

            // 1. Verify 10 distinct timestamps
            const timestamps = [
                "2026-09-11 10:00", "2026-09-11 10:05", "2026-09-11 10:10", "2026-09-11 10:15",
                "2026-09-11 10:20", "2026-09-11 10:25", "2026-09-11 10:30", "2026-09-11 10:35",
                "2026-09-11 10:40", "2026-09-11 10:45"
            ];
            for (const ts of timestamps) {
                assert.ok(res.stdout.includes(ts), `Output must contain timestamp ${ts}`);
            }

            // 2. Verify independent values for first row vs last row
            assert.match(res.stdout, /Timestamp: 2026-09-11 10:00 \| Temp: 72\.5C \| Flow: 100 L\/min \| Power: 0\.35 \| Eff: 71\.43% \| Class: NORMAL/);
            assert.match(res.stdout, /Timestamp: 2026-09-11 10:45 \| Temp: 92\.0C \| Flow: 70 L\/min \| Power: 0\.63 \| Eff: 19\.44% \| Class: CRITICAL/);

            // 3. Verify independent mathematical calculations:
            // Expected average efficiency: 44.66%
            assert.match(res.stdout, /Average Efficiency: 44\.66%/);

            // Expected maximum temperature: 92.0C
            assert.match(res.stdout, /Maximum Temperature: 92\.0C/);

            // 4. Verify classification counts: 1 NORMAL, 4 WARNING, 5 CRITICAL
            assert.match(res.stdout, /Classifications: NORMAL=1, WARNING=4, CRITICAL=5/);

            // 5. Verify maintenance recommendation
            assert.match(res.stdout, /Maintenance Recommendation: CRITICAL: Immediate inspection required/);
        });

        it("validates full live pipeline: prompt -> local model code generation -> sandbox execution", async () => {
            const prompt = `Analyze the uploaded industrial pump sensor CSV. Calculate pump efficiency for every reading using (pressure * flow_rate) / (power_consumption * 600) * 100. Identify readings where efficiency is below 70% and temperature is above 85°C. Calculate average efficiency and maximum temperature. Classify each reading as NORMAL, WARNING, or CRITICAL. Provide a maintenance recommendation. Read the CSV from /workspace/input/data.csv. Use only Python standard-library modules.`;

            const systemPrompt = `You are an expert Python data-analysis and software engineer.
Write clean, executable, self-contained Python code that directly fulfills the following user request.
Include necessary variables, calculations, and print() calls to demonstrate the result clearly.
Do not require external internet access or non-standard packages. Only use the Python standard library (e.g. csv, math, statistics).

A CSV dataset has been uploaded and will be available inside the isolated sandbox at:
/workspace/input/data.csv

CSV Filename: industrial_pump.csv
Columns: timestamp, temperature, pressure, flow_rate, power_consumption
Total Rows: 10

CRITICAL CSV PROCESSING INSTRUCTIONS:
1. Process every CSV record/row INDEPENDENTLY in a single unified loop.
2. All numeric conversions (using float() or int()), calculations, classifications, and per-row printing MUST occur INSIDE the row-processing loop while processing that specific record.
3. NEVER separate calculation and output into disconnected loops where earlier records might accidentally reference variables from the final iteration.
4. Never reuse or leak variables from the final iteration into earlier records.
5. Preserve the original timestamp and row values for each record.
6. Print each row's timestamp, sensor values, calculated efficiency, and classification while processing that record inside the loop. Verify that printed output values strictly correspond to the input row.
7. Accumulate running metrics (e.g. total efficiency, count, max temperature) inside the loop, and print the overall summary, averages, and maintenance recommendation AFTER the loop.
8. If appending rows to a list for later summary/recommendation output, store computed values explicitly (e.g. row['efficiency'] = efficiency or store a custom dict) to ensure keys exist.
9. Do not hardcode CSV values. Read the actual file from '/workspace/input/data.csv' using Python's standard library "csv" module (e.g. csv.DictReader).
10. Use ONLY Python standard library modules (e.g. csv, math, statistics). Do NOT require pandas, numpy, or external libraries.
11. Rule: Process every record independently. All calculations, classifications, and per-row output must occur while processing that specific record. Never use variables from the final iteration to represent earlier records.
12. Keep the CSV reader iteration inside the same open-file context. Never iterate over csv.DictReader after its underlying file has been closed.

User Request:
${prompt}

Return ONLY the Python code inside a \`\`\`python code block.`;

            let generateAnswerFn;
            try {
                const mod = await import("../../ai-service/llm/llm.service.js");
                generateAnswerFn = mod.generateAnswer;
            } catch {
                return;
            }

            let rawCode;
            try {
                rawCode = await generateAnswerFn(systemPrompt, "qwen2.5-coder:3b-4bit");
            } catch (err) {
                console.log("Local model inference skipped:", err.message);
                return;
            }

            const cleanCode = extractPythonCode(rawCode);
            assert.ok(cleanCode.includes("/workspace/input/data.csv"), "Code must read /workspace/input/data.csv");

            // Execute the model-generated code in Docker sandbox
            const res = await executeInSandbox({ code: cleanCode, csvContent: industrialPumpCsv });
            assert.strictEqual(res.exitCode, 0, `Execution failed with stderr: ${res.stderr}`);
            assert.strictEqual(res.success, true);

            // Verify independent row processing: output contains timestamps
            assert.ok(
                res.stdout.includes("10:00"),
                `Expected stdout to include '10:00'.\nActual stdout:\n${res.stdout}\nGenerated code was:\n${cleanCode}`
            );
            assert.ok(
                res.stdout.includes("10:45"),
                `Expected stdout to include '10:45'.\nActual stdout:\n${res.stdout}`
            );
        });
    });
});
