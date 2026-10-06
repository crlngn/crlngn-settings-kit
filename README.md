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
  "@crlngn/settings-kit": "github:crlngn/crlngn-settings-kit#v0.1.0"
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

- `keys`: the lockable setting keys. Only client-scoped settings make sense; leave out settings that change themselves (e.g. ones following the screen size).
- `storage`: keys for the kit's settings, defaulting to `{ states: 'lockStates', values: 'lockValues', applied: 'lockAppliedSoftValues' }`. A module moving from its own lock system can pass its existing keys to keep worlds' locks (Carolingian UI: `v2-setting-enforcement`, `v2-default-settings`).

### Storage

| Setting | Scope | Shape |
|---|---|---|
| `states` | world | `{ [key]: 'unlocked' \| 'soft' \| 'locked' \| 'gate' }` |
| `values` | world | `{ [key]: value }`, the GM's value for each soft, locked or gate setting |
| `applied` | client | `{ [key]: value }`, soft values this device already applied |

## Translations

Foundry loads language files per module, so the kit has no strings of its own: the host passes the two tooltips to `LockIcons.render`.

## Tests

```bash
npm test
```
