import { Constants } from '../config/constants.js';
import { TaskStatus } from '../models/TaskStatus.js';
import { logger } from '../utils/logger.js';
import { realtimeManager } from '../database/realtime.js';
import { HermesError } from '../utils/HermesError.js';

/**
 * TaskEngine
 * Orchestrates event-driven and polling-based task discovery, atomic claiming,
 * execution delegation to specialized role handlers, and lifecycle status management.
 */
export class TaskEngine {
  /**
   * @param {object} options
   * @param {string} options.agentId
   * @param {string} options.role - 'builder' | 'research'
   * @param {import('../repositories/TaskRepository.js').TaskRepository} options.taskRepository
   * @param {import('./HeartbeatWorker.js').HeartbeatWorker} [options.heartbeatWorker]
   * @param {Function} options.roleHandler - Async function (task, taskRepo) => Promise<void>
   * @param {number} [options.pollIntervalMs=Constants.TASK_POLL_INTERVAL_MS]
   */
  constructor({
    agentId,
    role,
    taskRepository,
    heartbeatWorker = null,
    roleHandler,
    pollIntervalMs = Constants.TASK_POLL_INTERVAL_MS
  }) {
    this.agentId = agentId;
    this.role = role.toLowerCase();
    this.taskRepository = taskRepository;
    this.heartbeatWorker = heartbeatWorker;
    this.roleHandler = roleHandler;
    this.pollIntervalMs = pollIntervalMs;

    this.isRunning = false;
    this.isBusy = false;
    this.pollTimer = null;
    this.channelName = `task-engine-${this.role}-${this.agentId}`;
  }

  /**
   * Attempts to claim and execute the next available pending task.
   * Ensures high concurrency safety and prevents double-execution on the same node.
   * @returns {Promise<boolean>} True if a task was claimed and processed, false otherwise
   */
  async processNext() {
    if (!this.isRunning || this.isBusy) {
      return false;
    }

    try {
      this.isBusy = true;
      if (this.heartbeatWorker) {
        this.heartbeatWorker.setStatus('busy');
      }

      // 1. Atomically claim task matching this agent's role from Postgres queue
      const task = await this.taskRepository.claimNextTask(this.agentId, this.role);
      if (!task) {
        this.isBusy = false;
        if (this.heartbeatWorker) {
          this.heartbeatWorker.setStatus('online');
        }
        return false;
      }

      logger.info(`[TaskEngine] Starting execution for Task [${task.id}]: "${task.title}"`, {
        taskId: task.id,
        role: this.role
      });

      // 2. Delegate to role execution handler inside try/catch block
      try {
        if (typeof this.roleHandler !== 'function') {
          throw new HermesError(`No valid roleHandler registered for role [${this.role}]`, {
            code: 'MISSING_ROLE_HANDLER',
            category: 'task_engine',
            isRecoverable: false
          });
        }

        await this.roleHandler(task, this.taskRepository);

        // If the role handler hasn't already marked the task completed/failed, transition it
        const checkTask = await this.taskRepository.getTaskById(task.id);
        if (checkTask && checkTask.status === TaskStatus.CLAIMED) {
          await this.taskRepository.updateTaskStatus(task.id, TaskStatus.COMPLETED);
        }

        logger.info(`[TaskEngine] Successfully finished Task [${task.id}]: "${task.title}"`);
      } catch (execError) {
        logger.error(`[TaskEngine] Execution failed on Task [${task.id}]: ${execError.message}`, {
          error: execError.message,
          stack: execError.stack
        });

        // Save error dump into task_outputs for audit and debugging
        await this.taskRepository.saveTaskOutput(task.id, this.agentId, 'error_dump', {
          error: execError.message,
          stack: execError.stack,
          timestamp: new Date().toISOString()
        }).catch(e => logger.warn(`Failed to save error_dump output: ${e.message}`));

        // Transition task based on retry count
        const currentTask = await this.taskRepository.getTaskById(task.id);
        const retryCount = (currentTask ? currentTask.retry_count : task.retry_count) || 0;
        const maxRetries = (currentTask ? currentTask.max_retries : task.max_retries) || Constants.DEFAULT_MAX_RETRIES;

        if (execError instanceof HermesError && !execError.isRecoverable) {
          await this.taskRepository.updateTaskStatus(task.id, TaskStatus.FAILED, {
            current_owner: null,
            metadata: { ...task.metadata, fatal_error: execError.message }
          });
        } else if (retryCount + 1 < maxRetries) {
          await this.taskRepository.updateTaskStatus(task.id, TaskStatus.PENDING, {
            current_owner: null,
            retry_count: retryCount + 1,
            metadata: { ...task.metadata, last_error: execError.message }
          });
          logger.warn(`[TaskEngine] Task [${task.id}] released for retry (${retryCount + 1}/${maxRetries})`);
        } else {
          await this.taskRepository.updateTaskStatus(task.id, TaskStatus.FAILED, {
            current_owner: null,
            retry_count: retryCount + 1,
            metadata: { ...task.metadata, fatal_error: execError.message }
          });
          logger.error(`[TaskEngine] Task [${task.id}] permanently FAILED after ${retryCount + 1} attempts`);
        }
      }
    } catch (error) {
      logger.error(`[TaskEngine] Unexpected error during processNext cycle: ${error.message}`);
    } finally {
      this.isBusy = false;
      if (this.heartbeatWorker) {
        this.heartbeatWorker.setStatus('online');
      }
    }

    return true;
  }

  /**
   * Starts the event-driven Realtime subscription and backup polling loop.
   */
  start() {
    if (this.isRunning) {
      logger.warn(`TaskEngine [${this.agentId}] is already running.`);
      return;
    }

    this.isRunning = true;
    logger.info(`Starting TaskEngine for agent [${this.agentId}] (${this.role.toUpperCase()})`);

    // 1. Subscribe to Realtime notifications for immediate wake-up
    realtimeManager.subscribeToTasks(
      this.channelName,
      (newTask) => {
        if (newTask && newTask.status === TaskStatus.PENDING && newTask.required_role === this.role) {
          logger.debug(`[TaskEngine] Realtime INSERT event triggered wake-up for task [${newTask.id}]`);
          this.processNext();
        }
      },
      (updatedTask) => {
        if (updatedTask && updatedTask.status === TaskStatus.PENDING && updatedTask.required_role === this.role) {
          logger.debug(`[TaskEngine] Realtime UPDATE event triggered wake-up for task [${updatedTask.id}]`);
          this.processNext();
        }
      }
    );

    // 2. Perform initial process check immediately
    this.processNext();

    // 3. Start safety polling timer to prevent dropped websocket packets
    this.pollTimer = setInterval(() => {
      if (!this.isBusy) {
        this.processNext();
      }
    }, this.pollIntervalMs);

    if (this.pollTimer && typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  /**
   * Stops the TaskEngine cleanly and removes Realtime subscriptions.
   */
  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    await realtimeManager.unsubscribe(this.channelName);
    logger.info(`TaskEngine stopped cleanly for agent [${this.agentId}]`);
  }
}
