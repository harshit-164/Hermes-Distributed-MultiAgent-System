import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootstrap } from '../../src/index.js';
import { container } from '../../src/core/Container.js';
import { dbManager } from '../../src/database/client.js';
import { logger } from '../../src/utils/logger.js';
import { metrics } from '../../src/utils/metrics.js';

describe('Phase 7: End-to-End System Integration & Bootstrap', () => {
  beforeEach(() => {
    container.clear();
    dbManager.reset();
    metrics.reset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should wire all components and register repositories & agents in DI container', async () => {
    const mockEnv = {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test-supabase-url.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key-test',
      TELEGRAM_BOT_TOKEN: 'placeholder_token',
      AGENT_ROLE: 'both',
      ENABLE_SCHEDULER_SWEEP: false
    };

    // Mock supabase calls during start()
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { agent_id: 'test-agent' }, error: null })
          })
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: {}, error: null })
            })
          })
        })
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

    const result = await bootstrap(mockEnv);

    expect(result.activeAgents.length).toBe(2);
    expect(container.resolve('taskRepository')).toBeDefined();
    expect(container.resolve('agentRepository')).toBeDefined();
    expect(container.resolve('builderAgent')).toBeDefined();
    expect(container.resolve('researchAgent')).toBeDefined();

    // Clean up active agents & sweep
    if (result.schedulerSweep) result.schedulerSweep.stop();
    for (const agent of result.activeAgents) {
      await agent.stop();
    }
  });

  it('should trigger remote Supabase log sink when logger emits warn or error', async () => {
    metrics.reset();
    let sinkCalled = false;
    logger.setSupabaseSink(async (entry) => {
      sinkCalled = true;
      metrics.increment('databaseErrors');
    });

    logger.warn('Testing remote warning trigger');
    await new Promise(r => setTimeout(r, 15));

    expect(sinkCalled).toBe(true);
    expect(metrics.getSnapshot().counters.databaseErrors).toBe(1);
  });
});
