import { logger } from './logger.js';
import { HermesError } from './HermesError.js';

/**
 * Suspends execution for the given duration.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff retry wrapper (`withRetry`) with jitter.
 * Automatically retries async functions on transient errors.
 * 
 * @template T
 * @param {Function} asyncFn - Async function returning Promise<T>
 * @param {object} [options={}] - Retry options
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number} [options.baseDelayMs=1000] - Initial delay in milliseconds
 * @param {number} [options.maxDelayMs=15000] - Maximum delay in milliseconds
 * @param {string} [options.operationName='operation'] - Label for log messages
 * @param {Function} [options.shouldRetry] - Custom predicate function (error) => boolean
 * @returns {Promise<T>}
 */
export async function withRetry(asyncFn, options = {}) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
  const baseDelayMs = options.baseDelayMs !== undefined ? options.baseDelayMs : 1000;
  const maxDelayMs = options.maxDelayMs !== undefined ? options.maxDelayMs : 15000;
  const operationName = options.operationName || 'operation';
  const shouldRetry = options.shouldRetry || ((err) => {
    // If it's a HermesError and explicitly marked non-recoverable, don't retry
    if (err instanceof HermesError && !err.isRecoverable) {
      return false;
    }
    return true;
  });

  let attempt = 0;
  while (true) {
    try {
      return await asyncFn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        logger.warn(`Max retries (${maxRetries}) exceeded or non-recoverable error for [${operationName}]. Throwing.`, {
          error: error.message,
          attempt
        });
        throw error;
      }

      // Calculate exponential backoff with full jitter to prevent thundering herd
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const boundedDelay = Math.min(exponentialDelay, maxDelayMs);
      const jitter = Math.random() * 0.3 * boundedDelay;
      const delayMs = Math.floor(boundedDelay + jitter);

      logger.warn(`[${operationName}] failed (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`, {
        error: error.message
      });

      await sleep(delayMs);
    }
  }
}
