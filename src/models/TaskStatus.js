/**
 * TaskStatus Enum
 * Defines the strict, immutable lifecycle states for every task in Hermes V2.
 */
export const TaskStatus = Object.freeze({
  PENDING: 'pending',
  CLAIMED: 'claimed',
  RESEARCHING: 'researching',
  RESEARCH_COMPLETED: 'research_completed',
  IMPLEMENTING: 'implementing',
  TESTING: 'testing',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

/**
 * Validates whether a string is a valid TaskStatus.
 * @param {string} status 
 * @returns {boolean}
 */
export function isValidTaskStatus(status) {
  return Object.values(TaskStatus).includes(status);
}
