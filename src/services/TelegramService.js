import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';

/**
 * TelegramService
 * Wraps node-telegram-bot-api to provide a resilient control plane for admin commands
 * and real-time task status notifications.
 */
export class TelegramService {
  /**
   * @param {string} token - Telegram Bot API Token
   * @param {string} [adminChatId] - Authorized admin chat ID for command restriction and alerts
   */
  constructor(token, adminChatId = '') {
    this.token = token;
    this.adminChatId = adminChatId ? String(adminChatId) : '';
    this.bot = null;
    this.isPolling = false;
  }

  /**
   * Initializes the bot client.
   * @param {boolean} [startPolling=false]
   */
  init(startPolling = false) {
    if (!this.token || this.token === 'placeholder_token' || this.token === 'your-telegram-bot-token') {
      logger.warn('Telegram token not provided or placeholder. TelegramService disabled.');
      return false;
    }

    try {
      this.bot = new TelegramBot(this.token, { polling: startPolling });
      this.isPolling = startPolling;

      this.bot.on('polling_error', (error) => {
        logger.warn(`Telegram polling error: ${error.message}`);
      });

      logger.info(`TelegramService initialized successfully (Polling: ${startPolling}).`);
      return true;
    } catch (error) {
      throw new HermesError(`Failed to initialize TelegramBot: ${error.message}`, {
        code: 'TELEGRAM_INIT_ERROR',
        category: 'telegram',
        isRecoverable: false,
        cause: error
      });
    }
  }

  /**
   * Checks whether the incoming message is from the authorized admin chat.
   * @param {object} msg - Telegram message object
   * @returns {boolean}
   */
  isAuthorized(msg) {
    if (!this.adminChatId) {
      // If no admin chat ID is configured, allow (or default to warn in production)
      return true;
    }
    const chatId = String(msg?.chat?.id || '');
    return chatId === this.adminChatId;
  }

  /**
   * Sends a text message or markdown alert to the specified chat (or default admin chat).
   * @param {string} text - Message text
   * @param {string} [chatId=this.adminChatId]
   * @param {object} [options={ parse_mode: 'HTML' }]
   * @returns {Promise<boolean>}
   */
  async sendMessage(text, chatId = this.adminChatId, options = { parse_mode: 'HTML' }) {
    if (!this.bot || !chatId) {
      logger.debug('Skipping Telegram sendMessage: bot not initialized or chatId missing.');
      return false;
    }

    try {
      await this.bot.sendMessage(chatId, text, options);
      return true;
    } catch (error) {
      logger.warn(`Failed to send Telegram message to [${chatId}]: ${error.message}`);
      return false;
    }
  }

  /**
   * Registers a command listener (e.g., /\/status/).
   * @param {RegExp} regex - Command regex pattern
   * @param {Function} callback - (msg, match) => Promise<void>
   */
  onText(regex, callback) {
    if (!this.bot) return;

    this.bot.onText(regex, async (msg, match) => {
      if (!this.isAuthorized(msg)) {
        logger.warn(`Unauthorized Telegram command attempt from chat ID [${msg.chat.id}]`);
        await this.sendMessage('⛔ Unauthorized: You do not have permission to control Hermes V2.', msg.chat.id);
        return;
      }

      try {
        await callback(msg, match);
      } catch (err) {
        logger.error(`Error handling Telegram command: ${err.message}`);
        await this.sendMessage(`⚠️ Error executing command: ${err.message}`, msg.chat.id);
      }
    });
  }

  /**
   * Stops bot polling cleanly.
   */
  async stop() {
    if (this.bot && this.isPolling) {
      await this.bot.stopPolling();
      this.isPolling = false;
      logger.info('Telegram polling stopped.');
    }
  }
}
