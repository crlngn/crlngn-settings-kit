import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsLocks, LOCK_STATES } from '../src/index.mjs';

globalThis.CONST = { USER_ROLES: { ASSISTANT: 3 } };

const MODULE = 'test-module';
const KEYS = ['keepAwake', 'chatDelay'];
let world;

/**
 * A minimal Foundry `game` for one client: world settings are shared through `world`, client
 * settings are this client's own. `set` calls the setting's onChange like Foundry does.
 */
function makeGame(isGM) {
  const defs = new Map();
  const client = new Map();
  const storeFor = key => (defs.get(key).scope === 'world' ? world : client);
  return {
    ready: true,
    userId: 'user',
    user: { isGM },
    settings: {
      register(_module, key, config) { defs.set(key, config); },
      get(_module, key) {
        const store = storeFor(key);
        return structuredClone(store.has(key) ? store.get(key) : defs.get(key).default);
      },
      async set(_module, key, value) {
        storeFor(key).set(key, structuredClone(value));
        defs.get(key).onChange?.(value);
      }
    }
  };
}

/** Boot a client: register two lockable settings and the kit's storage */
function boot(isGM) {
  const game = makeGame(isGM);
  globalThis.game = game;
  const locks = new SettingsLocks({ moduleId: MODULE, keys: KEYS });
  game.settings.register(MODULE, 'keepAwake', { scope: 'client', default: true, onChange: locks.wrapOnChange('keepAwake') });
  game.settings.register(MODULE, 'chatDelay', { scope: 'client', default: 5, onChange: locks.wrapOnChange('chatDelay') });
  locks.registerSettings();
  return { game, locks };
}

/** Run `fn` as the given client */
async function as(client, fn) {
  globalThis.game = client.game;
  return fn(client);
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

beforeEach(() => {
  world = new Map();
});

test('soft: applied once, then the player may change it', async () => {
  const gm = boot(true);
  await as(gm, async ({ game, locks }) => {
    await game.settings.set(MODULE, 'keepAwake', false);
    assert.equal((await locks.cycle('keepAwake')).state, LOCK_STATES.SOFT);
  });
  const player = boot(false);
  await as(player, async ({ game, locks }) => {
    await locks.apply();
    assert.equal(game.settings.get(MODULE, 'keepAwake'), false);
    await game.settings.set(MODULE, 'keepAwake', true);
    await tick();
    assert.equal(game.settings.get(MODULE, 'keepAwake'), true);
    await locks.apply();
    assert.equal(game.settings.get(MODULE, 'keepAwake'), true, 'not re-applied for the same GM value');
  });
  await as(gm, ({ game }) => game.settings.set(MODULE, 'keepAwake', true));
  await as(player, async ({ game, locks }) => {
    await game.settings.set(MODULE, 'keepAwake', false);
    await locks.apply();
    assert.equal(game.settings.get(MODULE, 'keepAwake'), true, 're-applied once the GM picks a new value');
  });
});

test('locked: player gets the GM value and a change is reverted; the GM is never locked', async () => {
  const gm = boot(true);
  await as(gm, async ({ game, locks }) => {
    await game.settings.set(MODULE, 'chatDelay', 9);
    await locks.cycle('chatDelay');
    assert.equal((await locks.cycle('chatDelay')).state, LOCK_STATES.LOCKED);
    assert.equal(locks.lockedValue('chatDelay'), undefined);
    await game.settings.set(MODULE, 'chatDelay', 12);
    assert.equal(game.settings.get(MODULE, 'chatDelay'), 12, 'GM change kept');
  });
  const player = boot(false);
  await as(player, async ({ game, locks }) => {
    await locks.apply();
    assert.equal(game.settings.get(MODULE, 'chatDelay'), 12);
    assert.equal(locks.lockedValue('chatDelay'), 12);
    await game.settings.set(MODULE, 'chatDelay', 3);
    await tick();
    assert.equal(game.settings.get(MODULE, 'chatDelay'), 12, 'player change reverted');
  });
});

test('gate: locked for players while the GM keeps their own value; leaving it restores the GM', async () => {
  const gm = boot(true);
  const player = boot(false);
  await as(gm, async ({ game, locks }) => {
    await game.settings.set(MODULE, 'keepAwake', true);
    assert.equal((await locks.cycle('keepAwake', { gate: true })).state, LOCK_STATES.GATE);
    await game.settings.set(MODULE, 'keepAwake', false);
    assert.equal(locks.lockedValue('keepAwake'), undefined);
  });
  await as(player, ({ locks }) => assert.equal(locks.lockedValue('keepAwake'), true));
  await as(gm, async ({ game, locks }) => {
    const { state, restored } = await locks.cycle('keepAwake', { gate: true });
    assert.equal(state, LOCK_STATES.LOCKED);
    assert.equal(restored, true);
    assert.equal(game.settings.get(MODULE, 'keepAwake'), true);
  });
});

test('unlocking clears the GM value and frees players', async () => {
  const gm = boot(true);
  await as(gm, async ({ locks }) => {
    await locks.cycle('keepAwake');
    await locks.cycle('keepAwake');
    assert.equal((await locks.cycle('keepAwake')).state, LOCK_STATES.UNLOCKED);
  });
  const player = boot(false);
  await as(player, ({ locks }) => assert.equal(locks.lockedValue('keepAwake'), undefined));
});

test('only GMs can cycle, and only lockable keys', async () => {
  const player = boot(false);
  await as(player, async ({ locks }) => {
    assert.equal((await locks.cycle('keepAwake')).state, LOCK_STATES.UNLOCKED);
  });
  const gm = boot(true);
  await as(gm, async ({ locks }) => {
    assert.equal((await locks.cycle('notLockable')).state, LOCK_STATES.UNLOCKED);
    assert.equal(locks.wrapOnChange('notLockable', undefined), undefined);
  });
});

test('isGM falls back to the raw user data during init', () => {
  globalThis.game = { data: { users: [{ _id: 'gm', role: 4 }, { _id: 'p', role: 1 }] }, userId: 'gm' };
  assert.equal(SettingsLocks.isGM(), true);
  globalThis.game.userId = 'p';
  assert.equal(SettingsLocks.isGM(), false);
});

test('custom storage keys', async () => {
  const game = makeGame(true);
  globalThis.game = game;
  const locks = new SettingsLocks({ moduleId: MODULE, keys: KEYS, storage: { states: 'v2-setting-enforcement' } });
  game.settings.register(MODULE, 'keepAwake', { scope: 'client', default: true, onChange: locks.wrapOnChange('keepAwake') });
  locks.registerSettings();
  await locks.cycle('keepAwake');
  assert.deepEqual(world.get('v2-setting-enforcement'), { keepAwake: LOCK_STATES.SOFT });
});
