-- Migration: 001_agent_runs.sql
-- Description: Creates agent_runs and agent_run_steps tables for persistent LangGraph observability

-- UP Migration
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

-- DOWN Migration
-- DROP TABLE IF EXISTS agent_run_steps CASCADE;
-- DROP TABLE IF EXISTS agent_runs CASCADE;
