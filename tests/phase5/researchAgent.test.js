import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseAgent } from '../../src/agents/BaseAgent.js';
import { ResearchAgent } from '../../src/agents/roles/ResearchAgent.js';
import { TaskStatus } from '../../src/models/TaskStatus.js';
import { HermesError } from '../../src/utils/HermesError.js';

describe('Phase 5: BaseAgent Contract Enforcement', () => {
  it('should throw HermesError when trying to instantiate abstract BaseAgent directly', () => {
    expect(() => new BaseAgent({
      agentId: 'test-node',
      role: 'builder',
      taskRepository: {},
      agentRepository: {}
    })).toThrow(HermesError);
  });
});

describe('Phase 5: ResearchAgent Execution Pipeline', () => {
  let mockTaskRepo;
  let mockAgentRepo;
  let mockGitHubService;
  let researchAgent;

  beforeEach(() => {
    mockTaskRepo = {
      updateTaskStatus: vi.fn().mockResolvedValue({}),
      saveTaskOutput: vi.fn().mockResolvedValue({ id: 'out-777' }),
      claimNextTask: vi.fn(),
      getTaskById: vi.fn()
    };

    mockAgentRepo = {
      registerOrUpdateAgent: vi.fn().mockResolvedValue({}),
      recordHeartbeat: vi.fn().mockResolvedValue(),
      updateStatus: vi.fn().mockResolvedValue({})
    };

    mockGitHubService = {
      searchRepositories: vi.fn().mockResolvedValue([
        { name: 'supabase/supabase', description: 'DB', stars: 50000, url: 'https://github.com/supabase/supabase' }
      ]),
      fetchReadme: vi.fn().mockResolvedValue('# Supabase README Content'),
      synthesizeInsights: vi.fn().mockReturnValue({ topic: 'Distributed AI', recommendations: [] })
    };

    researchAgent = new ResearchAgent({
      agentId: 'research-01',
      taskRepository: mockTaskRepo,
      agentRepository: mockAgentRepo,
      gitHubService: mockGitHubService,
      heartbeatIntervalMs: 500
    });
  });

  it('should transition status to RESEARCHING, save research_report, and transition to COMPLETED on terminal task', async () => {
    const mockTask = {
      id: 'task-500',
      title: 'Research Supabase Realtime',
      description: 'Explore Supabase Realtime websocket constraints.',
      status: TaskStatus.CLAIMED,
      metadata: {}
    };

    await researchAgent.executeTask(mockTask);

    // Verify first transition to RESEARCHING
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      1,
      'task-500',
      TaskStatus.RESEARCHING,
      expect.any(Object)
    );

    // Verify GitHubService queries
    expect(mockGitHubService.searchRepositories).toHaveBeenCalled();
    expect(mockGitHubService.fetchReadme).toHaveBeenCalledWith('supabase/supabase');

    // Verify deliverable save
    expect(mockTaskRepo.saveTaskOutput).toHaveBeenCalledWith(
      'task-500',
      'research-01',
      'research_report',
      expect.objectContaining({ topic: 'Distributed AI', topReadmeSummary: '# Supabase README Content' }),
      ['https://github.com/supabase/supabase']
    );

    // Verify final transition to COMPLETED (since parent_task_id is undefined)
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      2,
      'task-500',
      TaskStatus.COMPLETED,
      expect.any(Object)
    );
  });

  it('should transition to RESEARCH_COMPLETED if task has parent_task_id (subtask workflow)', async () => {
    const subTask = {
      id: 'task-501',
      parent_task_id: 'parent-100',
      title: 'Research architecture for builder',
      description: 'Find best CDP patterns',
      status: TaskStatus.CLAIMED,
      metadata: {}
    };

    await researchAgent.executeTask(subTask);

    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      2,
      'task-501',
      TaskStatus.RESEARCH_COMPLETED,
      expect.any(Object)
    );
  });
});
