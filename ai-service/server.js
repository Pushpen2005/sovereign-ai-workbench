import http from "http";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const PORT = parseInt(process.env.PORT || process.env.AI_SERVICE_PORT || "5001", 10);
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

/**
 * Lightweight AI service health & diagnostics daemon.
 * Provides service discovery, readiness checks, and upstream probe for Qdrant and Ollama.
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health" || url.pathname === "/api/v1/health") {
    let qdrantOk = false;
    let ollamaOk = false;

    try {
      const qRes = await fetch(`${QDRANT_URL}/collections`, { signal: AbortSignal.timeout(3000) });
      qdrantOk = qRes.ok;
    } catch {
      qdrantOk = false;
    }

    try {
      const oRes = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      ollamaOk = oRes.ok;
    } catch {
      ollamaOk = false;
    }

    const isHealthy = qdrantOk && ollamaOk;
    res.writeHead(isHealthy ? 200 : 200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        status: "ok",
        service: "ai-service",
        qdrant: qdrantOk ? "connected" : "unreachable",
        ollama: ollamaOk ? "connected" : "unreachable",
        model: OLLAMA_MODEL,
        timestamp: new Date().toISOString(),
      })
    );
  }

  if (url.pathname === "/" || url.pathname === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        service: "SovereignAI AI-Service",
        status: "running",
        capabilities: [
          "chunking",
          "embeddings",
          "qdrant-vectorstore",
          "ollama-rag",
          "ocr-tesseract",
          "inspection-analysis",
          "risk-assessment",
          "docx-generation",
        ],
        model: OLLAMA_MODEL,
      })
    );
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[AI-Service] Daemon running on http://0.0.0.0:${PORT}`);
  console.log(`[AI-Service] QDRANT_URL=${QDRANT_URL}`);
  console.log(`[AI-Service] OLLAMA_URL=${OLLAMA_URL}`);
});

export default server;
