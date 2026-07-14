import express from 'express';
import { bootstrap } from './index.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { container } from './core/Container.js';

/**
 * Hermes V2 Production Server & Health Probe
 * Provides HTTP liveness/readiness probes (/healthz, /metrics, /status)
 * and manages graceful shutdown signals (SIGINT, SIGTERM) to prevent task corruption.
 */
export async function startServer(port = process.env.PORT || 3000, customEnv = null) {
  const app = express();
  app.use(express.json());

  let systemContext = null;
  let isShuttingDown = false;

  try {
    systemContext = await bootstrap(customEnv);
  } catch (error) {
    logger.error(`Failed to boot Hermes OS during server startup: ${error.message}`);
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }

  // 1. Healthz probe (liveness)
  app.get('/healthz', (req, res) => {
    if (isShuttingDown || !systemContext) {
      return res.status(503).json({ status: 'UNAVAILABLE', shuttingDown: isShuttingDown });
    }
    return res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      activeNodes: systemContext.activeAgents.length
    });
  });

  // 2. Metrics endpoint (Prometheus / JSON metrics)
  app.get('/metrics', (req, res) => {
    const snapshot = metrics.getSnapshot();
    return res.status(200).json(snapshot);
  });

  // 3. Cluster status summary endpoint
  app.get('/status', async (req, res) => {
    if (!systemContext) {
      return res.status(503).json({ error: 'System not initialized' });
    }
    try {
      const { data: agents } = await systemContext.agentRepository.supabase
        .from(systemContext.agentRepository.table)
        .select('*');
      return res.status(200).json({
        nodeId: systemContext.config.AGENT_ID || 'local-node',
        role: systemContext.config.AGENT_ROLE || 'both',
        registeredAgents: agents || []
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(port, () => {
    logger.info(`Hermes V2 Health Check Server listening on port ${port}`);
  });

  // Graceful shutdown handler
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Initiating graceful shutdown of Hermes V2...`);

    // Stop accepting HTTP requests
    server.close();

    if (systemContext) {
      // 1. Stop scheduler recovery sweep
      if (systemContext.schedulerSweep) {
        systemContext.schedulerSweep.stop();
      }

      // 2. Stop Telegram polling
      if (systemContext.telegramService) {
        await systemContext.telegramService.stop();
      }

      // 3. Stop all active agent nodes cleanly
      for (const agent of systemContext.activeAgents) {
        await agent.stop().catch(e => logger.warn(`Error stopping agent [${agent.agentId}]: ${e.message}`));
      }
    }

    logger.info('Hermes V2 graceful shutdown completed.');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(0);
    }
  };

  // Register OS signal listeners when not running under Vitest runner
  if (process.env.NODE_ENV !== 'test') {
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  return { app, server, systemContext, shutdown };
}
