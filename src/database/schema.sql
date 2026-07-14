-- ============================================================================
-- HERMES V2 DISTRIBUTED MULTI-AGENT OPERATING SYSTEM - DATABASE SCHEMA
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. AGENT REGISTRY TABLE
-- Tracks active, offline, and errored agents across the distributed OS.
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'offline', -- 'online', 'busy', 'offline', 'error'
    current_task_id UUID,                          -- Nullable FK added after tasks table created
    metadata JSONB DEFAULT '{}'::jsonb,            -- Capabilities, OS version, node specs
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_role_status ON agent_registry(role, status);
CREATE INDEX IF NOT EXISTS idx_agent_registry_last_heartbeat ON agent_registry(last_heartbeat);

-- ============================================================================
-- 2. TASKS TABLE
-- The core job queue. Every assignment lives here and transitions strictly.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    required_role VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'claimed', 'researching', etc.
    priority INT NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    current_owner VARCHAR(100) REFERENCES agent_registry(agent_id) ON DELETE SET NULL,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    timeout_seconds INT NOT NULL DEFAULT 3600,
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,            -- Target URL, git branch, input payloads
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_registry 
    ADD CONSTRAINT fk_agent_current_task 
    FOREIGN KEY (current_task_id) REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_required_role_status ON tasks(required_role, status);
CREATE INDEX IF NOT EXISTS idx_tasks_current_owner ON tasks(current_owner);

-- ============================================================================
-- 3. TASK OUTPUTS TABLE
-- Stores intermediate and final artifacts/deliverables from completed tasks.
-- ============================================================================
CREATE TABLE IF NOT EXISTS task_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id VARCHAR(100) NOT NULL REFERENCES agent_registry(agent_id) ON DELETE CASCADE,
    output_type VARCHAR(50) NOT NULL,              -- 'research_report', 'code_diff', 'test_results', 'error_dump'
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    artifacts JSONB DEFAULT '[]'::jsonb,           -- Array of file URLs or paths
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_outputs_task_id ON task_outputs(task_id);

-- ============================================================================
-- 4. AGENT HEARTBEATS TABLE
-- High-frequency telemetry log used for crash detection and performance metrics.
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_heartbeats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(100) NOT NULL REFERENCES agent_registry(agent_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    cpu_usage FLOAT DEFAULT 0.0,
    memory_usage FLOAT DEFAULT 0.0,
    active_threads INT DEFAULT 1,
    status VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_agent_timestamp ON agent_heartbeats(agent_id, timestamp DESC);

-- ============================================================================
-- 5. SYSTEM LOGS TABLE
-- Centralized audit trail for all distributed logs across agents and services.
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    agent_id VARCHAR(100),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',  -- 'debug', 'info', 'warn', 'error', 'fatal'
    category VARCHAR(50) NOT NULL DEFAULT 'system',-- 'task_engine', 'database', 'telegram', etc.
    message TEXT NOT NULL,
    context JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp_severity ON system_logs(timestamp DESC, severity);
CREATE INDEX IF NOT EXISTS idx_system_logs_agent_id ON system_logs(agent_id);

-- ============================================================================
-- 6. AUTOMATIC UPDATED_AT TRIGGER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_timestamp_agent_registry
BEFORE UPDATE ON agent_registry
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

CREATE OR REPLACE TRIGGER set_timestamp_tasks
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();

-- ============================================================================
-- 7. ATOMIC TASK CLAIMING FUNCTION (RPC)
-- Uses Postgres row-level locking (FOR UPDATE SKIP LOCKED) to guarantee that
-- multiple agents claiming simultaneously never collide on the same task.
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_next_task(
    p_agent_id VARCHAR(100),
    p_role VARCHAR(50)
)
RETURNS TABLE (
    id UUID,
    title VARCHAR(255),
    description TEXT,
    required_role VARCHAR(50),
    status VARCHAR(50),
    priority INT,
    retry_count INT,
    max_retries INT,
    timeout_seconds INT,
    metadata JSONB
) AS $$
DECLARE
    v_task_id UUID;
BEGIN
    -- 1. Find and lock the highest priority pending task matching the agent's role
    SELECT t.id INTO v_task_id
    FROM tasks t
    WHERE t.status = 'pending'
      AND t.required_role = p_role
      AND t.retry_count < t.max_retries
    ORDER BY t.priority DESC, t.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    -- If no task is available, return empty result
    IF v_task_id IS NULL THEN
        RETURN;
    END IF;

    -- 2. Atomically transition the task to 'claimed' and assign to the agent
    UPDATE tasks t
    SET status = 'claimed',
        current_owner = p_agent_id,
        claimed_at = NOW(),
        started_at = NOW(),
        updated_at = NOW()
    WHERE t.id = v_task_id;

    -- 3. Update the agent registry status
    UPDATE agent_registry
    SET status = 'busy',
        current_task_id = v_task_id,
        last_heartbeat = NOW(),
        updated_at = NOW()
    WHERE agent_id = p_agent_id;

    -- 4. Return the claimed task data to the calling client
    RETURN QUERY
    SELECT t.id, t.title, t.description, t.required_role, t.status, t.priority, t.retry_count, t.max_retries, t.timeout_seconds, t.metadata
    FROM tasks t
    WHERE t.id = v_task_id;
END;
$$ LANGUAGE plpgsql;
