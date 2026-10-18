/**
 * Carolingian settings kit: GM locks on client settings (see SettingsLocks), their icons in a
 * settings form (see LockIcons), and a host that keeps locks for other modules (see LockHost).
 * Bundled into each host module; imports nothing from them.
 */

export { SettingsLocks, LOCK_STATES } from './SettingsLocks.mjs';
export { LockIcons } from './LockIcons.mjs';
export { LockHost } from './LockHost.mjs';
