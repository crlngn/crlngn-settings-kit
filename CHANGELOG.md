# Changelog

## [0.1.0] - 2026-10-06

### Added

- `SettingsLocks`: GM locks on a module's client settings, in four states (unlocked, soft, locked, gate), with the GM's values kept in world settings, applied on players' clients at init and whenever the GM changes a lock, and a player's change to a locked setting reverted.
- `LockIcons`: the GM's cycling lock icon beside each lockable field in a settings form (click; right-click or Alt+click for gate) and the players' lock icon, which disables the field. Styles are scoped to the host's settings window.
- First used by Swipe; extracted from `swipe-vtt-dev/src/settings-kit/`.
