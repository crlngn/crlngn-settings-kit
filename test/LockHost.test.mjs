import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockHost, LockIcons, SettingsLocks, LOCK_STATES } from '../src/index.mjs';
import { installDocument, makeForm, iconOf, click } from './fakeDom.mjs';

globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 } };
globalThis.Hooks = { on() {} };

const HOST = 'crlngn-ui';
const GUEST = 'guest-module';
let world;

/**
 * A minimal Foundry `game` for one client, with settings keyed "<namespace>.<key>" like Foundry's
 * own registry. World settings are shared through `world`.
 */
function makeGame(isGM) {
  const settings = new Map();
  const client = new Map();
  const storeFor = id => (settings.get(id).scope === 'world' ? world : client);
  return {
    ready: false,
    userId: 'user',
    user: { isGM },
    system: { id: 'dnd5e' },
    modules: new Map([[HOST, { active: true }], [GUEST, { active: true }], ['native', { active: true }]]),
    settings: {
      settings,
      register(namespace, key, config) { settings.set(`${namespace}.${key}`, { ...config, namespace, key }); },
      get(namespace, key) {
        const id = `${namespace}.${key}`;
        const store = storeFor(id);
        return structuredClone(store.has(id) ? store.get(id) : settings.get(id).default);
      },
      async set(namespace, key, value) {
        const id = `${namespace}.${key}`;
        storeFor(id).set(id, structuredClone(value));
        settings.get(id).onChange?.(value);
      }
    }
  };
}

/** Boot a client: a guest with a config:true and a menu setting, a module locking its own setting, and the host */
function boot(isGM) {
  const game = makeGame(isGM);
  globalThis.game = game;
  const calls = [];
  game.settings.register(GUEST, 'compact', { scope: 'client', config: true, default: false, onChange: v => calls.push(v) });
  game.settings.register(GUEST, 'menuOnly', { scope: 'client', config: false, default: 1 });
  game.settings.register(GUEST, 'worldThing', { scope: 'world', config: true, default: 'a' });
  game.settings.register('core', 'fontSize', { scope: 'client', config: true, default: 5 });
  const native = new SettingsLocks({ moduleId: 'native', keys: ['own'] });
  game.settings.register('native', 'own', { scope: 'client', config: true, default: 0, onChange: native.wrapOnChange('own') });
  const host = new LockHost({ hostId: HOST });
  host.registerSettings();
  return { game, host, calls };
}

const as = (client, fn) => { globalThis.game = client.game; return fn(client); };
const ready = client => { client.game.ready = true; };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

beforeEach(() => {
  world = new Map();
});

test('lockConfigSettings adopts only other modules\' config:true client settings', () => {
  const gm = boot(true);
  const found = gm.host.lockConfigSettings();
  assert.deepEqual(found, { [GUEST]: ['compact'] });
  assert.ok(SettingsLocks.isWrapped(gm.game.settings.settings.get(`${GUEST}.compact`)));
});

test('locks are stored under the host, keyed by module', async () => {
  const gm = boot(true);
  gm.host.lockConfigSettings();
  ready(gm);
  await gm.game.settings.set(GUEST, 'compact', true);
  await gm.host.get(GUEST).cycle('compact');
  await gm.host.get(GUEST).cycle('compact');
  assert.equal(world.get(`${HOST}.guestLockStates`)[`${GUEST}.compact`], LOCK_STATES.LOCKED);
  assert.equal(world.get(`${HOST}.guestLockValues`)[`${GUEST}.compact`], true);
});

test('a locked adopted setting is applied to players and their changes revert', async () => {
  const gm = boot(true);
  gm.host.lockConfigSettings();
  ready(gm);
  await gm.game.settings.set(GUEST, 'compact', true);
  await gm.host.get(GUEST).cycle('compact');
  await gm.host.get(GUEST).cycle('compact');

  const player = boot(false);
  player.host.lockConfigSettings();
  ready(player);
  await as(player, p => p.host.apply());
  assert.equal(player.game.settings.get(GUEST, 'compact'), true);
  assert.deepEqual(player.calls, [true]);

  await as(player, p => p.game.settings.set(GUEST, 'compact', false));
  await tick();
  assert.equal(player.game.settings.get(GUEST, 'compact'), true);
});

test('a guest registers its menu settings through the host', async () => {
  const gm = boot(true);
  const locks = gm.host.register(GUEST, ['menuOnly']);
  ready(gm);
  await gm.game.settings.set(GUEST, 'menuOnly', 3);
  await locks.cycle('menuOnly');

  const player = boot(false);
  player.host.register(GUEST, ['menuOnly']);
  ready(player);
  await as(player, p => p.host.apply());
  assert.equal(player.game.settings.get(GUEST, 'menuOnly'), 3);
  await as(player, p => p.game.settings.set(GUEST, 'menuOnly', 9));
  assert.equal(player.game.settings.get(GUEST, 'menuOnly'), 9);
});

test('registering again adds keys without wrapping twice', () => {
  const gm = boot(true);
  gm.host.register(GUEST, ['menuOnly']);
  const first = gm.game.settings.settings.get(`${GUEST}.menuOnly`).onChange;
  const locks = gm.host.register(GUEST, ['compact']);
  assert.deepEqual(locks.keys.sort(), ['compact', 'menuOnly']);
  assert.equal(gm.game.settings.settings.get(`${GUEST}.menuOnly`).onChange, first);
  assert.deepEqual(gm.host.lockConfigSettings(), { [GUEST]: ['compact'] });
});

test('excluded modules are left alone', () => {
  const gm = boot(true);
  assert.deepEqual(gm.host.lockConfigSettings({ exclude: [GUEST] }), {});
});

