/**
 * HermesError
 * Custom structured error class for comprehensive error tracking, categorization,
 * and automated retry decision logic across Hermes V2.
 */
export class HermesError extends Error {
  /**
   * @param {string} message - Human readable error message
   * @param {object} options - Error context options
   * @param {string} [options.code='INTERNAL_ERROR'] - Error code identifier
   * @param {string} [options.category='system'] - Category: 'database' | 'task_engine' | 'telegram' | 'browser' | 'llm' | 'system'
   * @param {boolean} [options.isRecoverable=false] - Whether the operation can be retried safely
   * @param {object} [options.metadata={}] - Additional context payloads
   * @param {Error} [options.cause] - Underlying root cause error
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'HermesError';
    this.code = options.code || 'INTERNAL_ERROR';
    this.category = options.category || 'system';
    this.isRecoverable = Boolean(options.isRecoverable);
    this.metadata = options.metadata || {};
    if (options.cause) {
      this.cause = options.cause;
    }
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serializes error to a clean JSON object for Supabase storage or API responses.
   * @returns {object}
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      isRecoverable: this.isRecoverable,
      metadata: this.metadata,
      stack: this.stack,
      cause: this.cause ? (this.cause.message || String(this.cause)) : null
    };
  }
}
