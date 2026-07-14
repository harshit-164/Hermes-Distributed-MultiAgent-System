import { Constants } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * LogRepository
 * Manages remote audit persistence to the system_logs table in Supabase.
 */
export class LogRepository {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this.supabase = supabase;
    this.table = Constants.TABLES.SYSTEM_LOGS;
  }

  /**
   * Writes a log entry into the system_logs table.
   * Designed to be non-blocking and fail-safe so logging errors never crash business logic.
   * 
   * @param {object} logEntry
   * @param {string} logEntry.severity - 'debug' | 'info' | 'warn' | 'error' | 'fatal'
   * @param {string} logEntry.message
   * @param {string} [logEntry.agentId]
   * @param {string} [logEntry.taskId]
   * @param {string} [logEntry.category='system']
   * @param {object} [logEntry.context={}]
   * @returns {Promise<void>}
   */
  async writeLog(logEntry) {
    try {
      const payload = {
        timestamp: logEntry.timestamp || new Date().toISOString(),
        agent_id: logEntry.agentId || null,
        task_id: logEntry.taskId || null,
        severity: logEntry.severity || 'info',
        category: logEntry.category || 'system',
        message: logEntry.message,
        context: logEntry.context || {}
      };

      const { error } = await this.supabase
        .from(this.table)
        .insert(payload);

      if (error) {
        // Log to console only without throwing to prevent infinite retry loop
        console.error(`[LogRepository] Failed to write log to Supabase sink: ${error.message}`);
      }
    } catch (err) {
      console.error(`[LogRepository] Exception writing remote log: ${err.message}`);
    }
  }

  /**
   * Retrieves recent audit logs for monitoring and diagnosis.
   * @param {object} [filters={}] - limit, severity, agentId, taskId
   * @returns {Promise<Array<object>>}
   */
  async getRecentLogs(filters = {}) {
    const limit = filters.limit || Constants.LOG_BATCH_SIZE;
    let query = this.supabase
      .from(this.table)
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (filters.severity) {
      query = query.eq('severity', filters.severity);
    }
    if (filters.agentId) {
      query = query.eq('agent_id', filters.agentId);
    }
    if (filters.taskId) {
      query = query.eq('task_id', filters.taskId);
    }

    const { data, error } = await query;
    if (error) {
      logger.error(`Failed to fetch recent logs from Supabase: ${error.message}`);
      return [];
    }

    return data || [];
  }
}
