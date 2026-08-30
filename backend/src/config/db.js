import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5433", 10),
  user: process.env.POSTGRES_USER || "workbench",
  password: process.env.POSTGRES_PASSWORD || "workbench_secret",
  database: process.env.POSTGRES_DB || "workbench_db",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client:", err.message);
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (error) {
    console.error("Database query error:", {
      query: text,
      message: error.message,
      duration: `${Date.now() - start}ms`,
    });
    throw error;
  }
}

export async function checkDbConnection() {
  try {
    const res = await pool.query("SELECT NOW() as current_time");
    return {
      connected: true,
      time: res.rows[0]?.current_time,
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
}

export async function initDb() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR(255) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Processing',
      chunks_stored INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at DESC);
  `;

  try {
    await query(createTableQuery);
    console.log("✓ PostgreSQL documents table verified / initialized.");

    // Sync pre-existing Qdrant document if not present
    const existingDocCheck = await query(
      "SELECT id FROM documents WHERE id = $1",
      ["6216a2ec-9351-42ef-9ead-7cd2716b3397"]
    );
    if (existingDocCheck.rows.length === 0) {
      await query(
        `INSERT INTO documents (id, filename, original_filename, status, chunks_stored, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          "6216a2ec-9351-42ef-9ead-7cd2716b3397",
          "6216a2ec-9351-42ef-9ead-7cd2716b3397.pdf",
          "RIL-IAR-2025.pdf",
          "Indexed",
          1467,
        ]
      );
      console.log("✓ Synced existing pre-indexed RIL-IAR-2025.pdf document record into PostgreSQL.");
    }
  } catch (error) {
    console.error("Failed to initialize PostgreSQL schema:", error.message);
    throw error;
  }
}

export default pool;
