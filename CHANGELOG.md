# Changelog

## [0.3.0] - 2026-10-18

### Added

- `LockHost.lockConfigSettings({ core: true })` adopts Foundry core's client settings too.
- `LockIcons.renderAll(root, locksList)` draws several modules' locks in one pass over a form; `LockHost.render` and `watchSettingsConfig` use it.

### Changed

- `lockConfigSettings` adopts user-scoped settings (Foundry v13+) as well as client-scoped ones.
- `LockHost.apply` and `render` only act on core, the game system and active modules; locks kept for a module that is turned off stay stored and apply again once it is back on.
- Setting a lock back to unlocked removes its key from the stored states.
- `LockIcons` injects one style tag per scope (was one per module) and binds one click listener per form.

## [0.2.0] - 2026-10-18

### Added

- `LockHost`: one module keeps locks for other modules' settings in its own world settings. Guests register their keys (`register`), and `lockConfigSettings` with `watchSettingsConfig` adds locks to other modules' settings in Configure Settings.

## [0.1.0] - 2026-10-06

### Added

- `SettingsLocks`: GM locks on a module's client settings, in four states (unlocked, soft, locked, gate), with the GM's values kept in world settings, applied on players' clients at init and whenever the GM changes a lock, and a player's change to a locked setting reverted.
- `LockIcons`: the GM's cycling lock icon beside each lockable field in a settings form (click; right-click or Alt+click for gate) and the players' lock icon, which disables the field. Styles are scoped to the host's settings window.
- First used by Swipe; extracted from `swipe-vtt-dev/src/settings-kit/`.
