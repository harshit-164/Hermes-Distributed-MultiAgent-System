import { TaskStatus } from '../models/TaskStatus.js';
import { AgentRole, isValidAgentRole } from '../models/AgentRole.js';
import { logger } from '../utils/logger.js';
import { realtimeManager } from '../database/realtime.js';

/**
 * TelegramController
 * Registers slash command handlers (/status, /task, /agents, /kill) and sets up
 * the Realtime event broadcaster to notify the operator via Telegram.
 */
export class TelegramController {
  /**
   * @param {import('../services/TelegramService.js').TelegramService} telegramService
   * @param {import('../repositories/TaskRepository.js').TaskRepository} taskRepository
   * @param {import('../repositories/AgentRepository.js').AgentRepository} agentRepository
   */
  constructor(telegramService, taskRepository, agentRepository) {
    this.telegramService = telegramService;
    this.taskRepository = taskRepository;
    this.agentRepository = agentRepository;
  }

  /**
   * Registers all Telegram command listeners.
   */
  registerCommands() {
    if (!this.telegramService.bot) {
      logger.debug('TelegramController: skipping command registration because bot is offline.');
      return;
    }

    // Command: /status
    this.telegramService.onText(/\/status/, async (msg) => {
      await this.handleStatus(msg.chat.id);
    });

    // Command: /task <role> <prompt>
    this.telegramService.onText(/\/task\s+(\w+)\s+(.+)/s, async (msg, match) => {
      const role = match[1].toLowerCase();
      const prompt = match[2].trim();
      await this.handleCreateTask(msg.chat.id, role, prompt);
    });

    // Command: /agents
    this.telegramService.onText(/\/agents/, async (msg) => {
      await this.handleAgents(msg.chat.id);
    });

    // Command: /kill <id>
    this.telegramService.onText(/\/kill\s+([a-f0-9-]+|\w+)/i, async (msg, match) => {
      const targetId = match[1].trim();
      await this.handleKill(msg.chat.id, targetId);
    });

    logger.info('Telegram slash commands (/status, /task, /agents, /kill) registered.');
  }

  /**
   * Handles /status summary command.
   * @param {string|number} chatId
   */
  async handleStatus(chatId) {
    try {
      const agents = await this.agentRepository.findDeadAgents(999999999); // Fetch all online/busy
      const tasks = await this.taskRepository.supabase.from(this.taskRepository.table).select('status');
      
      const statusCounts = {
        pending: 0,
        claimed: 0,
        completed: 0,
        failed: 0,
        active: 0
      };

      if (tasks.data) {
        for (const t of tasks.data) {
          if (t.status === TaskStatus.PENDING) statusCounts.pending++;
          else if (t.status === TaskStatus.COMPLETED) statusCounts.completed++;
          else if (t.status === TaskStatus.FAILED) statusCounts.failed++;
          else statusCounts.active++;
        }
      }

      const activeAgentsCount = (agents || []).filter(a => a.status === 'online' || a.status === 'busy').length;

      const report = `📊 <b>Hermes V2 OS Status Report</b>\n` +
        `----------------------------------------\n` +
        `🟢 <b>Active Agents:</b> ${activeAgentsCount}\n` +
        `⏳ <b>Pending Tasks:</b> ${statusCounts.pending}\n` +
        `⚙️ <b>Running Tasks:</b> ${statusCounts.active}\n` +
        `✅ <b>Completed Tasks:</b> ${statusCounts.completed}\n` +
        `❌ <b>Failed Tasks:</b> ${statusCounts.failed}`;

      await this.telegramService.sendMessage(report, chatId);
    } catch (error) {
      await this.telegramService.sendMessage(`⚠️ Failed to generate status report: ${error.message}`, chatId);
    }
  }

  /**
   * Handles /task <role> <prompt> command.
   * @param {string|number} chatId
   * @param {string} role
   * @param {string} prompt
   */
  async handleCreateTask(chatId, role, prompt) {
    if (!isValidAgentRole(role)) {
      const validRoles = Object.values(AgentRole).join(', ');
      await this.telegramService.sendMessage(`⛔ Invalid role: <b>${role}</b>.\nValid roles: ${validRoles}`, chatId);
      return;
    }

    try {
      const title = prompt.length > 50 ? `${prompt.substring(0, 47)}...` : prompt;
      const task = await this.taskRepository.createTask({
        title,
        description: prompt,
        requiredRole: role,
        priority: 5,
        metadata: { source: 'telegram', chatId }
      });

      await this.telegramService.sendMessage(
        `🛠️ <b>Task Created & Dispatched!</b>\n` +
        `----------------------------------------\n` +
        `<b>ID:</b> <code>${task.id}</code>\n` +
        `<b>Role:</b> ${role.toUpperCase()}\n` +
        `<b>Title:</b> ${task.title}`,
        chatId
      );
    } catch (error) {
      await this.telegramService.sendMessage(`⚠️ Failed to create task: ${error.message}`, chatId);
    }
  }

