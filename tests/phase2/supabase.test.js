import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskRepository } from '../../src/repositories/TaskRepository.js';
import { AgentRepository } from '../../src/repositories/AgentRepository.js';
import { LogRepository } from '../../src/repositories/LogRepository.js';
import { dbManager } from '../../src/database/client.js';
import { realtimeManager } from '../../src/database/realtime.js';
import { container } from '../../src/core/Container.js';
import { TaskStatus } from '../../src/models/TaskStatus.js';
import { HermesError } from '../../src/utils/HermesError.js';
import { Constants } from '../../src/config/constants.js';

describe('Phase 2: TaskRepository', () => {
  let mockSupabase;
  let taskRepo;

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn()
    };
    taskRepo = new TaskRepository(mockSupabase);
  });

  it('should call claim_next_task RPC with correct agentId and role', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ id: 'task-101', title: 'Test Task', status: 'claimed' }],
      error: null
    });

    const claimed = await taskRepo.claimNextTask('builder-01', 'builder');
    expect(mockSupabase.rpc).toHaveBeenCalledWith(Constants.RPC.CLAIM_NEXT_TASK, {
      p_agent_id: 'builder-01',
      p_role: 'builder'
    });
    expect(claimed.id).toBe('task-101');
  });

  it('should return null when claim_next_task returns empty array', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });
    const claimed = await taskRepo.claimNextTask('builder-01', 'builder');
    expect(claimed).toBeNull();
  });

  it('should create a new task with PENDING status', async () => {
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValueOnce({
          data: { id: 'task-202', title: 'New Task', status: TaskStatus.PENDING },
          error: null
        })
      })
    });
    mockSupabase.from.mockReturnValue({ insert: mockInsert });

    const created = await taskRepo.createTask({
      title: 'New Task',
      description: 'Test description',
      requiredRole: 'research'
    });

    expect(created.id).toBe('task-202');
    expect(created.status).toBe(TaskStatus.PENDING);
  });
});

describe('Phase 2: AgentRepository', () => {
  let mockSupabase;
  let agentRepo;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn()
    };
    agentRepo = new AgentRepository(mockSupabase);
  });

  it('should register or update agent in registry with online status', async () => {
    const mockUpsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValueOnce({
          data: { agent_id: 'research-01', role: 'research', status: 'online' },
          error: null
        })
      })
    });
    mockSupabase.from.mockReturnValue({ upsert: mockUpsert });

    const agent = await agentRepo.registerOrUpdateAgent('research-01', 'research', { os: 'windows' });
    expect(agent.agent_id).toBe('research-01');
    expect(agent.status).toBe('online');
  });

  it('should record heartbeat to agent_heartbeats table', async () => {
    const mockInsert = vi.fn().mockResolvedValueOnce({ error: null });
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValueOnce({ error: null })
    });

    mockSupabase.from.mockImplementation((table) => {
      if (table === Constants.TABLES.AGENT_HEARTBEATS) return { insert: mockInsert };
      if (table === Constants.TABLES.AGENT_REGISTRY) return { update: mockUpdate };
      return {};
    });

    await expect(agentRepo.recordHeartbeat('builder-01', { cpuUsage: 12.5 })).resolves.not.toThrow();
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe('Phase 2: LogRepository', () => {
  it('should write log entry without throwing on Supabase insert error', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockRejectedValueOnce(new Error('Network disconnected'))
      })
    };
    const logRepo = new LogRepository(mockSupabase);

    await expect(logRepo.writeLog({ severity: 'info', message: 'Test log' }))
      .resolves.not.toThrow();
  });
});

describe('Phase 2: Database Client & Realtime Manager', () => {
  beforeEach(() => {
    dbManager.reset();
    container.clear();
  });

  it('should throw HermesError when getting Supabase client without config', () => {
    expect(() => dbManager.getClient()).toThrow(HermesError);
  });

  it('should clean up subscriptions when RealtimeManager unsubscribeAll is called', async () => {
    const mockRemoveAll = vi.fn().mockResolvedValueOnce();
    const mockSupabase = { removeAllChannels: mockRemoveAll };
    dbManager.client = mockSupabase;

    await realtimeManager.unsubscribeAll();
    expect(mockRemoveAll).toHaveBeenCalled();
  });
});
