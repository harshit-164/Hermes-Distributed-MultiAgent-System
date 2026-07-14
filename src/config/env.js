import dotenv from 'dotenv';
import { z } from 'zod';
import { AgentRole } from '../models/AgentRole.js';
import { LogSeverity } from '../models/LogSeverity.js';
import { HermesError } from '../utils/HermesError.js';
import { Constants } from './constants.js';

// Load .env file if present
dotenv.config();

/**
 * Zod Schema for Environment Validation
 */
const envSchema = z.object({
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid HTTP/HTTPS URL').default('https://placeholder.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10, 'SUPABASE_SERVICE_ROLE_KEY must be provided').default('placeholder_secret_key'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional().default(''),
  AGENT_ID: z.string().min(1, 'AGENT_ID must be provided').default('agent-builder-01'),
  AGENT_ROLE: z.preprocess(
    val => typeof val === 'string' ? val.toLowerCase() : val,
    z.enum([...Object.values(AgentRole), 'both']).default(AgentRole.BUILDER)
  ),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().positive().default(Constants.HEARTBEAT_INTERVAL_MS),
  LOG_LEVEL: z.preprocess(
    val => typeof val === 'string' ? val.toLowerCase() : val,
    z.enum(Object.values(LogSeverity)).default(LogSeverity.INFO)
  ),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

/**
 * Validates process.env against the Zod schema and returns clean typed configuration.
 * Throws a structured HermesError if validation fails.
 * 
 * @param {object} [customEnv=process.env] - Optional override map for testing
 * @returns {z.infer<typeof envSchema>}
 */
export function validateAndLoadEnv(customEnv = process.env) {
  const envMap = { ...customEnv };

  // Check for command line flags overriding environment (e.g. --role=builder)
  if (typeof process !== 'undefined' && process.argv && customEnv === process.env) {
    for (const arg of process.argv) {
      if (arg.startsWith('--role=')) {
        envMap.AGENT_ROLE = arg.split('=')[1];
      } else if (arg.startsWith('--port=')) {
        envMap.PORT = arg.split('=')[1];
      } else if (arg.startsWith('--id=')) {
        envMap.AGENT_ID = arg.split('=')[1];
      }
    }
  }

  const result = envSchema.safeParse(envMap);

  if (!result.success) {
    const formattedErrors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
    throw new HermesError(`Environment validation failed: ${formattedErrors}`, {
      code: 'ENV_VALIDATION_ERROR',
      category: 'system',
      isRecoverable: false,
      metadata: { issues: result.error.errors }
    });
  }

  return Object.freeze(result.data);
}

export const validateEnv = validateAndLoadEnv;
export const env = new Proxy({}, {
  get(_target, prop) {
    const config = validateAndLoadEnv();
    return config[prop];
  }
});

