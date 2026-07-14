import { TaskEngine } from '../core/TaskEngine.js';
import { HeartbeatWorker } from '../core/HeartbeatWorker.js';
import { TaskStatus } from '../models/TaskStatus.js';
import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';

/**
 * BaseAgent
 * Abstract base class establishing the universal lifecycle, telemetry reporting,
 * and execution contract for all specialized Hermes V2 agent roles.
 * 
 * @abstract
 */
export class BaseAgent {
  /**
   * @param {object} options
   * @param {string} options.agentId - Unique node identifier
   * @param {string} options.role - Agent role ('builder', 'research', etc.)
   * @param {import('../repositories/TaskRepository.js').TaskRepository} options.taskRepository
   * @param {import('../repositories/AgentRepository.js').AgentRepository} options.agentRepository
   * @param {number} [options.heartbeatIntervalMs]
   */
  constructor({ agentId, role, taskRepository, agentRepository, heartbeatIntervalMs }) {
    if (this.constructor === BaseAgent) {
      throw new HermesError('BaseAgent is abstract and cannot be instantiated directly.', {
        code: 'ABSTRACT_CLASS_INSTANTIATION',
        category: 'system'
      });
    }

    this.agentId = agentId;
    this.role = role.toLowerCase();
    this.taskRepository = taskRepository;
    this.agentRepository = agentRepository;

    // 1. Initialize HeartbeatWorker for continuous node telemetry
    this.heartbeatWorker = new HeartbeatWorker(this.agentId, this.agentRepository, heartbeatIntervalMs);

    // 2. Initialize TaskEngine with binding to this agent's abstract executeTask implementation
    this.taskEngine = new TaskEngine({
      agentId: this.agentId,
      role: this.role,
      taskRepository: this.taskRepository,
      heartbeatWorker: this.heartbeatWorker,
      roleHandler: async (task, taskRepo) => {
        await this.executeTask(task, taskRepo);
      }
    });
  }

  /**
   * Abstract execution handler. Every specialized role class MUST implement this method.
   * @abstract
   * @param {object} task - Claimed task row from Supabase
   * @param {import('../repositories/TaskRepository.js').TaskRepository} taskRepo
   * @returns {Promise<void>}
   */
  async executeTask(task, taskRepo) {
    throw new HermesError(`executeTask(task, taskRepo) must be implemented by subclass ${this.constructor.name}`, {
      code: 'ABSTRACT_METHOD_NOT_IMPLEMENTED',
      category: 'system'
    });
  }

  /**
   * Helper to update the active task's lifecycle status cleanly.
   * @param {string} taskId
   * @param {string} status
   * @param {object} [extra={}]
   * @returns {Promise<object>}
   */
  async reportProgress(taskId, status, extra = {}) {
    logger.info(`[${this.agentId}] Task [${taskId}] progress transition -> ${status}`);
    return this.taskRepository.updateTaskStatus(taskId, status, extra);
  }

  /**
   * Helper to store structured deliverables/artifacts in task_outputs.
   * @param {string} taskId
   * @param {string} outputType - 'research_report' | 'code_diff' | 'test_results'
   * @param {object|string} content
   * @param {Array<string>} [artifacts=[]]
   * @returns {Promise<object>}
   */
  async saveDeliverable(taskId, outputType, content, artifacts = []) {
    return this.taskRepository.saveTaskOutput(taskId, this.agentId, outputType, content, artifacts);
  }

  /**
   * Starts the agent node: registers identity in Supabase, starts heartbeat, starts task engine.
   * @returns {Promise<void>}
   */
  async start() {
    logger.info(`Booting Hermes Agent Node: [${this.agentId}] (Role: ${this.role.toUpperCase()})`);

    // 1. Register with agent_registry
    await this.agentRepository.registerOrUpdateAgent(this.agentId, this.role, {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform
    });

    // 2. Start heartbeat worker
    this.heartbeatWorker.start();

    // 3. Start task engine listener
    this.taskEngine.start();

    logger.info(`Hermes Agent Node [${this.agentId}] booted and actively listening for tasks.`);
  }

  /**
   * Stops the agent node cleanly.
   * @returns {Promise<void>}
   */
  async stop() {
    logger.info(`Shutting down Hermes Agent Node: [${this.agentId}]...`);
    await this.taskEngine.stop();
    this.heartbeatWorker.stop();
    await this.agentRepository.updateStatus(this.agentId, 'offline', null).catch(() => {});
    logger.info(`Hermes Agent Node [${this.agentId}] shutdown complete.`);
  }
}
