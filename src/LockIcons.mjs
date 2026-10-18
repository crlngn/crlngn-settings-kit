/**
 * Lock Icons
 *
 * Adds SettingsLocks icons to a rendered settings form. Each lockable field (matched by its input's
 * `name`) gets an icon at the start of its `.form-group` label:
 * - GM: a clickable icon showing the state; click cycles unlocked → soft → locked, Alt+click or
 *   right-click toggles gate (locked for players, GM keeps their own value).
 * - Player: a lock icon on fields locked for them, whose inputs are disabled.
 * `renderAll` draws several modules' locks in one pass over the form (e.g. Configure Settings, with
 * fields named "<module id>.<key>"). Styles are injected once per scope selector, and each form gets
 * one click listener per copy of the kit, which handles only the icons of the locks it rendered, so
 * modules bundling their own copy don't clash.
 */

import { LOCK_STATES, SettingsLocks } from './SettingsLocks.mjs';

const STATE_ICONS = {
  [LOCK_STATES.UNLOCKED]: 'fa-lock-keyhole-open',
  [LOCK_STATES.SOFT]: 'fa-unlock-keyhole',
  [LOCK_STATES.LOCKED]: 'fa-lock',
  [LOCK_STATES.GATE]: 'fa-dungeon'
};

const FIELDS = 'input[name], select[name], textarea[name], range-picker[name], color-picker[name], file-picker[name], multi-select[name], string-tags[name]';
const CONTROLS = 'input, select, textarea, button, range-picker, color-picker, file-picker, multi-select, string-tags';

const BOUND = new WeakMap();

const DEFAULT_TITLES = {
  toggle: 'Click to cycle the lock for players. Right-click (or Alt+Click) to lock it for players only',
  locked: 'Locked by the GM'
};

export class LockIcons {
  /**
   * @param {HTMLElement} root                    The rendered settings form
   * @param {SettingsLocks} locks
   * @param {object} [options]
   * @param {string} [options.scope]               CSS selector of the settings window, scopes the styles
   * @param {{toggle: string, locked: string}} [options.titles]  Tooltips for the GM icon and the player lock
   * @param {Record<string, string>} [options.fieldKeys]       Form field name → setting key, where they differ
   * @param {string} [options.fieldPrefix]         Prefix of the field names to strip (e.g. "my-module." in Configure Settings); other fields are skipped
   * @param {string} [options.skipSelector]        A label already showing this (e.g. a per-player lock) gets no player icon
   */
  static render(root, locks, { scope = '', titles = {}, fieldKeys = {}, fieldPrefix = '', skipSelector = null } = {}) {
    const resolve = name => {
      if (fieldPrefix && !(name in fieldKeys) && !name.startsWith(fieldPrefix)) return null;
      const key = fieldKeys[name] ?? name.slice(fieldPrefix.length);
      return locks.isLockable(key) ? { locks, key } : null;
    };
    LockIcons.#draw(root, [locks], resolve, { scope, titles, skipSelector });
  }

  /**
   * Draw the icons of several modules' locks in a single pass over the form.
   * @param {HTMLElement} root
   * @param {SettingsLocks[]} locksList
   * @param {object} [options]
   * @param {string} [options.scope]
   * @param {{toggle: string, locked: string}} [options.titles]
   * @param {boolean} [options.namespaced]  Field names are "<module id>.<key>", as in Configure Settings
   * @param {string} [options.skipSelector]
   */
  static renderAll(root, locksList, { scope = '', titles = {}, namespaced = true, skipSelector = null } = {}) {
    const byModule = new Map(locksList.map(locks => [locks.moduleId, locks]));
    const resolve = namespaced
      ? name => {
        const dot = name.indexOf('.');
        if (dot < 1) return null;
        const locks = byModule.get(name.slice(0, dot));
        const key = name.slice(dot + 1);
        return locks?.isLockable(key) ? { locks, key } : null;
      }
      : name => {
        const locks = locksList.find(l => l.isLockable(name));
        return locks ? { locks, key: name } : null;
      };
    LockIcons.#draw(root, locksList, resolve, { scope, titles, skipSelector });
  }