test('core settings are adopted only with core: true', () => {
  const gm = boot(true);
  assert.deepEqual(gm.host.lockConfigSettings({ core: true }), { [GUEST]: ['compact'], core: ['fontSize'] });
  assert.ok(SettingsLocks.isWrapped(gm.game.settings.settings.get('core.fontSize')));
});

test('user-scoped settings are adopted like client ones', () => {
  const gm = boot(true);
  gm.game.settings.register(GUEST, 'perUser', { scope: 'user', config: true, default: 'a' });
  assert.deepEqual(gm.host.lockConfigSettings(), { [GUEST]: ['compact', 'perUser'] });
});

test('going back to unlocked removes the key from both maps', async () => {
  const gm = boot(true);
  gm.host.lockConfigSettings();
  ready(gm);
  const locks = gm.host.get(GUEST);
  await locks.cycle('compact');
  await locks.cycle('compact');
  assert.equal((await locks.cycle('compact')).state, LOCK_STATES.UNLOCKED);
  assert.ok(!(`${GUEST}.compact` in world.get(`${HOST}.guestLockStates`)));
  assert.ok(!(`${GUEST}.compact` in world.get(`${HOST}.guestLockValues`)));
  assert.equal(locks.getState('compact'), LOCK_STATES.UNLOCKED);
});

test('render draws every guest in one pass, with one style tag and one listener pair per form', () => {
  const head = installDocument();
  const gm = boot(true);
  gm.host.lockConfigSettings({ core: true });
  ready(gm);
  const form = makeForm([`${GUEST}.compact`, 'core.fontSize', `${GUEST}.worldThing`, 'native.own', 'plain']);
  gm.host.render(form, { scope: '#settings-config', namespaced: true });
  assert.equal(form.scans, 1);
  assert.equal(iconOf(form, `${GUEST}.compact`)?.dataset.module, GUEST);
  assert.equal(iconOf(form, 'core.fontSize')?.dataset.module, 'core');
  assert.equal(iconOf(form, `${GUEST}.worldThing`), null);
  assert.equal(iconOf(form, 'native.own'), null);
  assert.equal(iconOf(form, 'plain'), null);

  gm.host.render(form, { scope: '#settings-config', namespaced: true });
  assert.equal(form.scans, 2);
  assert.equal(head.styles.length, 1);
  assert.deepEqual(form.listeners.map(l => l.type), ['click', 'contextmenu']);
});

test('a click cycles the lock of the clicked icon\'s module only', async () => {
  installDocument();
  const gm = boot(true);
  gm.host.lockConfigSettings({ core: true });
  ready(gm);
  const form = makeForm([`${GUEST}.compact`, 'core.fontSize']);
  gm.host.render(form, { scope: '#settings-config', namespaced: true });
  const icon = iconOf(form, 'core.fontSize');
  await click(form, icon);
  assert.equal(icon.dataset.state, LOCK_STATES.SOFT);
  assert.equal(gm.host.get('core').getState('fontSize'), LOCK_STATES.SOFT);
  assert.equal(gm.host.get(GUEST).getState('compact'), LOCK_STATES.UNLOCKED);
});

test('a player sees a lock and disabled field on locked settings only', async () => {
  installDocument();
  const gm = boot(true);
  gm.host.lockConfigSettings();
  ready(gm);
  await gm.game.settings.set(GUEST, 'compact', true);
  await gm.host.get(GUEST).cycle('compact');
  await gm.host.get(GUEST).cycle('compact');

  const player = boot(false);
  player.host.lockConfigSettings({ core: true });
  ready(player);
  const form = makeForm([`${GUEST}.compact`, 'core.fontSize']);
  player.host.render(form, { scope: '#settings-config', namespaced: true });
  assert.ok(iconOf(form, `${GUEST}.compact`)?.classList.contains('sk-locked'));
  assert.equal(form.groups[0].input.disabled, true);
  assert.equal(iconOf(form, 'core.fontSize'), null);
  assert.equal(form.listeners.length, 0);
});

test('locks of a module that is turned off are kept but not enforced or drawn', async () => {
  installDocument();
  world.set(`${HOST}.guestLockStates`, { 'sleeper.opt': LOCK_STATES.LOCKED });
  world.set(`${HOST}.guestLockValues`, { 'sleeper.opt': 9 });

  const player = boot(false);
  player.game.modules.set('sleeper', { active: false });
  player.game.settings.register('sleeper', 'opt', { scope: 'client', config: false, default: 1 });
  player.host.register('sleeper', ['opt']);
  ready(player);
  await player.host.apply();
  assert.equal(player.game.settings.get('sleeper', 'opt'), 1);

  const form = makeForm(['sleeper.opt']);
  player.host.render(form, { scope: '#settings-config', namespaced: true });
  assert.equal(iconOf(form, 'sleeper.opt'), null);
  assert.equal(form.scans, 0);

  player.game.modules.set('sleeper', { active: true });
  await player.host.apply();
  assert.equal(player.game.settings.get('sleeper', 'opt'), 9);
  assert.deepEqual(world.get(`${HOST}.guestLockStates`), { 'sleeper.opt': LOCK_STATES.LOCKED });
});

test('LockIcons.render keeps working for a guest drawing its own form', () => {
  const head = installDocument();
  const gm = boot(true);
  const locks = gm.host.register(GUEST, ['menuOnly']);
  ready(gm);
  const form = makeForm(['menuOnly', 'other']);
  LockIcons.render(form, locks, { scope: '#guest-menu' });
  assert.equal(iconOf(form, 'menuOnly')?.dataset.key, 'menuOnly');
  assert.equal(iconOf(form, 'other'), null);
  assert.equal(head.styles[0].id, 'settings-kit-locks-_guest-menu');
});
