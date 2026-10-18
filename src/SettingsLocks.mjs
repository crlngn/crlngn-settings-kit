/**
 * Settings Locks
 *
 * GM-driven locks on a module's client-scoped settings, in four states:
 * - unlocked: players choose freely
 * - soft: the GM's value is applied once (and again whenever the GM changes it); players can change it after
 * - locked: the GM's value is applied on every load, and a player's change is reverted
 * - gate: locked for players, while the GM keeps their own value
 *
 * Storage (all config:false): a world map {key: state}, a world map of the GM's values {key: value},
 * and a client map of the soft values this device has already applied. The host module registers its
 * lockable settings with `wrapOnChange`, registers the kit's storage with `registerSettings`, and calls
 * `apply` once its settings are registered. Self-contained: imports nothing from the host module.
 *
 * The storage can live under another module (`namespace`), with the keys in its maps prefixed
 * (`prefix`): this is how a LockHost keeps the locks of other modules' settings. A setting that was
 * registered without `wrapOnChange` can be wrapped afterwards with `adopt`.
 */

export const LOCK_STATES = Object.freeze({
  UNLOCKED: 'unlocked',
  SOFT: 'soft',
  LOCKED: 'locked',
  GATE: 'gate'
});

const NEXT_STATE = {
  [LOCK_STATES.UNLOCKED]: LOCK_STATES.SOFT,
  [LOCK_STATES.SOFT]: LOCK_STATES.LOCKED,
  [LOCK_STATES.LOCKED]: LOCK_STATES.UNLOCKED,
  [LOCK_STATES.GATE]: LOCK_STATES.SOFT
};

const DEFAULT_STORAGE = {
  states: 'lockStates',
  values: 'lockValues',
  applied: 'lockAppliedSoftValues'
};

const WRAPPED = Symbol.for('crlngn.settingsKit.wrapped');

export class SettingsLocks {
  #moduleId;
  #keys;
  #storage;
  #namespace;
  #prefix;

  /**
   * @param {object} options
   * @param {string} options.moduleId          Module id the settings are registered under
   * @param {string[]} options.keys            Lockable client setting keys
   * @param {object} [options.storage]         Keys for the kit's own settings: { states, values, applied }
   * @param {string} [options.namespace]       Module the storage settings are registered under (default: moduleId)
   * @param {string} [options.prefix]          Prefix of this module's keys inside the storage maps
   */
  constructor({ moduleId, keys, storage = {}, namespace = moduleId, prefix = '' }) {
    this.#moduleId = moduleId;
    this.#keys = new Set(keys);
    this.#storage = { ...DEFAULT_STORAGE, ...storage };
    this.#namespace = namespace;
    this.#prefix = prefix;
  }

  get moduleId() {
    return this.#moduleId;
  }

