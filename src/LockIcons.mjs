/**
 * Lock Icons
 *
 * Adds SettingsLocks icons to a rendered settings form. Each lockable field (matched by its input's
 * `name`) gets an icon at the start of its `.form-group` label:
 * - GM: a clickable icon showing the state; click cycles unlocked → soft → locked, Alt+click or
 *   right-click toggles gate (locked for players, GM keeps their own value).
 * - Player: a lock icon on fields locked for them, whose inputs are disabled.
 * Styles are injected once per scope selector, so modules bundling their own copy don't clash.
 * Several modules' locks can render into the same form; each handles clicks on its own icons only.
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
    if (!root) return;
    titles = { ...DEFAULT_TITLES, ...titles };
    LockIcons.#injectStyles(scope, locks.moduleId);
    const isGM = SettingsLocks.isGM();
    const seen = new Set();

    for (const input of root.querySelectorAll(FIELDS)) {
      const name = input.getAttribute('name');
      if (seen.has(name)) continue;
      seen.add(name);
      if (fieldPrefix && !(name in fieldKeys) && !name.startsWith(fieldPrefix)) continue;
      const key = fieldKeys[name] ?? name.slice(fieldPrefix.length);
      if (!locks.isLockable(key)) continue;
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

    const bound = (root.dataset.skLocks ?? '').split(' ');
    if (isGM && !bound.includes(locks.moduleId)) {
      root.dataset.skLocks = [...bound.filter(Boolean), locks.moduleId].join(' ');
      const onToggle = event => LockIcons.#onToggle(event, locks);
      root.addEventListener('click', onToggle);
      root.addEventListener('contextmenu', onToggle);
    }
  }

  /**
   * Cycle (click) or toggle gate (Alt+click / right-click) for the clicked icon. When leaving gate
   * restores the GM's own value, the field shows it.
   * @param {MouseEvent} event
   * @param {SettingsLocks} locks
   */
  static async #onToggle(event, locks) {
    const icon = event.target.closest?.('.sk-lock-toggle');
    if (!icon || icon.dataset.module !== locks.moduleId) return;
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
   * @param {string} moduleId
   */
  static #injectStyles(scope, moduleId) {
    const id = `settings-kit-locks-${moduleId}`;
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
