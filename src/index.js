import { validateEnv, env } from './config/env.js';
import { container } from './core/Container.js';
import { dbManager } from './database/client.js';
import { TaskRepository } from './repositories/TaskRepository.js';
import { AgentRepository } from './repositories/AgentRepository.js';
import { LogRepository } from './repositories/LogRepository.js';
import { SchedulerSweep } from './core/SchedulerSweep.js';
import { TelegramService } from './services/TelegramService.js';
import { TelegramController } from './controllers/TelegramController.js';
import { BuilderAgent } from './agents/roles/BuilderAgent.js';
import { ResearchAgent } from './agents/roles/ResearchAgent.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

/**
 * Hermes V2 Operating System Bootstrap
 * Orchestrates dependency injection, remote audit log hooks, recovery loops,
 * control plane services, and specialized agent node instances.
 */
export async function bootstrap(customEnv = null) {
  logger.info('========================================================');
  logger.info('   Booting Hermes V2 Distributed Multi-Agent OS...     ');
  logger.info('========================================================');

  // 1. Validate environment configuration
  const config = customEnv || validateEnv();
  container.register('config', config);

  // 2. Initialize Supabase Database Client & Repositories
  const supabase = dbManager.getClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  container.register('supabase', supabase);

  const taskRepo = new TaskRepository(supabase);
  const agentRepo = new AgentRepository(supabase);
  const logRepo = new LogRepository(supabase);

  container.register('taskRepository', taskRepo);
  container.register('agentRepository', agentRepo);
  container.register('logRepository', logRepo);

  // 3. Hook remote Supabase audit log sink for warnings and errors
  logger.setSupabaseSink(async (logEntry) => {
    if (['warn', 'error', 'fatal'].includes(logEntry.severity)) {
      metrics.increment('databaseErrors');
      await logRepo.writeLog(logEntry).catch(() => {});
    }
  });
  logger.info('Remote Supabase audit log sink connected.');

  // 4. Initialize and start Scheduler Crash Recovery Sweep (unless disabled)
  let schedulerSweep = null;
  if (config.ENABLE_SCHEDULER_SWEEP !== 'false' && config.ENABLE_SCHEDULER_SWEEP !== false) {
    schedulerSweep = new SchedulerSweep(taskRepo, agentRepo);
    schedulerSweep.start();
    container.register('schedulerSweep', schedulerSweep);
  }

  // 5. Initialize Telegram Control Plane Service & Controller
  const telegramService = new TelegramService(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_ADMIN_CHAT_ID);
  const isPollingEnabled = config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_BOT_TOKEN !== 'placeholder_token';
  telegramService.init(isPollingEnabled);

  const telegramController = new TelegramController(telegramService, taskRepo, agentRepo);
  telegramController.registerCommands();
  telegramController.setupNotificationBroadcaster();

  container.register('telegramService', telegramService);
  container.register('telegramController', telegramController);

  // 6. Launch configured agent roles (`builder`, `research`, or `both`)
  const activeAgents = [];
  const nodeRole = (config.AGENT_ROLE || 'both').toLowerCase();
  const baseNodeId = config.AGENT_ID || `hermes-${nodeRole}-${Math.floor(Math.random() * 1000)}`;

  if (nodeRole === 'builder' || nodeRole === 'both') {
    const builderId = nodeRole === 'both' ? `${baseNodeId}-builder` : baseNodeId;
    const builderAgent = new BuilderAgent({
      agentId: builderId,
      taskRepository: taskRepo,
      agentRepository: agentRepo
    });
    await builderAgent.start();
    activeAgents.push(builderAgent);
    container.register('builderAgent', builderAgent);
  }

  if (nodeRole === 'research' || nodeRole === 'both') {
    const researchId = nodeRole === 'both' ? `${baseNodeId}-research` : baseNodeId;
    const researchAgent = new ResearchAgent({
      agentId: researchId,
      taskRepository: taskRepo,
      agentRepository: agentRepo
    });
    await researchAgent.start();
    activeAgents.push(researchAgent);
    container.register('researchAgent', researchAgent);
  }

  logger.info(`Hermes V2 OS Bootstrap completed. Active nodes: ${activeAgents.length}`);
  return {
    config,
    supabase,
    taskRepository: taskRepo,
    agentRepository: agentRepo,
    logRepository: logRepo,
    schedulerSweep,
    telegramService,
    telegramController,
    activeAgents
  };
}

// Auto-run bootstrap if executed directly via node src/index.js
if (process.env.HERMES_AUTO_BOOTSTRAP === 'true') {
  bootstrap().catch((err) => {
    logger.error(`Fatal bootstrap crash: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
}
