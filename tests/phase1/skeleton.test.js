import { describe, it, expect, beforeEach } from 'vitest';
import { TaskStatus, isValidTaskStatus } from '../../src/models/TaskStatus.js';
import { AgentRole, isValidAgentRole } from '../../src/models/AgentRole.js';
import { LogSeverity, isValidLogSeverity } from '../../src/models/LogSeverity.js';
import { HermesError } from '../../src/utils/HermesError.js';
import { withRetry } from '../../src/utils/retry.js';
import { Container } from '../../src/core/Container.js';
import { validateAndLoadEnv } from '../../src/config/env.js';
import { Constants } from '../../src/config/constants.js';

describe('Phase 1: Domain Models & Enums', () => {
  it('should enforce TaskStatus immutability and validity', () => {
    expect(Object.isFrozen(TaskStatus)).toBe(true);
    expect(isValidTaskStatus('pending')).toBe(true);
    expect(isValidTaskStatus('invalid_status')).toBe(false);
  });

  it('should enforce AgentRole immutability and validity', () => {
    expect(Object.isFrozen(AgentRole)).toBe(true);
    expect(isValidAgentRole('builder')).toBe(true);
    expect(isValidAgentRole('qa')).toBe(true);
    expect(isValidAgentRole('hacker')).toBe(false);
  });

  it('should enforce LogSeverity validity', () => {
    expect(isValidLogSeverity('error')).toBe(true);
    expect(isValidLogSeverity('trace')).toBe(false);
  });
});

describe('Phase 1: Custom Error Handling', () => {
  it('should create and serialize a structured HermesError', () => {
    const error = new HermesError('Database timeout', {
      code: 'DB_TIMEOUT',
      category: 'database',
      isRecoverable: true,
      metadata: { query: 'SELECT * FROM tasks' }
    });

    expect(error.name).toBe('HermesError');
    expect(error.code).toBe('DB_TIMEOUT');
    expect(error.category).toBe('database');
    expect(error.isRecoverable).toBe(true);

    const json = error.toJSON();
    expect(json.message).toBe('Database timeout');
    expect(json.metadata.query).toBe('SELECT * FROM tasks');
  });
});

describe('Phase 1: Exponential Backoff Retry Utility', () => {
  it('should retry transient errors and succeed', async () => {
    let attempts = 0;
    const asyncFn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new HermesError('Transient error', { isRecoverable: true });
      }
      return 'success';
    };

    const result = await withRetry(asyncFn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should immediately fail without retrying if error is non-recoverable', async () => {
    let attempts = 0;
    const asyncFn = async () => {
      attempts++;
      throw new HermesError('Fatal auth error', { isRecoverable: false });
    };

    await expect(withRetry(asyncFn, { maxRetries: 3, baseDelayMs: 10 }))
      .rejects.toThrow('Fatal auth error');
    expect(attempts).toBe(1);
  });
});

describe('Phase 1: Dependency Injection Container', () => {
  let container;

  beforeEach(() => {
    container = new Container();
  });

  it('should register and resolve singletons cleanly', () => {
    const mockRepo = { findById: () => ({ id: '123' }) };
    container.register('TaskRepository', mockRepo);

    expect(container.has('TaskRepository')).toBe(true);
    expect(container.resolve('TaskRepository').findById().id).toBe('123');
  });

  it('should throw HermesError when resolving missing dependency', () => {
    expect(() => container.resolve('NonExistentRepo')).toThrow(HermesError);
  });
});

describe('Phase 1: Environment & Configuration Validation', () => {
  it('should load and freeze valid environment settings', () => {
    const mockEnv = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret_key_1234567890',
      AGENT_ID: 'builder-test',
      AGENT_ROLE: 'builder',
      PORT: '4000'
    };

    const config = validateAndLoadEnv(mockEnv);
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.SUPABASE_URL).toBe('https://test.supabase.co');
    expect(config.PORT).toBe(4000);
    expect(config.AGENT_ROLE).toBe('builder');
  });

  it('should throw HermesError when required environment variable is malformed', () => {
    const badEnv = {
      SUPABASE_URL: 'not-a-url',
      SUPABASE_SERVICE_ROLE_KEY: 'secret'
    };

    expect(() => validateAndLoadEnv(badEnv)).toThrow(HermesError);
  });

  it('should verify Constants immutability', () => {
    expect(Object.isFrozen(Constants)).toBe(true);
    expect(Object.isFrozen(Constants.TABLES)).toBe(true);
    expect(Constants.TABLES.TASKS).toBe('tasks');
  });
});
