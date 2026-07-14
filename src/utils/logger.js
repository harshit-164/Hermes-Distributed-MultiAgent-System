import winston from 'winston';
import { LogSeverity } from '../models/LogSeverity.js';

/**
 * Winston console formatting with colorized output for local debugging
 * and clean structured JSON output for production.
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, agentId, category, ...meta }) => {
    const agentTag = agentId ? `[${agentId}] ` : '';
    const catTag = category ? `[${category}] ` : '';
    const metaStr = Object.keys(meta).length > 0 ? `\nContext: ${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} ${level}: ${agentTag}${catTag}${message}${metaStr}`;
  })
);

/**
 * Core Winston logger instance.
 */
const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

/**
 * Structured Logger Wrapper
 * Supports dynamic injection of agentId and hooks for Supabase log persistence.
 */
export class Logger {
  /**
   * @param {object} [defaultContext={}] - Default metadata attached to all logs
   */
  constructor(defaultContext = {}) {
    this.defaultContext = defaultContext;
    this.supabaseSink = null; // Will be attached when LogService is initialized in Phase 7
  }

  /**
   * Sets the Supabase log sink function for remote audit logging.
   * @param {Function} sinkFn - Async function (logEntry) => Promise<void>
   */
  setSupabaseSink(sinkFn) {
    if (typeof sinkFn === 'function') {
      this.supabaseSink = sinkFn;
    }
  }

  /**
   * Internal logging dispatcher.
   * @private
   */
  async _log(severity, message, context = {}) {
    const mergedContext = { ...this.defaultContext, ...context };
    
    // Log via Winston to stdout
    winstonLogger.log({
      level: severity,
      message,
      ...mergedContext
    });

    // If Supabase sink is active and category/agent metadata exists, dispatch asynchronously
    if (this.supabaseSink && severity !== LogSeverity.DEBUG) {
      try {
        await this.supabaseSink({
          severity,
          message,
          timestamp: new Date().toISOString(),
          ...mergedContext
        });
      } catch (err) {
        winstonLogger.error('Failed to write log to Supabase sink', { error: err.message });
      }
    }
  }

  debug(message, context = {}) {
    return this._log(LogSeverity.DEBUG, message, context);
  }

  info(message, context = {}) {
    return this._log(LogSeverity.INFO, message, context);
  }

  warn(message, context = {}) {
    return this._log(LogSeverity.WARN, message, context);
  }

  error(message, context = {}) {
    return this._log(LogSeverity.ERROR, message, context);
  }

  fatal(message, context = {}) {
    return this._log(LogSeverity.FATAL, message, context);
  }
}

/**
 * Singleton default logger instance.
 */
export const logger = new Logger();
