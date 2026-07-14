import { Constants } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { getSupabase } from './client.js';

/**
 * RealtimeManager
 * Encapsulates Supabase Realtime pub/sub channel management for event-driven task dispatch.
 */
export class RealtimeManager {
  constructor() {
    this.channels = new Map();
  }

  /**
   * Subscribes to database INSERT/UPDATE events on the tasks table.
   * @param {string} channelName - Unique identifier for the channel (e.g., 'task-engine-builder')
   * @param {Function} onInsert - Callback triggered when a new task row is inserted
   * @param {Function} onUpdate - Callback triggered when an existing task row is updated
   * @returns {import('@supabase/supabase-js').RealtimeChannel}
   */
  subscribeToTasks(channelName, onInsert, onUpdate) {
    if (this.channels.has(channelName)) {
      logger.warn(`Realtime channel [${channelName}] already active. Unsubscribing old channel first.`);
      this.unsubscribe(channelName);
    }

    const supabase = getSupabase();
    const channel = supabase.channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: Constants.TABLES.TASKS },
        (payload) => {
          logger.debug(`[Realtime] Received task INSERT event on channel [${channelName}]`, {
            taskId: payload.new ? payload.new.id : 'unknown'
          });
          if (typeof onInsert === 'function') {
            onInsert(payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: Constants.TABLES.TASKS },
        (payload) => {
          logger.debug(`[Realtime] Received task UPDATE event on channel [${channelName}]`, {
            taskId: payload.new ? payload.new.id : 'unknown',
            status: payload.new ? payload.new.status : 'unknown'
          });
          if (typeof onUpdate === 'function') {
            onUpdate(payload.new, payload.old);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.info(`Realtime subscription [${channelName}] active on tasks table.`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.error(`Realtime subscription [${channelName}] failed with status: ${status}`);
        }
      });

    this.channels.set(channelName, channel);
    return channel;
  }

  /**
   * Unsubscribes and removes a realtime channel.
   * @param {string} channelName
   * @returns {Promise<void>}
   */
  async unsubscribe(channelName) {
    if (this.channels.has(channelName)) {
      const channel = this.channels.get(channelName);
      const supabase = getSupabase();
      await supabase.removeChannel(channel);
      this.channels.delete(channelName);
      logger.info(`Unsubscribed from realtime channel [${channelName}].`);
    }
  }

  /**
   * Unsubscribes from all active channels cleanly (during shutdown).
   * @returns {Promise<void>}
   */
  async unsubscribeAll() {
    const supabase = getSupabase();
    await supabase.removeAllChannels();
    this.channels.clear();
    logger.info('All Realtime channels unsubscribed and cleared.');
  }
}

/**
 * Singleton RealtimeManager instance.
 */
export const realtimeManager = new RealtimeManager();
