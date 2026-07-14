import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';
import { HermesError } from '../utils/HermesError.js';
import { container } from '../core/Container.js';

/**
 * Supabase Client Factory & Singleton Manager
 * Initializes the @supabase/supabase-js client with optimal resilience settings.
 */
class DatabaseManager {
  constructor() {
    this.client = null;
  }

  /**
   * Initializes or returns the existing Supabase client using Container config.
   * @returns {import('@supabase/supabase-js').SupabaseClient}
   */
  getClient() {
    if (this.client) {
      return this.client;
    }

    if (!container.has('config')) {
      throw new HermesError('Cannot initialize Supabase client: Container config not registered', {
        code: 'DB_CONFIG_MISSING',
        category: 'database',
        isRecoverable: false
      });
    }

    const config = container.resolve('config');

    try {
      logger.debug('Initializing Supabase client connection...', {
        url: config.SUPABASE_URL
      });

      this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });

      // Register the client inside DI container for repository access
      container.register('supabase', this.client);

      logger.info('Supabase client initialized and registered successfully.');
      return this.client;
    } catch (error) {
      throw new HermesError(`Failed to initialize Supabase client: ${error.message}`, {
        code: 'DB_INIT_FAILED',
        category: 'database',
        isRecoverable: false,
        cause: error
      });
    }
  }

  /**
   * Resets the active client instance (useful during unit testing or teardown).
   */
  reset() {
    if (this.client) {
      this.client.removeAllChannels();
      this.client = null;
    }
  }
}

/**
 * Singleton Database Manager instance.
 */
export const dbManager = new DatabaseManager();

/**
 * Helper to get the active Supabase client instance directly.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export function getSupabase() {
  return dbManager.getClient();
}
