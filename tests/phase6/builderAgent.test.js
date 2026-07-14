import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import { CodeEditorService } from '../../src/services/CodeEditorService.js';
import { BuilderAgent } from '../../src/agents/roles/BuilderAgent.js';
import { TaskStatus } from '../../src/models/TaskStatus.js';
import { HermesError } from '../../src/utils/HermesError.js';

describe('Phase 6: CodeEditorService', () => {
  const service = new CodeEditorService(process.cwd());

  it('should abort path traversal attempts escaping workspace boundary', async () => {
    await expect(service.readFile('../../Windows/System32/drivers/etc/hosts'))
      .rejects.toThrow(HermesError);
  });

  it('should execute basic shell commands and return stdout', async () => {
    const result = await service.runCommand(process.platform === 'win32' ? 'echo hello hermes' : 'echo "hello hermes"');
    expect(result.stdout).toContain('hello hermes');
  });
});

describe('Phase 6: BuilderAgent Execution Pipeline', () => {
  let mockTaskRepo;
  let mockAgentRepo;
  let mockCodeEditor;
  let mockPlaywright;
  let builderAgent;

  beforeEach(() => {
    mockTaskRepo = {
      updateTaskStatus: vi.fn().mockResolvedValue({}),
      saveTaskOutput: vi.fn().mockResolvedValue({ id: 'out-888' }),
      claimNextTask: vi.fn(),
      getTaskById: vi.fn()
    };

    mockAgentRepo = {
      registerOrUpdateAgent: vi.fn().mockResolvedValue({}),
      recordHeartbeat: vi.fn().mockResolvedValue(),
      updateStatus: vi.fn().mockResolvedValue({})
    };

    mockCodeEditor = {
      writeFile: vi.fn().mockResolvedValue(),
      runCommand: vi.fn().mockResolvedValue({ stdout: 'All 10 tests passed', stderr: '' })
    };

    mockPlaywright = {
      init: vi.fn().mockResolvedValue(),
      startCdpSession: vi.fn().mockResolvedValue(),
      goto: vi.fn().mockResolvedValue({ status: 200, url: 'https://example.com' }),
      captureScreenshot: vi.fn().mockResolvedValue('base64pngmock'),
      close: vi.fn().mockResolvedValue()
    };

    builderAgent = new BuilderAgent({
      agentId: 'builder-01',
      taskRepository: mockTaskRepo,
      agentRepository: mockAgentRepo,
      codeEditorService: mockCodeEditor,
      playwrightService: mockPlaywright,
      heartbeatIntervalMs: 500
    });
  });

  it('should transition through IMPLEMENTING -> TESTING -> COMPLETED and write code_diff & test_results', async () => {
    const mockTask = {
      id: 'task-600',
      title: 'Implement login page',
      description: 'Build UI and verify browser flow at https://example.com/login',
      status: TaskStatus.CLAIMED,
      metadata: { targetFile: 'src/components/Login.js', fileContent: 'console.log("login");' }
    };

    await builderAgent.executeTask(mockTask);

    // Verify transition to IMPLEMENTING
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      1,
      'task-600',
      TaskStatus.IMPLEMENTING,
      expect.any(Object)
    );

    // Verify Playwright check since URL was present
    expect(mockPlaywright.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(mockPlaywright.captureScreenshot).toHaveBeenCalled();
    expect(mockPlaywright.close).toHaveBeenCalled();

    // Verify file modification
    expect(mockCodeEditor.writeFile).toHaveBeenCalledWith('src/components/Login.js', 'console.log("login");');

    // Verify intermediate deliverable (code_diff)
    expect(mockTaskRepo.saveTaskOutput).toHaveBeenNthCalledWith(
      1,
      'task-600',
      'builder-01',
      'code_diff',
      expect.objectContaining({ summary: 'Modified file: src/components/Login.js' }),
      expect.any(Array)
    );

    // Verify transition to TESTING
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      2,
      'task-600',
      TaskStatus.TESTING,
      expect.any(Object)
    );

    // Verify final deliverable (test_results)
    expect(mockTaskRepo.saveTaskOutput).toHaveBeenNthCalledWith(
      2,
      'task-600',
      'builder-01',
      'test_results',
      expect.objectContaining({ passed: true }),
      expect.any(Array)
    );

    // Verify transition to COMPLETED
    expect(mockTaskRepo.updateTaskStatus).toHaveBeenNthCalledWith(
      3,
      'task-600',
      TaskStatus.COMPLETED,
      expect.any(Object)
    );
  });
});
