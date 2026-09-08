import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });
dotenv.config({ path: path.resolve(__dirname, "../../ai-service/.env"), override: true });
if (process.env.OLLAMA_URL && process.env.OLLAMA_URL.includes("host.docker.internal")) {
  process.env.OLLAMA_URL = process.env.OLLAMA_URL.replace("host.docker.internal", "127.0.0.1");
}

import app from "../src/app.js";
import { initDb, query } from "../src/config/db.js";
import { generateToken } from "../src/utils/auth.js";
import {
  classifyTask,
  routeTask,
  checkModelAvailability,
  getAvailableModels,
  getRouterDiagnostic,
  getModelRegistry,
  isModelAllowed,
  RouterError,
  TASK_TYPE,
  toCanonicalTaskType,
} from "../../ai-service/router/modelRouter.js";
import { answerQuestion } from "../../ai-service/rag/rag.service.js";
import { executeInSandbox } from "../src/services/sandbox.service.js";

async function runPhase9Tests() {
  console.log("==================================================");
  console.log("   SOVEREIGNAI — PHASE 9: LOCAL MODEL ROUTER      ");
  console.log("   TASK CLASSIFIER + MODEL SELECTION + REGRESSION ");
  console.log("==================================================\n");

  await initDb();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedCount = 0;
  let failedCount = 0;

  function record(testName, condition, detail = "") {
    if (condition) {
      console.log(`  ✓ PASS ${testName}`);
      passedCount++;
    } else {
      console.error(`  ✗ FAIL ${testName}${detail ? " : " + detail : ""}`);
      failedCount++;
    }
  }

  const testOrgId = `org_p9_${Date.now()}`;
  await query("INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())", [
    testOrgId,
    `Org Phase9 ${testOrgId}`,
  ]);

  const authToken = generateToken({
    userId: `user_${testOrgId}`,
    organizationId: testOrgId,
    email: "router_engineer@example.com",
    role: "admin",
  });

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST 1: DOCUMENT Classification
    // ─────────────────────────────────────────────────────────────
    console.log("[Test 1] Deterministic DOCUMENT task classification...");
    const docQuery1 = "What does the Maintenance SOP say about bearing temperature?";
    const tDoc1 = classifyTask(docQuery1);
    const cDoc1 = toCanonicalTaskType(tDoc1);

    const docQuery2 = "Analyze this inspection report.";
    const tDoc2 = classifyTask(docQuery2);
    const cDoc2 = toCanonicalTaskType(tDoc2);

    const docQuery3 = "According to the safety manual, what is the PPE requirement?";
    const tDoc3 = classifyTask(docQuery3);
    const cDoc3 = toCanonicalTaskType(tDoc3);

    const passDoc =
      (tDoc1 === TASK_TYPE.DOCUMENT || tDoc1 === TASK_TYPE.DOCUMENT_ANALYSIS) &&
      cDoc1 === "DOCUMENT" &&
      cDoc2 === "DOCUMENT" &&
      cDoc3 === "DOCUMENT";
    record("[Test 1] DOCUMENT Classification", passDoc, `tDoc1=${tDoc1}, cDoc1=${cDoc1}, cDoc2=${cDoc2}, cDoc3=${cDoc3}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: CODING Classification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 2] Deterministic CODING task classification...");
    const codeQuery1 = "Write Python code to calculate pump efficiency.";
    const tCode1 = classifyTask(codeQuery1);

    const codeQuery2 = "Create a JavaScript function for sorting data.";
    const tCode2 = classifyTask(codeQuery2);

    const codeQuery3 = "Write SQL query to count open maintenance tickets.";
    const tCode3 = classifyTask(codeQuery3);

    const passCode =
      tCode1 === TASK_TYPE.CODING &&
      tCode2 === TASK_TYPE.CODING &&
      tCode3 === TASK_TYPE.CODING &&
      toCanonicalTaskType(tCode1) === "CODING" &&
      toCanonicalTaskType(tCode2) === "CODING";
    record("[Test 2] CODING Classification", passCode, `tCode1=${tCode1}, tCode2=${tCode2}, tCode3=${tCode3}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: GENERAL Classification
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 3] Deterministic GENERAL task classification...");
    const genQuery1 = "Explain what a centrifugal pump is.";
    const tGen1 = classifyTask(genQuery1);

    const genQuery2 = "What are the common causes of industrial vibration?";
    const tGen2 = classifyTask(genQuery2);

    const passGen =
      (tGen1 === TASK_TYPE.GENERAL || tGen1 === TASK_TYPE.GENERAL_CHAT) &&
      toCanonicalTaskType(tGen1) === "GENERAL" &&
      (tGen2 === TASK_TYPE.GENERAL || tGen2 === TASK_TYPE.GENERAL_CHAT) &&
      toCanonicalTaskType(tGen2) === "GENERAL";
    record("[Test 3] GENERAL Classification", passGen, `tGen1=${tGen1}, tGen2=${tGen2}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Model Selection
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 4] Model selection for DOCUMENT, CODING, and GENERAL...");
    const rDoc = await routeTask("What does the Maintenance SOP say about bearing temperature?");
    const rCode = await routeTask("Write Python code to calculate pump efficiency.");
    const rGen = await routeTask("Explain what a centrifugal pump is.");

    const registry = getModelRegistry();
    const passSelection =
      rDoc.selectedModel === registry[TASK_TYPE.DOCUMENT_ANALYSIS] &&
      rDoc.model === rDoc.selectedModel &&
      rCode.selectedModel === registry[TASK_TYPE.CODING] &&
      rCode.model === rCode.selectedModel &&
      rGen.selectedModel === registry[TASK_TYPE.GENERAL_CHAT] &&
      rGen.model === rGen.selectedModel;
    record(
      "[Test 4] Model Selection",
      passSelection,
      `docModel=${rDoc.model}, codeModel=${rCode.model}, genModel=${rGen.model}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Local-Only Routing
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 5] Local-only routing verification (zero external inference)...");
    const passLocal =
      rDoc.local === true &&
      rCode.local === true &&
      rGen.local === true &&
      !rDoc.selectedModel.includes("gpt") &&
      !rCode.selectedModel.includes("claude");
    record("[Test 5] Local-Only Routing", passLocal, `rDoc.local=${rDoc.local}, rCode.local=${rCode.local}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Model Availability & Fallback Handling
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 6] Model availability and fallback verification...");
    const isLlamaAvailable = await checkModelAvailability("llama3.2:3b");
    const isMoondreamAvailable = await checkModelAvailability("moondream:latest");
    const isFakeAvailable = await checkModelAvailability("nonexistent-cloud-model:99b");

    // Test fallback when coding model uninstalled and fallback=true
    const origCodingModel = process.env.CODING_MODEL;
    const origFallback = process.env.CODING_MODEL_FALLBACK;
    let fallbackWorked = false;
    let strictFailureWorked = false;

    try {
      process.env.CODING_MODEL = "uninstalled-coding-model:7b";
      process.env.CODING_MODEL_FALLBACK = "true";
      const fbRoute = await routeTask("Write Python code to sort numbers");
      fallbackWorked = fbRoute.isFallback === true && fbRoute.selectedModel === registry.defaultModel;

      process.env.CODING_MODEL_FALLBACK = "false";
      try {
        await routeTask("Write Python code to sort numbers");
      } catch (err) {
        strictFailureWorked = err instanceof RouterError && err.code === "MODEL_UNAVAILABLE";
      }
    } finally {
      process.env.CODING_MODEL = origCodingModel || "llama3.2:3b";
      process.env.CODING_MODEL_FALLBACK = origFallback || "true";
    }

    const passAvailability =
      isLlamaAvailable === true &&
      isMoondreamAvailable === true &&
      isFakeAvailable === false &&
      fallbackWorked === true &&
      strictFailureWorked === true;
    record(
      "[Test 6] Model Availability & Fallback",
      passAvailability,
      `llama=${isLlamaAvailable}, fake=${isFakeAvailable}, fallback=${fallbackWorked}, strictFail=${strictFailureWorked}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Invalid Task Type Handling
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 7] Invalid task type rejection boundary...");
    let invalidTaskRejected = false;
    try {
      await routeTask({ taskType: "NON_EXISTENT_TASK_TYPE", request: "Test request" });
    } catch (err) {
      invalidTaskRejected = err instanceof RouterError && err.code === "INVALID_TASK_TYPE";
    }
    record("[Test 7] Invalid Task Type Handling", invalidTaskRejected, `rejected=${invalidTaskRejected}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Router Observability & Security Scrubbing
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 8] Router observability metadata verification...");
    const observed = await routeTask("What does the Maintenance SOP say about bearing temperature?", {
      context: { documentId: "doc-123" },
    });

    const hasObservability =
      typeof observed.taskType === "string" &&
      typeof observed.canonicalTaskType === "string" &&
      typeof observed.model === "string" &&
      typeof observed.selectedModel === "string" &&
      observed.local === true &&
      typeof observed.reason === "string" &&
      typeof observed.latencyMs === "number" &&
      observed.latencyMs >= 0;

    // Verify no secrets/tokens leaked in reason or return object
    const serialized = JSON.stringify(observed);
    const noSecretLeaked =
      !serialized.includes("password") &&
      !serialized.includes("jwt") &&
      !serialized.includes("secret") &&
      !serialized.includes("Bearer");

    record("[Test 8] Router Observability", hasObservability && noSecretLeaked, `hasObs=${hasObservability}, noSecrets=${noSecretLeaked}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Document Task -> Existing RAG Pipeline
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 9] Document task routing into existing RAG service...");
    const ragQuery = "What is the normal operating limit for bearing temperature?";
    const ragRouting = await routeTask(ragQuery);
    assert.ok(
      ragRouting.taskType === TASK_TYPE.DOCUMENT ||
      ragRouting.taskType === TASK_TYPE.DOCUMENT_ANALYSIS ||
      ragRouting.canonicalTaskType === "DOCUMENT",
      "Task must route to document analysis"
    );

    // Execute through existing RAG service using the routed model
    const ragAnswer = await answerQuestion(ragQuery, {
      organizationId: "ad51f0f1-bca5-4076-8b8f-a8a64faecd76",
      model: ragRouting.selectedModel,
    });

    const passRag =
      typeof ragAnswer.answer === "string" &&
      ragAnswer.answer.length > 0 &&
      ragAnswer.grounded === true;
    record("[Test 9] Document Task -> RAG Pipeline", passRag, `answerLength=${ragAnswer.answer?.length}, grounded=${ragAnswer.grounded}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Document Task -> Inspection Agent Integration
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 10] Inspection workflow routing and model capability...");
    const inspRouting = await routeTask("Analyze this inspection report and identify findings", {
      workflow: "inspection",
    });

    const passInsp =
      (inspRouting.taskType === TASK_TYPE.INSPECTION || inspRouting.canonicalTaskType === "DOCUMENT") &&
      inspRouting.local === true &&
      typeof inspRouting.selectedModel === "string";
    record("[Test 10] Document Task -> Inspection Agent", passInsp, `taskType=${inspRouting.taskType}, model=${inspRouting.selectedModel}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 11: Coding Task -> Docker Coding Sandbox Execution
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 11] Coding task routing into isolated Docker Sandbox execution...");
    const codingQuery = "Write Python code to calculate pump efficiency.";
    const codingRouting = await routeTask(codingQuery);
    assert.equal(codingRouting.taskType, TASK_TYPE.CODING, "Task must route to CODING");

    // Execute isolated Python calculation in Docker sandbox with --network none
    const testCode = `
def pump_efficiency(head_m, flow_m3h, power_kw):
    # Hydraulic power (kW) = (flow * head * 9.81 * 1000) / (3600 * 1000)
    p_hyd = (flow_m3h * head_m * 9.81) / 3600
    eff = (p_hyd / power_kw) * 100
    return round(eff, 2)

eff = pump_efficiency(head_m=45, flow_m3h=120, power_kw=20)
print(f"EFFICIENCY={eff}%")
`;

    const sandboxResult = await executeInSandbox({
      code: testCode,
      language: "python",
      timeoutMs: 5000,
    });

    const passSandbox =
      sandboxResult.success === true &&
      sandboxResult.exitCode === 0 &&
      sandboxResult.stdout.includes("EFFICIENCY=") &&
      sandboxResult.sandbox?.network === "none" &&
      sandboxResult.sandbox?.isolated === true;
    record(
      "[Test 11] Coding Task -> Docker Sandbox",
      passSandbox,
      `success=${sandboxResult.success}, exitCode=${sandboxResult.exitCode}, network=${sandboxResult.sandbox?.network}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 12: Tenant Security Preservation in Router API
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 12] Tenant security and authentication boundary on POST /api/v1/router/route...");
    // 1. Unauthenticated request must fail with 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/router/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "Hello world" }),
    });
    assert.equal(unauthRes.status, 401, "Unauthenticated request must be rejected with 401");

    // 2. Authenticated request must succeed
    const authRes = await fetch(`${baseUrl}/api/v1/router/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ request: "What does the SOP say about valve settings?" }),
    });
    assert.equal(authRes.status, 200, "Authenticated request must succeed with 200");
    const authJson = await authRes.json();
    const passAuth = authJson.success === true && authJson.local === true;
    record("[Test 12] Tenant Security Preservation", passAuth, `unauth=401, auth=200, local=${authJson.local}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 13: External Cloud API Prohibition
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 13] Strict external cloud API prohibition (allowlist security)...");
    const cloudModels = [
      "gpt-4o",
      "gpt-4-turbo",
      "claude-3-5-sonnet",
      "claude-3-haiku",
      "gemini-1.5-pro",
      "text-embedding-ada-002",
      "azure-openai-deployment",
    ];

    let allCloudRejected = true;
    for (const cm of cloudModels) {
      if (isModelAllowed(cm) !== false) {
        allCloudRejected = false;
        break;
      }
    }

    // Verify routeTask explicitly throws MODEL_NOT_ALLOWED
    let routeBlockedCloud = false;
    try {
      await routeTask("Write code", { model: "gpt-4o" });
    } catch (err) {
      routeBlockedCloud = err instanceof RouterError && err.code === "MODEL_NOT_ALLOWED";
    }

    const passCloudProhibition = allCloudRejected === true && routeBlockedCloud === true;
    record(
      "[Test 13] External Cloud API Prohibition",
      passCloudProhibition,
      `allCloudRejected=${allCloudRejected}, routeBlockedCloud=${routeBlockedCloud}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 14: Zero Unnecessary Duplicate LLM Inference
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 14] Classification latency & zero redundant LLM calls...");
    const sampleQueries = [
      "What does the Maintenance SOP say about bearing temperature?",
      "Write Python code to calculate pump efficiency.",
      "Explain what a centrifugal pump is.",
      "Analyze this inspection report.",
      "Create a JavaScript function for sorting data.",
    ];

    const tStart = Date.now();
    for (let i = 0; i < 100; i++) {
      const q = sampleQueries[i % sampleQueries.length];
      classifyTask(q);
    }
    const elapsedMs = Date.now() - tStart;
    const avgLatencyMs = elapsedMs / 100;

    // Deterministic string keyword classifier should execute in < 0.2ms per call
    const passLatency = avgLatencyMs < 1.0;
    record(
      "[Test 14] Zero Redundant LLM Inference",
      passLatency,
      `100 classifications in ${elapsedMs} ms (avg ${avgLatencyMs.toFixed(3)} ms/call)`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 15: Frontend Routing State & Manifest
    // ─────────────────────────────────────────────────────────────
    console.log("\n[Test 15] Frontend routing state verification via GET /api/v1/router/models...");
    const modelsRes = await fetch(`${baseUrl}/api/v1/router/models`);
    assert.equal(modelsRes.status, 200, "GET /api/v1/router/models must return 200");
    const modelsJson = await modelsRes.json();

    const passManifest =
      modelsJson.registry &&
      modelsJson.registry.DOCUMENT &&
      modelsJson.registry.CODING &&
      modelsJson.registry.GENERAL &&
      modelsJson.diagnostic &&
      modelsJson.diagnostic.zeroCloudDependencies === true &&
      modelsJson.diagnostic.localOllamaExecution === true &&
      modelsJson.diagnostic.externalApiKeysCount === 0;

    record("[Test 15] Frontend Routing State & Manifest", passManifest, `zeroCloud=${modelsJson.diagnostic?.zeroCloudDependencies}`);
  } catch (err) {
    console.error("  ✗ UNHANDLED TEST ERROR:", err);
    failedCount++;
  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPhase9Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  });
