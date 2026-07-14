import { logger } from './logger.js';

/**
 * MetricsCollector
 * Tracks runtime metrics across the Hermes V2 distributed node:
 * task claims, completions, failures, retry frequencies, and API latencies.
 */
export class MetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.counters = {
      tasksClaimed: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      retryAttempts: 0,
      databaseErrors: 0,
      heartbeatsSent: 0
    };
    this.latencies = new Map();
  }

  /**
   * Increments a counter by given value.
   * @param {string} metricName
   * @param {number} [count=1]
   */
  increment(metricName, count = 1) {
    if (this.counters[metricName] !== undefined) {
      this.counters[metricName] += count;
    } else {
      this.counters[metricName] = count;
    }
  }

  /**
   * Records execution latency in milliseconds for an operation.
   * @param {string} operationName
   * @param {number} durationMs
   */
  recordLatency(operationName, durationMs) {
    if (!this.latencies.has(operationName)) {
      this.latencies.set(operationName, []);
    }
    const samples = this.latencies.get(operationName);
    samples.push(durationMs);
    if (samples.length > 100) {
      samples.shift(); // Keep last 100 samples in memory
    }
  }

  /**
   * Returns a snapshot of current metrics.
   * @returns {object}
   */
  getSnapshot() {
    const latencyAvgs = {};
    for (const [op, samples] of this.latencies.entries()) {
      if (samples.length > 0) {
        const sum = samples.reduce((acc, val) => acc + val, 0);
        latencyAvgs[op] = Math.round(sum / samples.length);
      }
    }

    return {
      counters: { ...this.counters },
      averageLatenciesMs: latencyAvgs,
      timestamp: new Date().toISOString()
    };
  }
}

export const metrics = new MetricsCollector();
