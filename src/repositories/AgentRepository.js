import { Constants } from '../config/constants.js';
import { HermesError } from '../utils/HermesError.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * AgentRepository
 * Implements data access over Supabase for agent_registry and agent_heartbeats tables.
 */
export class AgentRepository {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this.supabase = supabase;
    this.table = Constants.TABLES.AGENT_REGISTRY;
    this.heartbeatsTable = Constants.TABLES.AGENT_HEARTBEATS;
  }

  /**
   * Registers a new agent or updates an existing agent's online status and metadata.
   * @param {string} agentId
   * @param {string} role
   * @param {object} [metadata={}]
   * @returns {Promise<object>}
   */
  async registerOrUpdateAgent(agentId, role, metadata = {}) {
    return withRetry(async () => {
      const payload = {
        agent_id: agentId,
        role: role.toLowerCase(),
        status: 'online',
        metadata,
        last_heartbeat: new Date().toISOString()
      };

      // Upsert into agent_registry by unique agent_id
      const { data, error } = await this.supabase
        .from(this.table)
        .upsert(payload, { onConflict: 'agent_id' })
        .select()
        .single();

      if (error) {
        throw new HermesError(`Failed to register/update agent [${agentId}]: ${error.message}`, {
          code: 'AGENT_REGISTER_ERROR',
          category: 'database',
          isRecoverable: true,
          metadata: { agentId, role, error }
        });
      }

      logger.info(`Agent [${agentId}] (${role}) registered successfully in Supabase registry.`);
      return data;
    }, { operationName: 'registerOrUpdateAgent' });
  }

  /**
   * Records a high-frequency telemetry heartbeat entry and updates last_heartbeat timestamp.
   * @param {string} agentId
   * @param {object} [telemetry={}] - cpu_usage, memory_usage, active_threads, status
   * @returns {Promise<void>}
   */
  async recordHeartbeat(agentId, telemetry = {}) {
    return withRetry(async () => {
      const timestamp = new Date().toISOString();
      const status = telemetry.status || 'online';

      // 1. Insert detailed telemetry row into agent_heartbeats
      const { error: hbError } = await this.supabase
        .from(this.heartbeatsTable)
        .insert({
          agent_id: agentId,
          timestamp,
          cpu_usage: telemetry.cpuUsage || 0.0,
          memory_usage: telemetry.memoryUsage || 0.0,
          active_threads: telemetry.activeThreads || 1,
          status
        });

      if (hbError) {
        logger.warn(`Failed to insert telemetry row into agent_heartbeats: ${hbError.message}`);
      }

      // 2. Update last_heartbeat on agent_registry
      const { error: regError } = await this.supabase
        .from(this.table)
        .update({ last_heartbeat: timestamp, status })
        .eq('agent_id', agentId);

      if (regError) {
        throw new HermesError(`Failed to update last_heartbeat for agent [${agentId}]: ${regError.message}`, {
          code: 'HEARTBEAT_UPDATE_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }
    }, { operationName: 'recordHeartbeat', maxRetries: 2 });
  }

  /**
   * Updates an agent's status (e.g., 'busy', 'online', 'offline', 'error').
   * @param {string} agentId
   * @param {string} status
   * @param {string|null} [currentTaskId=undefined]
   * @returns {Promise<object>}
   */
  async updateStatus(agentId, status, currentTaskId = undefined) {
    return withRetry(async () => {
      const payload = { status, last_heartbeat: new Date().toISOString() };
      if (currentTaskId !== undefined) {
        payload.current_task_id = currentTaskId;
      }

      const { data, error } = await this.supabase
        .from(this.table)
        .update(payload)
        .eq('agent_id', agentId)
        .select()
        .single();

      if (error) {
        throw new HermesError(`Failed to update status for agent [${agentId}]: ${error.message}`, {
          code: 'AGENT_STATUS_UPDATE_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }

      return data;
    }, { operationName: 'updateAgentStatus' });
  }

  /**
   * Finds agents whose last_heartbeat is older than the timeout threshold.
   * Used by SchedulerSweep to detect crashed or disconnected nodes.
   * @param {number} [timeoutMs=Constants.HEARTBEAT_TIMEOUT_MS]
   * @returns {Promise<Array<object>>}
   */
  async findDeadAgents(timeoutMs = Constants.HEARTBEAT_TIMEOUT_MS) {
    return withRetry(async () => {
      const thresholdDate = new Date(Date.now() - timeoutMs).toISOString();

      const { data, error } = await this.supabase
        .from(this.table)
        .select('*')
        .in('status', ['online', 'busy'])
        .lt('last_heartbeat', thresholdDate);

      if (error) {
        throw new HermesError(`Failed to query dead agents: ${error.message}`, {
          code: 'DEAD_AGENT_QUERY_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }

      return data || [];
    }, { operationName: 'findDeadAgents' });
  }

  /**
   * Retrieves an agent registry entry by agentId.
   * @param {string} agentId
   * @returns {Promise<object|null>}
   */
  async getAgentById(agentId) {
    return withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('*')
        .eq('agent_id', agentId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new HermesError(`Failed to fetch agent [${agentId}]: ${error.message}`, {
          code: 'AGENT_FETCH_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }

      return data || null;
    }, { operationName: 'getAgentById' });
  }
}
