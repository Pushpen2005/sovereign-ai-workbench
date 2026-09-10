import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../ai-service/.env") });

import app from "./src/app.js";
import { initDb } from "./src/config/db.js";

const PORT = process.env.PORT || 9000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  try {
    await initDb();
    console.log("PostgreSQL database initialized successfully.");
  } catch (err) {
    console.error("PostgreSQL database initialization warning:", err.message);
  }

  // Non-blocking pre-warming of local LLM to eliminate ~4.5s cold-start penalty
  try {
    const { warmLocalModels } = await import("../ai-service/llm/llm.service.js");
    const defaultModel = process.env.DEFAULT_MODEL || "gemma-2-2b-it-4bit";
    warmLocalModels([defaultModel]).then((results) => {
      console.log(`[LLM-WARM] Pre-warming completed: ${JSON.stringify(results)}`);
    }).catch((err) => {
      console.warn(`[LLM-WARM] Pre-warming warning: ${err.message}`);
    });
  } catch {}
});