  get keys() {
    return [...this.#keys];
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  isLockable(key) {
    return this.#keys.has(key);
  }

  /**
   * Whether the current user is a GM (assistant or above). Falls back to the raw user data during
   * `init`, before `game.user` exists.
   * @returns {boolean}
   */
  static isGM() {
    if (game.user) return game.user.isGM;
    const role = game.data?.users?.find(u => u._id === game.userId)?.role ?? 0;
    return role >= CONST.USER_ROLES.ASSISTANT;
  }

  /**
   * Register the kit's storage settings (call during init). A change to the GM's locks or values is
   * applied on players' clients straight away.
   */
  registerSettings() {
    const reapply = () => {
      if (game.ready) this.apply();
    };
    game.settings.register(this.#namespace, this.#storage.states, {
      scope: 'world', config: false, type: Object, default: {}, onChange: reapply
    });
    game.settings.register(this.#namespace, this.#storage.values, {
      scope: 'world', config: false, type: Object, default: {}, onChange: reapply
    });
    game.settings.register(this.#namespace, this.#storage.applied, {
      scope: 'client', config: false, type: Object, default: {}
    });
  }

  /**
   * Wrap a lockable setting's onChange: a player's change to a locked setting is reverted to the GM's
   * value, and the GM's change to a soft or locked setting becomes the value players get.
   * @param {string} key
   * @param {Function} [onChange]
   * @returns {Function|undefined}
   */
  wrapOnChange(key, onChange) {
    if (!this.isLockable(key)) return onChange;
    const wrapped = (value, ...args) => {
      const locked = this.lockedValue(key);
      if (locked !== undefined && !SettingsLocks.#equal(locked, value)) {
        setTimeout(() => game.settings.set(this.#moduleId, key, locked), 0);
        return;
      }
      if (SettingsLocks.isGM()) {
        const state = this.getState(key);
        if (state === LOCK_STATES.SOFT || state === LOCK_STATES.LOCKED) {
          this.#writeValues({ ...this.#read('values'), [this.#id(key)]: value });
        }
      }
      return onChange?.(value, ...args);
    };
    wrapped[WRAPPED] = true;
    return wrapped;
  }

  /**
   * Wrap the onChange of lockable settings that are already registered, in place. A setting already
   * wrapped by any copy of the kit is left alone, so it is never reverted twice.
   * @param {string[]} [keys]  Defaults to every lockable key
   * @returns {string[]} The keys now wrapped by this instance
   */
  adopt(keys = this.keys) {
    const adopted = [];
    for (const key of keys) {
      const config = game.settings.settings?.get(`${this.#moduleId}.${key}`);
      if (!config || !this.isLockable(key) || SettingsLocks.isWrapped(config)) continue;
      config.onChange = this.wrapOnChange(key, config.onChange);
      adopted.push(key);
    }
    return adopted;
  }

  /**
   * Whether a registered setting's onChange is already wrapped by a copy of the kit.
   * @param {object} config
   * @returns {boolean}
   */
  static isWrapped(config) {
    return !!config?.onChange?.[WRAPPED];
  }

  /**
   * @param {string} key
   * @returns {string} One of LOCK_STATES
   */
  getState(key) {
    return this.#read('states')[this.#id(key)] ?? LOCK_STATES.UNLOCKED;
  }

  /**
   * The GM's value when the setting is locked for the current player (locked or gate). Never
   * applies to the GM, whose own setting is the value players get.
   * @param {string} key
   * @returns {*} The value, or undefined when the user is free to choose
   */
  lockedValue(key) {
    if (!this.isLockable(key) || SettingsLocks.isGM()) return undefined;
    const state = this.getState(key);
    if (state !== LOCK_STATES.LOCKED && state !== LOCK_STATES.GATE) return undefined;
    const values = this.#read('values');
    const id = this.#id(key);
    return id in values ? values[id] : undefined;
  }

  /**
   * Move a setting to its next state (GM only). A normal step cycles unlocked → soft → locked →
   * unlocked and snapshots the GM's current value; `gate` toggles between gate and locked.
   * Entering gate snapshots the GM's value; leaving it restores the GM's own setting to that value.
   * @param {string} key
   * @param {object} [options]
   * @param {boolean} [options.gate]  Toggle gate instead of cycling
   * @returns {Promise<{state: string, restored: *}>}  The new state, and the GM's restored value when gate was left
   */
  async cycle(key, { gate = false } = {}) {
    if (!SettingsLocks.isGM() || !this.isLockable(key)) return { state: this.getState(key), restored: undefined };
    const current = this.getState(key);
    const next = gate
      ? (current === LOCK_STATES.GATE ? LOCK_STATES.LOCKED : LOCK_STATES.GATE)
      : NEXT_STATE[current];
    const values = { ...this.#read('values') };
    const id = this.#id(key);
    let restored;

    if (next === LOCK_STATES.UNLOCKED) {
      delete values[id];
    } else if (current === LOCK_STATES.GATE && next === LOCK_STATES.LOCKED) {
      if (id in values) {
        restored = values[id];
        await game.settings.set(this.#moduleId, key, restored);
      }
    } else {
      values[id] = game.settings.get(this.#moduleId, key);
    }

    await this.#writeValues(values);
    const states = { ...this.#read('states'), [id]: next };
    if (next === LOCK_STATES.UNLOCKED) delete states[id];
    await game.settings.set(this.#namespace, this.#storage.states, states);
    return { state: next, restored };
  }

  /**
   * Write the GM's values into this client's settings: locked and gate values every time, soft
   * values once per GM value. Skipped for the GM, whose own settings are the source.
   * @returns {Promise<boolean>} Whether any setting changed
   */
  async apply() {
    if (SettingsLocks.isGM()) return false;
    const states = this.#read('states');
    const values = this.#read('values');
    const applied = { ...this.#read('applied') };
    let changed = false;
    let trackerChanged = false;

    for (const key of this.#keys) {
      const id = this.#id(key);
      const state = states[id] ?? LOCK_STATES.UNLOCKED;
      if (state === LOCK_STATES.UNLOCKED || !(id in values)) continue;
      const value = values[id];
      if (state === LOCK_STATES.SOFT) {
        if (id in applied && SettingsLocks.#equal(applied[id], value)) continue;
        applied[id] = value;
        trackerChanged = true;
      }
      try {
        if (!SettingsLocks.#equal(game.settings.get(this.#moduleId, key), value)) {
          await game.settings.set(this.#moduleId, key, value);
          changed = true;
        }
      } catch (err) {
        console.warn(`${this.#moduleId} | Could not apply GM setting ${key}:`, err);
      }
    }

    if (trackerChanged) await game.settings.set(this.#namespace, this.#storage.applied, applied);
    return changed;
  }

  /**
   * @param {'states'|'values'|'applied'} store
   * @returns {object}
   */
  #read(store) {
    try {
      return game.settings.get(this.#namespace, this.#storage[store]) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * @param {object} values
   */
  async #writeValues(values) {
    if (SettingsLocks.#equal(values, this.#read('values'))) return;
    await game.settings.set(this.#namespace, this.#storage.values, values);
  }

  /**
   * @param {string} key
   * @returns {string} The key as stored in the lock maps
   */
  #id(key) {
    return `${this.#prefix}${key}`;
  }

  static #equal(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