  /**
   * @param {HTMLElement} root
   * @param {SettingsLocks[]} locksList
   * @param {(name: string) => ({locks: SettingsLocks, key: string}|null)} resolve
   * @param {object} options
   */
  static #draw(root, locksList, resolve, { scope, titles, skipSelector }) {
    if (!root || !locksList.length) return;
    titles = { ...DEFAULT_TITLES, ...titles };
    LockIcons.#injectStyles(scope);
    const isGM = SettingsLocks.isGM();
    const seen = new Set();

    for (const input of root.querySelectorAll(FIELDS)) {
      const name = input.getAttribute('name');
      if (seen.has(name)) continue;
      seen.add(name);
      const match = resolve(name);
      if (!match) continue;
      const { locks, key } = match;
      const group = input.closest('.form-group');
      const label = group?.querySelector('label');
      if (!label || label.querySelector('.sk-lock')) continue;

      if (isGM) {
        const state = locks.getState(key);
        const icon = document.createElement('i');
        icon.className = `fas sk-lock sk-lock-toggle ${STATE_ICONS[state]}`;
        icon.dataset.key = key;
        icon.dataset.module = locks.moduleId;
        icon.dataset.state = state;
        icon.dataset.tooltip = titles.toggle;
        label.prepend(icon);
      } else if (locks.lockedValue(key) !== undefined) {
        group.classList.add('sk-locked-group');
        group.querySelectorAll(CONTROLS).forEach(el => { el.disabled = true; });
        if (skipSelector && label.querySelector(skipSelector)) continue;
        const icon = document.createElement('i');
        icon.className = 'fas fa-lock sk-lock sk-locked';
        icon.dataset.tooltip = titles.locked;
        label.prepend(icon);
      }
    }

    if (isGM) LockIcons.#bind(root, locksList);
  }

  /**
   * One click and one contextmenu listener per form, resolving the clicked icon's module among the
   * locks this copy of the kit rendered there.
   * @param {HTMLElement} root
   * @param {SettingsLocks[]} locksList
   */
  static #bind(root, locksList) {
    let byModule = BOUND.get(root);
    if (!byModule) {
      byModule = new Map();
      BOUND.set(root, byModule);
      const onToggle = event => LockIcons.#onToggle(event, byModule);
      root.addEventListener('click', onToggle);
      root.addEventListener('contextmenu', onToggle);
    }
    for (const locks of locksList) byModule.set(locks.moduleId, locks);
  }

  /**
   * Cycle (click) or toggle gate (Alt+click / right-click) for the clicked icon. When leaving gate
   * restores the GM's own value, the field shows it.
   * @param {MouseEvent} event
   * @param {Map<string, SettingsLocks>} byModule
   */
  static async #onToggle(event, byModule) {
    const icon = event.target.closest?.('.sk-lock-toggle');
    const locks = icon && byModule.get(icon.dataset.module);
    if (!locks) return;
    event.preventDefault();
    event.stopPropagation();
    const gate = event.type === 'contextmenu' || event.altKey;
    const { state, restored } = await locks.cycle(icon.dataset.key, { gate });
    icon.classList.remove(...Object.values(STATE_ICONS));
    icon.classList.add(STATE_ICONS[state]);
    icon.dataset.state = state;
    if (restored !== undefined) LockIcons.#showValue(icon.closest('.form-group'), restored);
  }

  /**
   * @param {HTMLElement} group
   * @param {*} value
   */
  static #showValue(group, value) {
    group?.querySelectorAll('input, select').forEach(el => {
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    });
  }

  /**
   * @param {string} scope
   */
  static #injectStyles(scope) {
    const id = `settings-kit-locks${scope ? `-${scope.replace(/[^\w-]/g, '_')}` : ''}`;
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      ${scope} .sk-lock { margin-right: 0.5rem; font-size: 0.9em; letter-spacing: normal; }
      ${scope} .sk-lock-toggle { cursor: pointer; opacity: 0.7; transition: opacity 0.2s ease; }
      ${scope} .sk-lock-toggle:hover { opacity: 1; }
      ${scope} .sk-locked { opacity: 0.6; cursor: help; }
    `;
    document.head.appendChild(style);
  }
}
