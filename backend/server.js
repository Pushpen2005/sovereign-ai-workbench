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
});