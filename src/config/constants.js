/**
 * Centralized System Constants
 * Eliminates magic strings and numbers across Hermes V2 modules.
 */
export const Constants = Object.freeze({
  // Supabase Table Names
  TABLES: Object.freeze({
    TASKS: 'tasks',
    AGENT_REGISTRY: 'agent_registry',
    TASK_OUTPUTS: 'task_outputs',
    AGENT_HEARTBEATS: 'agent_heartbeats',
    SYSTEM_LOGS: 'system_logs'
  }),

  // Supabase Postgres Functions (RPC)
  RPC: Object.freeze({
    CLAIM_NEXT_TASK: 'claim_next_task'
  }),

  // Default Timeouts and Frequencies (in milliseconds)
  HEARTBEAT_INTERVAL_MS: 15000,          // Agents ping heartbeat every 15s
  HEARTBEAT_TIMEOUT_MS: 45000,           // Scheduler marks agent dead if no heartbeat for 45s
  TASK_POLL_INTERVAL_MS: 5000,           // Task engine polls every 5s if realtime event missed
  SCHEDULER_SWEEP_INTERVAL_MS: 30000,    // Scheduler sweeps stalled tasks every 30s
  DEFAULT_TASK_TIMEOUT_SECONDS: 3600,    // Default max execution time per task (1 hour)

  // Default Retries
  DEFAULT_MAX_RETRIES: 3,

  // Default Limits
  LOG_BATCH_SIZE: 50,
  MAX_ARTIFACT_URLS_PER_OUTPUT: 20
});
