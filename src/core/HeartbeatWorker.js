import os from 'os';
import { Constants } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * HeartbeatWorker
 * Periodically emits telemetry ping to agent_heartbeats and agent_registry
 * to prove to the distributed OS that this agent node is alive and healthy.
 */
export class HeartbeatWorker {
  /**
   * @param {string} agentId - Unique identity of this node
   * @param {import('../repositories/AgentRepository.js').AgentRepository} agentRepository
   * @param {number} [intervalMs=Constants.HEARTBEAT_INTERVAL_MS] - Ping frequency
   */
  constructor(agentId, agentRepository, intervalMs = Constants.HEARTBEAT_INTERVAL_MS) {
    this.agentId = agentId;
    this.agentRepository = agentRepository;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.isRunning = false;
    this.currentStatus = 'online';
  }

  /**
   * Sets the reported status ('online', 'busy', 'error').
   * @param {string} status
   */
  setStatus(status) {
    this.currentStatus = status;
  }

  /**
   * Collects basic OS and memory metrics for telemetry.
   * @private
   */
  _collectTelemetry() {
    const memoryUsage = process.memoryUsage();
    const usedMb = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const totalMb = Math.round(os.totalmem() / 1024 / 1024);
    const memoryPercent = parseFloat(((usedMb / totalMb) * 100).toFixed(2));

    const loadAvg = os.loadavg();
    const cpuUsage = parseFloat(loadAvg[0].toFixed(2));

    return {
      cpuUsage,
      memoryUsage: memoryPercent,
      activeThreads: 1,
      status: this.currentStatus
    };
  }

  /**
   * Executes a single heartbeat cycle.
   * @returns {Promise<void>}
   */
  async pingOnce() {
    try {
      const telemetry = this._collectTelemetry();
      await this.agentRepository.recordHeartbeat(this.agentId, telemetry);
      logger.debug(`Heartbeat ping sent for agent [${this.agentId}] (${this.currentStatus})`);
    } catch (error) {
      logger.warn(`Heartbeat ping failed for agent [${this.agentId}]: ${error.message}`);
    }
  }

  /**
   * Starts the periodic heartbeat worker loop.
   */
  start() {
    if (this.isRunning) {
      logger.warn(`HeartbeatWorker already running for agent [${this.agentId}]`);
      return;
    }

    this.isRunning = true;
    logger.info(`Starting HeartbeatWorker for agent [${this.agentId}] at interval ${this.intervalMs}ms`);

    // Perform an immediate initial ping
    this.pingOnce();

    this.timer = setInterval(() => {
      this.pingOnce();
    }, this.intervalMs);

    // Ensure timer doesn't block Node process shutdown if nothing else is running
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the heartbeat worker loop cleanly.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info(`HeartbeatWorker stopped for agent [${this.agentId}]`);
  }
}
