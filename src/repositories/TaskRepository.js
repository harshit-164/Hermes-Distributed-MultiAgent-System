import { Constants } from '../config/constants.js';
import { TaskStatus } from '../models/TaskStatus.js';
import { HermesError } from '../utils/HermesError.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

/**
 * TaskRepository
 * Implements the Repository Pattern for tasks and task_outputs tables over Supabase.
 * Encapsulates all SQL queries, RPC calls, and error handling.
 */
export class TaskRepository {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    this.supabase = supabase;
    this.table = Constants.TABLES.TASKS;
    this.outputsTable = Constants.TABLES.TASK_OUTPUTS;
  }

  /**
   * Atomically claims the highest priority pending task for the given agent role.
   * Uses the `claim_next_task` Postgres RPC (`FOR UPDATE SKIP LOCKED`).
   * 
   * @param {string} agentId - Unique ID of the claiming agent
   * @param {string} role - Role required ('builder' or 'research')
   * @returns {Promise<object|null>} The claimed task object, or null if no tasks pending
   */
  async claimNextTask(agentId, role) {
    return withRetry(async () => {
      const { data, error } = await this.supabase.rpc(Constants.RPC.CLAIM_NEXT_TASK, {
        p_agent_id: agentId,
        p_role: role
      });

      if (error) {
        throw new HermesError(`Failed to atomically claim task: ${error.message}`, {
          code: 'TASK_CLAIM_RPC_ERROR',
          category: 'database',
          isRecoverable: true,
          metadata: { agentId, role, error }
        });
      }

      // Supabase RPC returns array of rows from RETURN QUERY
      if (!data || data.length === 0) {
        return null;
      }

      const claimedTask = data[0];
      logger.info(`Atomically claimed task [${claimedTask.id}]: "${claimedTask.title}"`, {
        taskId: claimedTask.id,
        agentId,
        role
      });

      return claimedTask;
    }, { operationName: 'claimNextTask' });
  }

  /**
   * Creates a new task in the queue.
   * @param {object} taskData
   * @returns {Promise<object>}
   */
  async createTask(taskData) {
    return withRetry(async () => {
      const payload = {
        title: taskData.title,
        description: taskData.description,
        required_role: taskData.requiredRole || taskData.required_role,
        status: TaskStatus.PENDING,
        priority: taskData.priority !== undefined ? taskData.priority : 5,
        parent_task_id: taskData.parentTaskId || taskData.parent_task_id || null,
        timeout_seconds: taskData.timeoutSeconds || Constants.DEFAULT_TASK_TIMEOUT_SECONDS,
        metadata: taskData.metadata || {}
      };

      const { data, error } = await this.supabase
        .from(this.table)
        .insert(payload)
        .select()
        .single();

      if (error) {
        throw new HermesError(`Failed to create task: ${error.message}`, {
          code: 'TASK_CREATE_ERROR',
          category: 'database',
          isRecoverable: true,
          metadata: { payload, error }
        });
      }

      logger.info(`Created task [${data.id}] (${data.required_role}): "${data.title}"`, {
        taskId: data.id
      });
      return data;
    }, { operationName: 'createTask' });
  }

  /**
   * Updates the lifecycle status of a task.
   * @param {string} taskId
   * @param {string} newStatus
   * @param {object} [additionalFields={}] - Optional fields like completed_at, retry_count
   * @returns {Promise<object>}
   */
  async updateTaskStatus(taskId, newStatus, additionalFields = {}) {
    return withRetry(async () => {
      const payload = {
        status: newStatus,
        ...additionalFields
      };

      if (newStatus === TaskStatus.COMPLETED || newStatus === TaskStatus.FAILED) {
        payload.completed_at = new Date().toISOString();
      }

      const { data, error } = await this.supabase
        .from(this.table)
        .update(payload)
        .eq('id', taskId)
        .select()
        .single();

      if (error) {
        throw new HermesError(`Failed to update task [${taskId}] status to [${newStatus}]: ${error.message}`, {
          code: 'TASK_STATUS_UPDATE_ERROR',
          category: 'database',
          isRecoverable: true,
          metadata: { taskId, newStatus, additionalFields, error }
        });
      }

      logger.info(`Task [${taskId}] transitioned to status [${newStatus}]`, {
        taskId,
        status: newStatus
      });
      return data;
    }, { operationName: 'updateTaskStatus' });
  }

  /**
   * Saves intermediate or final outputs/artifacts for a task.
   * @param {string} taskId
   * @param {string} agentId
   * @param {string} outputType - 'research_report' | 'code_diff' | 'test_results' | 'error_dump'
   * @param {object|string} content
   * @param {Array<string>} [artifacts=[]]
   * @returns {Promise<object>}
   */
  async saveTaskOutput(taskId, agentId, outputType, content, artifacts = []) {
    return withRetry(async () => {
      const payload = {
        task_id: taskId,
        agent_id: agentId,
        output_type: outputType,
        content: typeof content === 'string' ? { text: content } : content,
        artifacts: Array.isArray(artifacts) ? artifacts : []
      };

      const { data, error } = await this.supabase
        .from(this.outputsTable)
        .insert(payload)
        .select()
        .single();

      if (error) {
        throw new HermesError(`Failed to save task output for task [${taskId}]: ${error.message}`, {
          code: 'TASK_OUTPUT_SAVE_ERROR',
          category: 'database',
          isRecoverable: true,
          metadata: { taskId, agentId, outputType, error }
        });
      }

      logger.info(`Saved task output [${data.id}] (${outputType}) for task [${taskId}]`, {
        taskId,
        outputId: data.id
      });
      return data;
    }, { operationName: 'saveTaskOutput' });
  }

  /**
   * Finds tasks that have been in active/running states longer than their timeout_seconds.
   * Used by SchedulerSweep for crash and timeout recovery.
   * @returns {Promise<Array<object>>}
   */
  async findTimedOutTasks() {
    return withRetry(async () => {
      const activeStatuses = [
        TaskStatus.CLAIMED,
        TaskStatus.RESEARCHING,
        TaskStatus.RESEARCH_COMPLETED,
        TaskStatus.IMPLEMENTING,
        TaskStatus.TESTING
      ];

      // Fetch active tasks to check start times against timeout_seconds
      const { data, error } = await this.supabase
        .from(this.table)
        .select('*')
        .in('status', activeStatuses);

      if (error) {
        throw new HermesError(`Failed to query timed-out tasks: ${error.message}`, {
          code: 'TASK_QUERY_TIMEOUT_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }

      const now = Date.now();
      const stalledTasks = (data || []).filter(task => {
        if (!task.started_at && !task.claimed_at) return false;
        const startTimestamp = new Date(task.started_at || task.claimed_at).getTime();
        const elapsedSeconds = (now - startTimestamp) / 1000;
        return elapsedSeconds >= (task.timeout_seconds || Constants.DEFAULT_TASK_TIMEOUT_SECONDS);
      });

      return stalledTasks;
    }, { operationName: 'findTimedOutTasks' });
  }

  /**
   * Retrieves a task by ID.
   * @param {string} taskId
   * @returns {Promise<object|null>}
   */
  async getTaskById(taskId) {
    return withRetry(async () => {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('*')
        .eq('id', taskId)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is Row not found
        throw new HermesError(`Failed to fetch task [${taskId}]: ${error.message}`, {
          code: 'TASK_FETCH_ERROR',
          category: 'database',
          isRecoverable: true
        });
      }

      return data || null;
    }, { operationName: 'getTaskById' });
  }
}
