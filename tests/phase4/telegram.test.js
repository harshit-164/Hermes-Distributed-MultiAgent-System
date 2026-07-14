import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramService } from '../../src/services/TelegramService.js';
import { TelegramController } from '../../src/controllers/TelegramController.js';
import { TaskStatus } from '../../src/models/TaskStatus.js';

describe('Phase 4: TelegramService', () => {
  it('should initialize cleanly without polling if placeholder token provided', () => {
    const service = new TelegramService('placeholder_token', '123456');
    const started = service.init(false);
    expect(started).toBe(false);
  });

  it('should authorize message from matching adminChatId', () => {
    const service = new TelegramService('valid-token-mock', '99999');
    expect(service.isAuthorized({ chat: { id: 99999 } })).toBe(true);
    expect(service.isAuthorized({ chat: { id: 11111 } })).toBe(false);
  });
});

describe('Phase 4: TelegramController', () => {
  let mockTelegramService;
  let mockTaskRepo;
  let mockAgentRepo;
  let controller;

  beforeEach(() => {
    mockTelegramService = {
      bot: { onText: vi.fn(), sendMessage: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(true),
      onText: vi.fn()
    };

    mockTaskRepo = {
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValueOnce({
            data: [{ status: TaskStatus.PENDING }, { status: TaskStatus.CLAIMED }]
          })
        })
      },
      createTask: vi.fn().mockResolvedValue({ id: 'task-abc', title: 'Test Prompt', required_role: 'builder' }),
      getTaskById: vi.fn(),
      updateTaskStatus: vi.fn().mockResolvedValue()
    };

    mockAgentRepo = {
      findDeadAgents: vi.fn().mockResolvedValue([{ agent_id: 'builder-01', status: 'online' }]),
      getAgentById: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(),
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValueOnce({
              data: [{ agent_id: 'builder-01', role: 'builder', status: 'online' }],
              error: null
            })
          })
        })
      }
    };

    controller = new TelegramController(mockTelegramService, mockTaskRepo, mockAgentRepo);
  });

  it('should format and send cluster summary on handleStatus', async () => {
    await controller.handleStatus('99999');
    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Hermes V2 OS Status Report'),
      '99999'
    );
  });

  it('should reject task creation if role is invalid', async () => {
    await controller.handleCreateTask('99999', 'hacker', 'Do something bad');
    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Invalid role'),
      '99999'
    );
    expect(mockTaskRepo.createTask).not.toHaveBeenCalled();
  });

  it('should create task and alert user on valid handleCreateTask', async () => {
    await controller.handleCreateTask('99999', 'builder', 'Build a landing page');
    expect(mockTaskRepo.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Build a landing page',
      requiredRole: 'builder'
    }));
    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Task Created & Dispatched!'),
      '99999'
    );
  });

  it('should handle kill command on existing task ID', async () => {
    mockTaskRepo.getTaskById.mockResolvedValueOnce({ id: 'task-abc', metadata: {} });
    await controller.handleKill('99999', 'task-abc');
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenCalledWith('task-abc', TaskStatus.FAILED, expect.any(Object));
    expect(mockTelegramService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('aborted and marked FAILED'),
      '99999'
    );
  });
});
