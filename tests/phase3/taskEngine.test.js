import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeartbeatWorker } from '../../src/core/HeartbeatWorker.js';
import { SchedulerSweep } from '../../src/core/SchedulerSweep.js';
import { TaskEngine } from '../../src/core/TaskEngine.js';
import { TaskStatus } from '../../src/models/TaskStatus.js';
import { HermesError } from '../../src/utils/HermesError.js';

describe('Phase 3: HeartbeatWorker', () => {
  let mockAgentRepo;
  let worker;

  beforeEach(() => {
    mockAgentRepo = {
      recordHeartbeat: vi.fn().mockResolvedValue()
    };
    worker = new HeartbeatWorker('builder-01', mockAgentRepo, 100);
  });

  it('should collect and send telemetry during pingOnce', async () => {
    await worker.pingOnce();
    expect(mockAgentRepo.recordHeartbeat).toHaveBeenCalledWith('builder-01', expect.objectContaining({
      cpuUsage: expect.any(Number),
      memoryUsage: expect.any(Number),
      status: 'online'
    }));
  });

  it('should start and stop timer loop cleanly', () => {
    worker.start();
    expect(worker.isRunning).toBe(true);
    worker.stop();
    expect(worker.isRunning).toBe(false);
  });
});

describe('Phase 3: SchedulerSweep', () => {
  let mockTaskRepo;
  let mockAgentRepo;
  let sweep;

  beforeEach(() => {
    mockTaskRepo = {
      getTaskById: vi.fn(),
      updateTaskStatus: vi.fn().mockResolvedValue(),
      findTimedOutTasks: vi.fn().mockResolvedValue([])
    };
    mockAgentRepo = {
      findDeadAgents: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn().mockResolvedValue()
    };
    sweep = new SchedulerSweep(mockTaskRepo, mockAgentRepo, 1000);
  });

  it('should recover tasks held by dead agents', async () => {
    mockAgentRepo.findDeadAgents.mockResolvedValueOnce([
      { agent_id: 'dead-builder-01', role: 'builder', current_task_id: 'task-555' }
    ]);
    mockTaskRepo.getTaskById.mockResolvedValueOnce({
      id: 'task-555',
      title: 'Stalled Task',
      status: TaskStatus.CLAIMED,
      retry_count: 0,
      max_retries: 3
    });

    const recovered = await sweep.recoverDeadAgents();
    expect(recovered).toBe(1);
    expect(mockAgentRepo.updateStatus).toHaveBeenCalledWith('dead-builder-01', 'offline', null);
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-555', TaskStatus.PENDING, expect.objectContaining({
      retry_count: 1,
      current_owner: null
    }));
  });

  it('should mark task as FAILED if max retries exceeded during timeout sweep', async () => {
    mockTaskRepo.findTimedOutTasks.mockResolvedValueOnce([
      { id: 'task-999', title: 'Slow Task', retry_count: 2, max_retries: 3, timeout_seconds: 3600 }
    ]);

    const recovered = await sweep.recoverTimedOutTasks();
    expect(recovered).toBe(1);
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-999', TaskStatus.FAILED, expect.objectContaining({
      retry_count: 3,
      current_owner: null
    }));
  });
});

describe('Phase 3: TaskEngine', () => {
  let mockTaskRepo;
  let mockHeartbeatWorker;

  beforeEach(() => {
    mockTaskRepo = {
      claimNextTask: vi.fn(),
      getTaskById: vi.fn(),
      updateTaskStatus: vi.fn().mockResolvedValue(),
      saveTaskOutput: vi.fn().mockResolvedValue()
    };
    mockHeartbeatWorker = {
      setStatus: vi.fn()
    };
  });

  it('should claim task, execute roleHandler, and transition to COMPLETED', async () => {
    const mockTask = { id: 'task-101', title: 'Test Job', status: TaskStatus.CLAIMED };
    mockTaskRepo.claimNextTask.mockResolvedValueOnce(mockTask);
    mockTaskRepo.getTaskById.mockResolvedValueOnce(mockTask);

    const roleHandler = vi.fn().mockResolvedValueOnce();
    const engine = new TaskEngine({
      agentId: 'builder-01',
      role: 'builder',
      taskRepository: mockTaskRepo,
      heartbeatWorker: mockHeartbeatWorker,
      roleHandler
    });

    engine.isRunning = true;
    const processed = await engine.processNext();

    expect(processed).toBe(true);
    expect(roleHandler).toHaveBeenCalledWith(mockTask, mockTaskRepo);
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-101', TaskStatus.COMPLETED);
  });

  it('should catch handler exception and release task back to PENDING if retriable', async () => {
    const mockTask = { id: 'task-102', title: 'Failing Job', status: TaskStatus.CLAIMED, retry_count: 0, max_retries: 3 };
    mockTaskRepo.claimNextTask.mockResolvedValueOnce(mockTask);
    mockTaskRepo.getTaskById.mockResolvedValueOnce(mockTask);

    const roleHandler = vi.fn().mockRejectedValueOnce(new HermesError('Transient crash', { isRecoverable: true }));
    const engine = new TaskEngine({
      agentId: 'builder-01',
      role: 'builder',
      taskRepository: mockTaskRepo,
      heartbeatWorker: mockHeartbeatWorker,
      roleHandler
    });

    engine.isRunning = true;
    await engine.processNext();

    expect(mockTaskRepo.saveTaskOutput).toHaveBeenCalledWith('task-102', 'builder-01', 'error_dump', expect.any(Object));
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-102', TaskStatus.PENDING, expect.objectContaining({
      retry_count: 1,
      current_owner: null
    }));
  });

  it('should mark task FAILED immediately if exception is non-recoverable HermesError', async () => {
    const mockTask = { id: 'task-103', title: 'Fatal Job', status: TaskStatus.CLAIMED, retry_count: 0, max_retries: 3 };
    mockTaskRepo.claimNextTask.mockResolvedValueOnce(mockTask);
    mockTaskRepo.getTaskById.mockResolvedValueOnce(mockTask);

    const roleHandler = vi.fn().mockRejectedValueOnce(new HermesError('Invalid syntax payload', { isRecoverable: false }));
    const engine = new TaskEngine({
      agentId: 'builder-01',
      role: 'builder',
      taskRepository: mockTaskRepo,
      heartbeatWorker: mockHeartbeatWorker,
      roleHandler
    });

    engine.isRunning = true;
    await engine.processNext();

    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-103', TaskStatus.FAILED, expect.objectContaining({
      current_owner: null
    }));
  });
});
