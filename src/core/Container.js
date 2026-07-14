import { HermesError } from '../utils/HermesError.js';

/**
 * Dependency Injection Container
 * Manages singleton registrations and safe resolution across the modular system.
 */
export class Container {
  constructor() {
    this._registry = new Map();
  }

  /**
   * Registers a singleton or dependency instance under a unique key.
   * @param {string} key - Unique identifier (e.g., 'TaskRepository')
   * @param {*} instance - The object, class instance, or value to register
   */
  register(key, instance) {
    if (!key || typeof key !== 'string') {
      throw new HermesError('Container registration key must be a valid string', {
        code: 'DI_INVALID_KEY',
        category: 'system'
      });
    }
    this._registry.set(key, instance);
  }

  /**
   * Resolves a registered dependency by key. Throws if missing.
   * @template T
   * @param {string} key - Unique identifier
   * @returns {T}
   */
  resolve(key) {
    if (!this._registry.has(key)) {
      throw new HermesError(`Dependency [${key}] has not been registered in the Container`, {
        code: 'DI_MISSING_DEPENDENCY',
        category: 'system'
      });
    }
    return this._registry.get(key);
  }

  /**
   * Checks whether a key is registered.
   * @param {string} key 
   * @returns {boolean}
   */
  has(key) {
    return this._registry.has(key);
  }

  /**
   * Clears all registered instances (useful during unit testing cleanup).
   */
  clear() {
    this._registry.clear();
  }
}

/**
 * Global singleton DI container instance.
 */
export const container = new Container();
