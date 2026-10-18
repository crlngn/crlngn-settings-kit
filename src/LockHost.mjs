/**
 * Lock Host
 *
 * Lets one module keep SettingsLocks for other modules' client settings, stored in the host's own
 * world settings under "<module id>.<key>". Two uses:
 * - Guests: a module calls `register(moduleId, keys)` (through the host's API) and gets a
 *   SettingsLocks for its custom menus, without bundling the kit or registering storage itself.
 * - Configure Settings: with `lockConfigSettings`, the host adopts other modules' client settings
 *   shown in Foundry's own settings window (config: true), and `watchSettingsConfig` draws the icons.
 * A setting whose onChange a copy of the kit already wraps is never adopted, so it is never locked twice.
 */

import { SettingsLocks } from './SettingsLocks.mjs';
import { LockIcons } from './LockIcons.mjs';

const DEFAULT_HOST_STORAGE = {
  states: 'guestLockStates',
  values: 'guestLockValues',
  applied: 'guestLockAppliedSoftValues'
};

const SKIPPED_NAMESPACES = new Set(['core']);

export class LockHost {
  #hostId;
  #storage;
  #guests = new Map();

  /**
   * @param {object} options
   * @param {string} options.hostId        Module that stores the locks
   * @param {object} [options.storage]     Keys of the host's storage settings: { states, values, applied }
   */
  constructor({ hostId, storage = {} }) {
    this.#hostId = hostId;
    this.#storage = { ...DEFAULT_HOST_STORAGE, ...storage };
  }

  get hostId() {
    return this.#hostId;
  }

  /**
   * @returns {SettingsLocks[]}
   */
  get guests() {
    return [...this.#guests.values()];
  }

  /**
   * Register the host's storage settings (call during init). A change to the GM's locks or values
   * is applied on players' clients straight away.
   */
  registerSettings() {
    const reapply = () => {
      if (game.ready) this.apply();
    };
    game.settings.register(this.#hostId, this.#storage.states, {
      scope: 'world', config: false, type: Object, default: {}, onChange: reapply
    });
    game.settings.register(this.#hostId, this.#storage.values, {
      scope: 'world', config: false, type: Object, default: {}, onChange: reapply
    });
    game.settings.register(this.#hostId, this.#storage.applied, {
      scope: 'client', config: false, type: Object, default: {}
    });
  }

  /**
   * Make a module's client settings lockable. Settings already registered are wrapped in place; for
   * one registered later, pass its onChange through the returned locks' `wrapOnChange`. Registering
   * the same module again adds the new keys. After `ready`, the GM's values are applied at once.
   * @param {string} moduleId
   * @param {string[]} keys
   * @returns {SettingsLocks}
   */
  register(moduleId, keys) {
    const previous = this.#guests.get(moduleId);
    const locks = new SettingsLocks({
      moduleId,
      keys: [...new Set([...(previous?.keys ?? []), ...keys])],
      storage: this.#storage,
      namespace: this.#hostId,
      prefix: `${moduleId}.`
    });
    this.#guests.set(moduleId, locks);
    locks.adopt();
    if (game.ready) locks.apply();
    return locks;
  }

  /**
   * @param {string} moduleId
   * @returns {SettingsLocks|undefined}
   */
  get(moduleId) {
    return this.#guests.get(moduleId);
  }

  /**
   * Adopt the client settings of active modules that are shown in Configure Settings (config: true).
   * Core, the host's own settings, excluded modules and settings already locked by the kit are skipped.
   * Call once every module has registered its settings (setup or ready).
   * @param {object} [options]
   * @param {string[]} [options.exclude]   Module ids to leave alone
   * @param {boolean} [options.system]     Include the game system's settings too
   * @returns {Record<string, string[]>}   The adopted keys, by module id
   */
  lockConfigSettings({ exclude = [], system = false } = {}) {
    const skipped = new Set([...SKIPPED_NAMESPACES, this.#hostId, ...exclude]);
    const found = {};
    for (const config of game.settings.settings.values()) {
      const namespace = config.namespace;
      if (!config.config || config.scope !== 'client' || skipped.has(namespace)) continue;
      const isModule = !!game.modules.get(namespace)?.active;
      const isSystem = system && namespace === game.system?.id;
      if (!isModule && !isSystem) continue;
      if (SettingsLocks.isWrapped(config) && !this.#guests.get(namespace)?.isLockable(config.key)) continue;
      (found[namespace] ??= []).push(config.key);
    }
    for (const [moduleId, keys] of Object.entries(found)) this.register(moduleId, keys);
    return found;
  }

  /**
   * Draw the lock icons in Foundry's Configure Settings window whenever it renders.
   * @param {object} [options]
   * @param {{toggle: string, locked: string}} [options.titles]
   */
  watchSettingsConfig({ titles } = {}) {
    Hooks.on('renderSettingsConfig', (app, html) => {
      const root = html instanceof HTMLElement ? html : (html?.[0] ?? app.element);
      this.render(root, { scope: '#settings-config', titles, namespaced: true });
    });
  }

  /**
   * Draw the lock icons of every guest into a settings form.
   * @param {HTMLElement} root
   * @param {object} [options]
   * @param {string} [options.scope]
   * @param {{toggle: string, locked: string}} [options.titles]
   * @param {boolean} [options.namespaced]  Field names are "<module id>.<key>", as in Configure Settings
   */
  render(root, { scope = '', titles, namespaced = false } = {}) {
    for (const locks of this.#guests.values()) {
      LockIcons.render(root, locks, { scope, titles, fieldPrefix: namespaced ? `${locks.moduleId}.` : '' });
    }
  }

  /**
   * Write the GM's values into this client's settings for every guest.
   * @returns {Promise<boolean>} Whether any setting changed
   */
  async apply() {
    let changed = false;
    for (const locks of this.#guests.values()) changed = (await locks.apply()) || changed;
    return changed;
  }
}