  /**
   * Handles /agents listing command.
   * @param {string|number} chatId
   */
  async handleAgents(chatId) {
    try {
      const { data: agents, error } = await this.agentRepository.supabase
        .from(this.agentRepository.table)
        .select('*')
        .order('last_heartbeat', { ascending: false });

      if (error || !agents || agents.length === 0) {
        await this.telegramService.sendMessage('🤖 No agents registered in Supabase yet.', chatId);
        return;
      }

      let text = `🤖 <b>Registered Hermes Agents (${agents.length})</b>\n----------------------------------------\n`;
      for (const a of agents) {
        const icon = a.status === 'online' ? '🟢' : a.status === 'busy' ? '⚙️' : a.status === 'error' ? '🔴' : '⚫';
        text += `${icon} <b>${a.agent_id}</b> [${a.role.toUpperCase()}] - Status: <code>${a.status}</code>\n`;
      }

      await this.telegramService.sendMessage(text, chatId);
    } catch (error) {
      await this.telegramService.sendMessage(`⚠️ Failed to fetch agents: ${error.message}`, chatId);
    }
  }

  /**
   * Handles /kill <id> command.
   * @param {string|number} chatId
   * @param {string} targetId
   */
  async handleKill(chatId, targetId) {
    try {
      // Check if target is a task first
      const task = await this.taskRepository.getTaskById(targetId);
      if (task) {
        await this.taskRepository.updateTaskStatus(targetId, TaskStatus.FAILED, {
          metadata: { ...task.metadata, killed_by: `Telegram admin (${chatId})` }
        });
        await this.telegramService.sendMessage(`🛑 Task <code>${targetId}</code> aborted and marked FAILED.`, chatId);
        return;
      }

      // Or check if target is an agent ID
      const agent = await this.agentRepository.getAgentById(targetId);
      if (agent) {
        await this.agentRepository.updateStatus(targetId, 'offline', null);
        await this.telegramService.sendMessage(`🛑 Agent <code>${targetId}</code> forced OFFLINE.`, chatId);
        return;
      }

      await this.telegramService.sendMessage(`⛔ Target <code>${targetId}</code> not found in tasks or agents.`, chatId);
    } catch (error) {
      await this.telegramService.sendMessage(`⚠️ Error during kill operation: ${error.message}`, chatId);
    }
  }

  /**
   * Sets up Realtime pub/sub broadcaster to notify operator of major task transitions.
   * @param {string} channelName
   */
  setupNotificationBroadcaster(channelName = 'telegram-broadcaster') {
    if (!this.telegramService.adminChatId) {
      logger.debug('Skipping notification broadcaster setup: no adminChatId configured.');
      return;
    }

    realtimeManager.subscribeToTasks(
      channelName,
      null, // Don't broadcast every INSERT (already alerted on /task creation)
      async (newTask, oldTask) => {
        if (!newTask || !oldTask) return;

        // Alert on transition to CLAIMED
        if (newTask.status === TaskStatus.CLAIMED && oldTask.status !== TaskStatus.CLAIMED) {
          const msg = `▶️ <b>Task Claimed</b>\n` +
            `<b>Task:</b> <code>${newTask.id}</code> ("${newTask.title}")\n` +
            `<b>Owner:</b> <code>${newTask.current_owner}</code>`;
          await this.telegramService.sendMessage(msg);
        }
        // Alert on transition to COMPLETED
        else if (newTask.status === TaskStatus.COMPLETED && oldTask.status !== TaskStatus.COMPLETED) {
          const msg = `🎉 <b>Task Completed Successfully!</b>\n` +
            `<b>Task:</b> <code>${newTask.id}</code> ("${newTask.title}")\n` +
            `<b>Owner:</b> <code>${newTask.current_owner || 'unknown'}</code>`;
          await this.telegramService.sendMessage(msg);
        }
        // Alert on transition to FAILED
        else if (newTask.status === TaskStatus.FAILED && oldTask.status !== TaskStatus.FAILED) {
          const msg = `💥 <b>Task Failed!</b>\n` +
            `<b>Task:</b> <code>${newTask.id}</code> ("${newTask.title}")\n` +
            `<b>Owner:</b> <code>${newTask.current_owner || 'unknown'}</code>`;
          await this.telegramService.sendMessage(msg);
        }
      }
    );

    logger.info('Telegram Realtime Notification Broadcaster initialized.');
  }
}
