/**
 * AgentRole Enum
 * Defines all supported active roles and planned future roles in Hermes V2.
 */
export const AgentRole = Object.freeze({
  BUILDER: 'builder',
  RESEARCH: 'research',
  QA: 'qa',
  DESIGNER: 'designer',
  VISION: 'vision',
  SECURITY: 'security',
  DEVOPS: 'devops',
  PLANNER: 'planner',
  ANALYTICS: 'analytics'
});

/**
 * Validates whether a string is a valid AgentRole.
 * @param {string} role 
 * @returns {boolean}
 */
export function isValidAgentRole(role) {
  return Object.values(AgentRole).includes(role.toLowerCase());
}
