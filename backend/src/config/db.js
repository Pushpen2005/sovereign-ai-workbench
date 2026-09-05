import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_ORGANIZATION_NAME,
} from "./organization.js";

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
  const createSchemaQuery = `
    CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_name_lower ON organizations (lower(name));

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id),
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR(255) PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id),
      filename VARCHAR(255) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Processing',
      chunks_stored INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_organization_id ON documents (organization_id);
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(50) DEFAULT 'pdf-text';

    CREATE TABLE IF NOT EXISTS reports (
      id VARCHAR(255) PRIMARY KEY,
      document_id VARCHAR(255) REFERENCES documents(id) ON DELETE SET NULL,
      organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id),
      title VARCHAR(255) NOT NULL DEFAULT 'Approval Note',
      filename VARCHAR(255) NOT NULL,
      risk_level VARCHAR(50),
      status VARCHAR(50) NOT NULL DEFAULT 'GENERATED',
      task TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_organization_id ON reports (organization_id);
    CREATE INDEX IF NOT EXISTS idx_reports_document_id ON reports (document_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id VARCHAR(255) PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id),
      title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_organization_id ON conversations (organization_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(255) PRIMARY KEY,
      conversation_id VARCHAR(255) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      sources JSONB DEFAULT '[]'::jsonb,
      document_id VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at ASC);

    CREATE TABLE IF NOT EXISTS agent_runs (
      id VARCHAR(255) PRIMARY KEY,
      run_id VARCHAR(255) UNIQUE NOT NULL,
      user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
      organization_id VARCHAR(255) NOT NULL REFERENCES organizations(id),
      goal TEXT NOT NULL,
      model VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      stopped_reason VARCHAR(50),
      total_steps INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      final_answer TEXT,
      error TEXT,
      started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_run_id ON agent_runs (run_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_organization_id ON agent_runs (organization_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id ON agent_runs (user_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_org_created_at ON agent_runs (organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id VARCHAR(255) PRIMARY KEY,
      run_id VARCHAR(255) NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      node VARCHAR(100) NOT NULL,
      action VARCHAR(50),
      tool_name VARCHAR(100),
      tool_arguments JSONB,
      tool_result_summary TEXT,
      status VARCHAR(50),
      duration_ms INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id ON agent_run_steps (run_id);
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_step ON agent_run_steps (run_id, step_number ASC);
  `;

  try {
    await query(createSchemaQuery);
    console.log("✓ PostgreSQL schema verified / initialized.");

    // Ensure default organization exists
    await query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_ORGANIZATION_ID, DEFAULT_ORGANIZATION_NAME]
    );

    // Ensure default demo user exists for SIH evaluation
    const demoEmail = (process.env.DEMO_USER_EMAIL || "engineer@example.com").toLowerCase();
    const demoPassword = process.env.DEMO_USER_PASSWORD || "DemoPassword123!";
    const demoUserCheck = await query(
      "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)",
      [demoEmail]
    );

    if (demoUserCheck.rows.length === 0) {
      const demoHash = bcrypt.hashSync(demoPassword, 10);
      await query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          "53ee9e5e-bf00-46ce-9621-f979148f36f7",
          DEFAULT_ORGANIZATION_ID,
          "Demo Engineer",
          demoEmail,
          demoHash,
          "admin",
        ]
      );
      console.log(`✓ Seeded default demo user: ${demoEmail}`);
    } else {
      const existingUser = demoUserCheck.rows[0];
      if (existingUser.password_hash.startsWith("scrypt$")) {
        const demoHash = bcrypt.hashSync(demoPassword, 10);
        await query(
          "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [demoHash, existingUser.id]
        );
        console.log(`✓ Updated demo user password hash for ${demoEmail}`);
      }
    }

    // Sync pre-existing Qdrant document if not present
    const existingDocCheck = await query(
      "SELECT id FROM documents WHERE id = $1",
      ["6216a2ec-9351-42ef-9ead-7cd2716b3397"]
    );
    if (existingDocCheck.rows.length === 0) {
      await query(
        `INSERT INTO documents (id, organization_id, filename, original_filename, status, chunks_stored, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          "6216a2ec-9351-42ef-9ead-7cd2716b3397",
          DEFAULT_ORGANIZATION_ID,
          "6216a2ec-9351-42ef-9ead-7cd2716b3397.pdf",
          "RIL-IAR-2025.pdf",
          "Indexed",
          1467,
        ]
      );
      console.log("✓ Synced existing pre-indexed RIL-IAR-2025.pdf document record into PostgreSQL.");
    }

    // Safely backfill organizationId in Qdrant for pre-indexed demo data points
    try {
      const { backfillDemoDocumentPoints } = await import("../../../ai-service/vectorstore/qdrant.service.js");
      const demoUserOrgRes = await query("SELECT organization_id FROM users WHERE lower(email) = lower($1)", [demoEmail]);
      const demoOrgTarget = demoUserOrgRes.rows[0]?.organization_id || DEFAULT_ORGANIZATION_ID;

      await backfillDemoDocumentPoints("6216a2ec-9351-42ef-9ead-7cd2716b3397", DEFAULT_ORGANIZATION_ID);
      await backfillDemoDocumentPoints("31bc6f43-a5fb-47b7-9bee-5bc9deb0a2b1", demoOrgTarget);
      await backfillDemoDocumentPoints("9ab8aa75-de69-40a3-a5cf-7690eca964bb", demoOrgTarget);
      await backfillDemoDocumentPoints("73311980-8338-4833-8e2e-246aa107a1eb", demoOrgTarget);
    } catch {
      // Non-blocking if Qdrant is unreachable during offline DB init
    }

    // Tenant filesystem migration: safely move known files into tenant-scoped directories
    try {
      const { migrateKnownStorageFiles } = await import("../utils/storage.js");
      await migrateKnownStorageFiles(query);
    } catch (migErr) {
      console.warn("[initDb] Filesystem migration notice:", migErr.message);
    }
  } catch (error) {
    console.error("Failed to initialize PostgreSQL schema:", error.message);
    throw error;
  }
}

export default pool;
