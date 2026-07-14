/**
 * LogSeverity Enum
 * Defines standardized log levels across system output and Supabase audit logs.
 */
export const LogSeverity = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
});

/**
 * Validates whether a string is a valid LogSeverity.
 * @param {string} severity 
 * @returns {boolean}
 */
export function isValidLogSeverity(severity) {
  return Object.values(LogSeverity).includes(severity.toLowerCase());
}
