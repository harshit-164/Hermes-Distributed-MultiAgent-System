import { Constants } from '../config/constants.js';
import { TaskStatus } from '../models/TaskStatus.js';
import { logger } from '../utils/logger.js';

/**
 * SchedulerSweep
 * Background recovery service that scans for crashed agent nodes and stalled tasks.
 * Automatically releases locked tasks back to 'pending' with incremented retry counts.
 */
export class SchedulerSweep {
  /**
   * @param {import('../repositories/TaskRepository.js').TaskRepository} taskRepository
   * @param {import('../repositories/AgentRepository.js').AgentRepository} agentRepository
   * @param {number} [intervalMs=Constants.SCHEDULER_SWEEP_INTERVAL_MS]
   */
  constructor(taskRepository, agentRepository, intervalMs = Constants.SCHEDULER_SWEEP_INTERVAL_MS) {
    this.taskRepository = taskRepository;
    this.agentRepository = agentRepository;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.isRunning = false;
  }

  /**
   * Sweeps and recovers tasks assigned to dead agents whose heartbeats expired.
   * @returns {Promise<number>} Number of tasks recovered
   */
  async recoverDeadAgents() {
    let recoveredCount = 0;
    try {
      const deadAgents = await this.agentRepository.findDeadAgents(Constants.HEARTBEAT_TIMEOUT_MS);
      if (!deadAgents || deadAgents.length === 0) {
        return 0;
      }

      for (const agent of deadAgents) {
        logger.warn(`[SchedulerSweep] Detected dead/unresponsive agent [${agent.agent_id}] (role: ${agent.role}). Releasing tasks...`);

        // Mark dead agent as offline in registry
        await this.agentRepository.updateStatus(agent.agent_id, 'offline', null);

        // If dead agent was assigned to a task, release it back to pending
        if (agent.current_task_id) {
          try {
            const task = await this.taskRepository.getTaskById(agent.current_task_id);
            if (task && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.FAILED) {
              const newRetryCount = (task.retry_count || 0) + 1;
              const nextStatus = newRetryCount >= task.max_retries ? TaskStatus.FAILED : TaskStatus.PENDING;

              await this.taskRepository.updateTaskStatus(task.id, nextStatus, {
                current_owner: null,
                retry_count: newRetryCount,
                metadata: {
                  ...task.metadata,
                  last_recovery_reason: `Agent [${agent.agent_id}] heartbeat timed out`
                }
              });

              logger.warn(`[SchedulerSweep] Task [${task.id}] ("${task.title}") recovered from dead agent [${agent.agent_id}] -> ${nextStatus} (attempt ${newRetryCount}/${task.max_retries})`);
              recoveredCount++;
            }
          } catch (err) {
            logger.error(`[SchedulerSweep] Failed to recover task [${agent.current_task_id}] from dead agent [${agent.agent_id}]: ${err.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`[SchedulerSweep] Error during dead agents recovery sweep: ${error.message}`);
    }
    return recoveredCount;
  }

  /**
   * Sweeps and recovers tasks that exceeded their timeout_seconds during active execution.
   * @returns {Promise<number>} Number of timed-out tasks recovered
   */
  async recoverTimedOutTasks() {
    let recoveredCount = 0;
    try {
      const stalledTasks = await this.taskRepository.findTimedOutTasks();
      if (!stalledTasks || stalledTasks.length === 0) {
        return 0;
      }

      for (const task of stalledTasks) {
        logger.warn(`[SchedulerSweep] Detected execution timeout on task [${task.id}] ("${task.title}") held by agent [${task.current_owner || 'none'}]`);

        const newRetryCount = (task.retry_count || 0) + 1;
        const nextStatus = newRetryCount >= task.max_retries ? TaskStatus.FAILED : TaskStatus.PENDING;

        await this.taskRepository.updateTaskStatus(task.id, nextStatus, {
          current_owner: null,
          retry_count: newRetryCount,
          metadata: {
            ...task.metadata,
            last_recovery_reason: `Task execution exceeded max timeout (${task.timeout_seconds}s)`
          }
        });

        if (task.current_owner) {
          // Reset status of the owner agent back to online or error
          try {
            await this.agentRepository.updateStatus(task.current_owner, 'online', null);
          } catch (err) {
            logger.debug(`Failed to reset owner status during task timeout recovery: ${err.message}`);
          }
        }

        logger.warn(`[SchedulerSweep] Timed-out task [${task.id}] transitioned -> ${nextStatus} (attempt ${newRetryCount}/${task.max_retries})`);
        recoveredCount++;
      }
    } catch (error) {
      logger.error(`[SchedulerSweep] Error during timed-out tasks recovery sweep: ${error.message}`);
    }
    return recoveredCount;
  }

  /**
   * Runs a complete recovery sweep.
   */
  async sweepOnce() {
    const deadRecovered = await this.recoverDeadAgents();
    const timeoutRecovered = await this.recoverTimedOutTasks();
    if (deadRecovered > 0 || timeoutRecovered > 0) {
      logger.info(`[SchedulerSweep] Recovery cycle finished: ${deadRecovered} dead agent tasks, ${timeoutRecovered} timed-out tasks recovered.`);
    }
  }

  /**
   * Starts the periodic scheduler sweep worker.
   */
  start() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    logger.info(`Starting SchedulerSweep service at interval ${this.intervalMs}ms`);

    this.timer = setInterval(() => {
      this.sweepOnce();
    }, this.intervalMs);

    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the periodic scheduler sweep cleanly.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('SchedulerSweep service stopped.');
  }
}
