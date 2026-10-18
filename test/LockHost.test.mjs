import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockHost, SettingsLocks, LOCK_STATES } from '../src/index.mjs';

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
