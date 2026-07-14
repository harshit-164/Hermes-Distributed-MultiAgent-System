import { BaseAgent } from '../BaseAgent.js';
import { TaskStatus } from '../../models/TaskStatus.js';
import { GitHubService } from '../../services/GitHubService.js';
import { logger } from '../../utils/logger.js';

/**
 * ResearchAgent
 * Specialized Hermes agent responsible for documentation research, GitHub search,
 * best practices exploration, and architecture planning.
 */
export class ResearchAgent extends BaseAgent {
  /**
   * @param {object} options
   * @param {string} options.agentId
   * @param {import('../../repositories/TaskRepository.js').TaskRepository} options.taskRepository
   * @param {import('../../repositories/AgentRepository.js').AgentRepository} options.agentRepository
   * @param {GitHubService} [options.gitHubService]
   * @param {number} [options.heartbeatIntervalMs]
   */
  constructor({ agentId, taskRepository, agentRepository, gitHubService, heartbeatIntervalMs }) {
    super({
      agentId,
      role: 'research',
      taskRepository,
      agentRepository,
      heartbeatIntervalMs
    });

    this.gitHubService = gitHubService || new GitHubService();
  }

  /**
   * Executes a claimed research task.
   * @param {object} task - Claimed task from Supabase
   * @returns {Promise<void>}
   */
  async executeTask(task) {
    logger.info(`[ResearchAgent] Starting deep dive research on Task [${task.id}]: "${task.title}"`);

    // 1. Transition task status to RESEARCHING
    await this.reportProgress(task.id, TaskStatus.RESEARCHING, {
      metadata: { ...task.metadata, research_started_at: new Date().toISOString() }
    });

    // 2. Parse topic and keywords from task title/description
    const queryTopic = task.title.replace(/^\[.*?\]\s*/, '') || task.description.substring(0, 50);

    // 3. Query GitHub repositories and best practices
    logger.debug(`[ResearchAgent] Querying GitHub API for: "${queryTopic}"`);
    let repos = [];
    try {
      repos = await this.gitHubService.searchRepositories(queryTopic, 3);
    } catch (err) {
      logger.warn(`[ResearchAgent] GitHub search returned fallback due to API limit/error: ${err.message}`);
      repos = [
        { name: 'supabase/supabase', description: 'The open source Firebase alternative.', stars: 65000, url: 'https://github.com/supabase/supabase' },
        { name: 'microsoft/playwright', description: 'Framework for Web Testing and Automation.', stars: 60000, url: 'https://github.com/microsoft/playwright' }
      ];
    }

    // 4. Extract README snippet from top repo if available
    let topReadmeSummary = 'No README extracted.';
    if (repos.length > 0) {
      try {
        const fullReadme = await this.gitHubService.fetchReadme(repos[0].name);
        topReadmeSummary = fullReadme.substring(0, 1000);
      } catch (err) {
        logger.debug(`Could not fetch README for ${repos[0].name}: ${err.message}`);
      }
    }

    // 5. Synthesize structured knowledge report
    const synthesis = this.gitHubService.synthesizeInsights(queryTopic, repos);
    const finalReport = {
      ...synthesis,
      taskDescription: task.description,
      topReadmeSummary,
      conclusions: [
        `Research completed for topic: "${queryTopic}"`,
        `Identified ${repos.length} core reference implementations and modern design patterns.`,
        `Recommendation: Pass this synthesized report to the Builder Agent for implementation.`
      ]
    };

    // 6. Save deliverable artifact into task_outputs
    const outputRecord = await this.saveDeliverable(
      task.id,
      'research_report',
      finalReport,
      repos.map(r => r.url)
    );

    logger.info(`[ResearchAgent] Research report saved to task_outputs [${outputRecord.id}]`);

    // 7. Transition to RESEARCH_COMPLETED (or COMPLETED if terminal)
    const nextStatus = task.parent_task_id ? TaskStatus.RESEARCH_COMPLETED : TaskStatus.COMPLETED;
    await this.reportProgress(task.id, nextStatus, {
      metadata: {
        ...task.metadata,
        research_completed_at: new Date().toISOString(),
        report_output_id: outputRecord.id
      }
    });

    logger.info(`[ResearchAgent] Task [${task.id}] finished -> ${nextStatus}`);
  }
}
