// The fork ships its own 1.0.x package line, but its settings schema is the
// upstream 1.18.0-beta2 schema. These helpers keep the two versions separate so
// a fork build can never be mistaken for an upstream downgrade.

const CURRENT_SCHEMA_VERSION = "v1.18.0-beta2"

// Only the fork's package-line versions are ambiguous. Newer upstream schemas and
// future schema versions must still go through the normal migration path.
const FORK_VERSION_PATTERN = /^v1\.0\.\d+(?:[-+].*)?$/

function isForkSettingsVersion(version) {
  return FORK_VERSION_PATTERN.test(String(version || ""))
}

// A genuine upstream 1.0 config must still go through the old migrations. New
// fork builds write a dedicated marker; the audio fields remain as a fallback
// for files saved before that marker existed.
function hasForkSettingsMarker(sourceSettings) {
  if (!sourceSettings || typeof sourceSettings !== "object") return false
  if (sourceSettings.settingsFork === "macchiato") return true
  return Object.prototype.hasOwnProperty.call(sourceSettings, "audioDeviceMatch") ||
    Object.prototype.hasOwnProperty.call(sourceSettings, "quickSwitchOutputId")
}

// Older fork builds wrote their package version into settingsVer. Normalize
// before migrations are selected; otherwise the next launch is treated as an
// upstream 1.0 downgrade followed by a destructive v1.16 upgrade.
function normalizeForkSettingsVersion(settings, sourceSettings = settings) {
  if (!settings || !hasForkSettingsMarker(sourceSettings)) return false
  if (!isForkSettingsVersion(settings.settingsVer)) return false
  settings.settingsVer = CURRENT_SCHEMA_VERSION
  return true
}

// Converts the pre-1.16 hotkey object into the current array shape. Kept pure
// so the backup/repair path and the real migration cannot diverge.
function convertLegacyHotkeys(hotkeys, hotkeyPercent, createId) {
  if (!hotkeys || typeof hotkeys !== "object" || Array.isArray(hotkeys)) return []

  const newHotkeys = []
  for (const hotkey of Object.values(hotkeys)) {
    if (!hotkey || typeof hotkey !== "object") continue

    const action = {
      monitors: {},
      target: "brightness",
      values: [0],
      value: 0,
      allMonitors: false
    }

    if (hotkey.monitor === "turn_off_displays") {
      action.type = "off"
    } else {
      if (hotkey.monitor === "all") {
        action.allMonitors = true
      } else if (hotkey.monitor) {
        action.monitors[hotkey.monitor] = true
      }
      action.type = "offset"
      action.value = (Number(hotkeyPercent) || 0) * (Number(hotkey.direction) || 0)
    }

    newHotkeys.push({
      accelerator: hotkey.accelerator,
      id: createId(),
      actions: [action]
    })
  }
  return newHotkeys
}

// The GUI expects an array. If a fork downgrade left the legacy object behind,
// recover its bindings instead of dropping them; otherwise use an empty array.
function repairHotkeys(settings, hotkeyPercent, createId) {
  if (!settings) return false
  if (Array.isArray(settings.hotkeys)) return false

  const malformed = settings.hotkeys
  settings.hotkeys = convertLegacyHotkeys(malformed, hotkeyPercent, createId)
  if (malformed && typeof malformed === "object" && Object.keys(malformed).length > 0) {
    settings.hotkeysPre1160 = malformed
  }
  return true
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  isForkSettingsVersion,
  hasForkSettingsMarker,
  normalizeForkSettingsVersion,
  convertLegacyHotkeys,
  repairHotkeys
}
