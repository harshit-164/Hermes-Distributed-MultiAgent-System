import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { startServer } from '../../src/server.js';
import { container } from '../../src/core/Container.js';
import { dbManager } from '../../src/database/client.js';
import { metrics } from '../../src/utils/metrics.js';

describe('Phase 8: Production Polish & Health Probe Server', () => {
  let serverInstance;

  beforeEach(() => {
    container.clear();
    dbManager.reset();
    metrics.reset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { agent_id: 'test-node' }, error: null })
          })
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: {}, error: null })
            })
          })
        }),
        select: vi.fn().mockResolvedValue({ data: [{ agent_id: 'test-node', status: 'online' }], error: null })
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn()
      }),
      removeChannel: vi.fn().mockResolvedValue(),
      removeAllChannels: vi.fn().mockResolvedValue()
    };

    vi.spyOn(dbManager, 'getClient').mockReturnValue(mockSupabase);
  });

  afterEach(async () => {
    if (serverInstance && serverInstance.shutdown) {
      await serverInstance.shutdown('TEST_CLEANUP');
    }
    vi.restoreAllMocks();
  });

  it('should start Express server and respond with 200 OK on /healthz', async () => {
    const mockEnv = {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test-supabase-url.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key-test',
      TELEGRAM_BOT_TOKEN: 'placeholder_token',
      AGENT_ROLE: 'both',
      ENABLE_SCHEDULER_SWEEP: false
    };

    serverInstance = await startServer(0, mockEnv); // Port 0 assigns random ephemeral port

    const response = await request(serverInstance.app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(response.body.activeNodes).toBe(2);
  });

  it('should return metrics snapshot on /metrics endpoint', async () => {
    metrics.increment('tasksCompleted', 5);
    serverInstance = await startServer(0, {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test-supabase-url.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key-test',
      TELEGRAM_BOT_TOKEN: 'placeholder_token',
      AGENT_ROLE: 'builder',
      ENABLE_SCHEDULER_SWEEP: false
    });

    const response = await request(serverInstance.app).get('/metrics');
    expect(response.status).toBe(200);
    expect(response.body.counters.tasksCompleted).toBe(5);
  });

  it('should return 503 UNAVAILABLE on /healthz during shutdown', async () => {
    serverInstance = await startServer(0, {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test-supabase-url.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key-test',
      TELEGRAM_BOT_TOKEN: 'placeholder_token',
      AGENT_ROLE: 'builder',
      ENABLE_SCHEDULER_SWEEP: false
    });

    await serverInstance.shutdown('TEST_SHUTDOWN');
    const response = await request(serverInstance.app).get('/healthz');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('UNAVAILABLE');
    expect(response.body.shuttingDown).toBe(true);
  });
});
