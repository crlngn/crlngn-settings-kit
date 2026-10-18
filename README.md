# Carolingian Settings Kit

GM locks on a Foundry VTT module's client settings, shared by Carolingian modules (Swipe first; Carolingian UI, Flash Rolls and Flash Token Bar to follow). It's bundled into each module at build time, so users don't install anything extra.

## Lock states

| State | GM icon | Players |
|---|---|---|
| Unlocked | `fa-lock-keyhole-open` | Choose freely, no icon |
| Soft | `fa-unlock-keyhole` | Get the GM's value once (again whenever the GM changes it), then may change it |
| Locked | `fa-lock` | Always get the GM's value; their change is reverted and the field is disabled |
| Gate | `fa-dungeon` | Like locked, while the GM keeps their own value |

In the settings form the GM clicks the icon to cycle unlocked → soft → locked → unlocked, and right-clicks or Alt+clicks to toggle gate. Locks never apply to the GM: the GM's own value is what players get (in gate, the value the GM had when they entered gate).

## Install

```json
"dependencies": {
  "@crlngn/settings-kit": "github:crlngn/crlngn-settings-kit#v0.2.0"
}
```

Pin a tag so module releases build from a known version.

## Use

```js
import { SettingsLocks, LockIcons } from '@crlngn/settings-kit';

const locks = new SettingsLocks({ moduleId: 'my-module', keys: ['keepAwake', 'chatDelay'] });

// init: wrap each lockable setting's onChange, then register the kit's own storage and apply
for (const [key, config] of Object.entries(definitions)) {
  game.settings.register('my-module', key, { ...config, onChange: locks.wrapOnChange(key, config.onChange) });
}
locks.registerSettings();
locks.apply();

// reading: a locked value wins over the user's own (it's also written into the user's setting on load)
const value = locks.lockedValue(key) ?? game.settings.get('my-module', key);

// settings form (ApplicationV2 _onRender)
LockIcons.render(this.element, locks, {
  scope: '#my-module-settings',
  titles: { toggle: game.i18n.localize('MY_MODULE.Locks.Toggle'), locked: game.i18n.localize('MY_MODULE.Locks.Locked') },
  fieldKeys: { formFieldName: 'settingKey' },   // only where a field's name differs from its setting key
  skipSelector: '.my-per-player-lock'           // labels already showing a lock get no second one
});
```

`apply()` can run during `init`: world settings are readable then, and `SettingsLocks.isGM()` falls back to the raw user data before `game.user` exists.

A module with its own per-player layer resolves it around the kit. Swipe checks, in order: the GM's per-player forced override, `locks.lockedValue(key)`, the per-player soft override, then the user's value.

### Options

- `keys`: the lockable setting keys. Only client- or user-scoped settings make sense; leave out settings that change themselves (e.g. ones following the screen size).
- `namespace` and `prefix`: keep the storage under another module, with the keys prefixed (what `LockHost` does).
- `storage`: keys for the kit's settings, defaulting to `{ states: 'lockStates', values: 'lockValues', applied: 'lockAppliedSoftValues' }`. A module moving from its own lock system can pass its existing keys to keep worlds' locks (Carolingian UI: `v2-setting-enforcement`, `v2-default-settings`).

### Storage

| Setting | Scope | Shape |
|---|---|---|
| `states` | world | `{ [key]: 'unlocked' \| 'soft' \| 'locked' \| 'gate' }` |
| `values` | world | `{ [key]: value }`, the GM's value for each soft, locked or gate setting |
| `applied` | client | `{ [key]: value }`, soft values this device already applied |

## Lock host

`LockHost` lets one module keep locks for other modules, stored in its own world settings as `{ "<module id>.<key>": ... }`. Carolingian UI is the host: modules use its locks without bundling the kit, and an opt-in setting adds the locks to other modules' settings in Foundry's Configure Settings.

```js
import { LockHost } from '@crlngn/settings-kit';

const host = new LockHost({ hostId: 'crlngn-ui' });
host.registerSettings();                                       // init
host.watchSettingsConfig({ titles });                          // icons in Configure Settings
Hooks.once('setup', () => {
  if (optedIn) host.lockConfigSettings({ exclude: [] });      // other modules' config: true client and user settings
});
Hooks.once('ready', () => host.apply());

const locks = host.register('guest-module', ['compact']);     // a guest's own settings, for its custom menu
```

- `register(moduleId, keys)` wraps the onChange of settings already registered in place (`adopt`); for a setting registered later, use `locks.wrapOnChange`. Registering again adds keys.
- `lockConfigSettings` skips the host, excluded modules, world settings, and any setting whose onChange a copy of the kit already wraps, so a module locking its own settings is never locked twice. `{ system: true }` includes the game system's settings, and `{ core: true }` includes Foundry core's.
- `LockIcons.render(root, locks, { fieldPrefix: 'guest-module.' })` matches fields named `<module id>.<key>`, as in Configure Settings. Several modules' locks can share a form.

Changing a locked setting through the API still reverts for players. A setting that needs a reload gets the GM's value straight away, and it takes effect on the player's next reload (no prompt is shown).

## Translations

Foundry loads language files per module, so the kit has no strings of its own: the host passes the two tooltips to `LockIcons.render` (English defaults otherwise).

## Tests

```bash
npm test
```
