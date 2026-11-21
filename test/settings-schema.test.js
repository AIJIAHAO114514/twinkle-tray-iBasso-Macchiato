const test = require('node:test')
const assert = require('node:assert')

const {
  CURRENT_SCHEMA_VERSION,
  isForkSettingsVersion,
  hasForkSettingsMarker,
  normalizeForkSettingsVersion,
  convertLegacyHotkeys,
  repairHotkeys
} = require('../src/settings-schema')

test('fork package versions normalize to the upstream schema', () => {
  const modernHotkeys = [{
    accelerator: 'Ctrl+1',
    id: 'keep-me',
    actions: [{ type: 'offset', value: 7 }]
  }]
  const settings = {
    settingsVer: 'v1.0.33',
    audioDeviceMatch: 'macchiato',
    hotkeys: modernHotkeys,
    monitorFeatures: { display: { '0x12': { enabled: true } } }
  }

  assert.strictEqual(isForkSettingsVersion(settings.settingsVer), true)
  assert.strictEqual(hasForkSettingsMarker(settings), true)
  assert.strictEqual(normalizeForkSettingsVersion(settings), true)
  assert.strictEqual(settings.settingsVer, CURRENT_SCHEMA_VERSION)

  // Normalization must not mutate modern data; it only prevents migrations
  // from running a second time.
  assert.strictEqual(settings.hotkeys, modernHotkeys)
  assert.deepStrictEqual(settings.monitorFeatures, { display: { '0x12': { enabled: true } } })
})

test('the dedicated fork marker normalizes without audio fields', () => {
  const settings = {
    settingsVer: 'v1.0.99',
    settingsFork: 'macchiato'
  }

  assert.strictEqual(hasForkSettingsMarker(settings), true)
  assert.strictEqual(normalizeForkSettingsVersion(settings), true)
  assert.strictEqual(settings.settingsVer, CURRENT_SCHEMA_VERSION)
})

test('real upstream and schema versions are left alone', () => {
  for (const version of ['v1.15.0', 'v1.16.0', 'v1.17.0-beta1', CURRENT_SCHEMA_VERSION, '', null]) {
    const settings = { settingsVer: version, audioDeviceMatch: 'macchiato' }
    assert.strictEqual(isForkSettingsVersion(version), false)
    assert.strictEqual(normalizeForkSettingsVersion(settings), false)
    assert.strictEqual(settings.settingsVer, version)
  }
})

test('a genuine upstream 1.0 file is not mistaken for the fork schema', () => {
  const rawSettings = {
    settingsVer: 'v1.0.0',
    hotkeys: { legacy: { accelerator: 'Ctrl+Up', monitor: 'all', direction: 1 } }
  }
  const settings = {
    ...rawSettings,
    audioDeviceMatch: 'macchiato' // Present only because defaults were merged.
  }

  assert.strictEqual(hasForkSettingsMarker(rawSettings), false)
  assert.strictEqual(normalizeForkSettingsVersion(settings, rawSettings), false)
  assert.strictEqual(settings.settingsVer, 'v1.0.0')
})

test('legacy hotkeys keep their accelerator, target and direction', () => {
  const legacy = {
    allDisplays: { accelerator: 'Ctrl+Up', monitor: 'all', direction: 1 },
    disconnect: { accelerator: 'Ctrl+Off', monitor: 'turn_off_displays' },
    secondDisplay: { accelerator: 'Ctrl+Down', monitor: 'display-2', direction: -1 }
  }
  let nextId = 0
  const createId = () => `hotkey-${++nextId}`

  const converted = convertLegacyHotkeys(legacy, 10, createId)

  assert.strictEqual(converted.length, 3)
  assert.deepStrictEqual(converted[0], {
    accelerator: 'Ctrl+Up',
    id: 'hotkey-1',
    actions: [{
      monitors: {},
      target: 'brightness',
      values: [0],
      value: 10,
      allMonitors: true,
      type: 'offset'
    }]
  })
  assert.strictEqual(converted[1].actions[0].type, 'off')
  assert.deepStrictEqual(converted[2].actions[0].monitors, { 'display-2': true })
  assert.strictEqual(converted[2].actions[0].value, -10)
})

test('repairing a legacy hotkey object preserves a downgrade backup', () => {
  const legacy = {
    allDisplays: { accelerator: 'Ctrl+Up', monitor: 'all', direction: 1 }
  }
  const settings = { hotkeys: legacy }

  assert.strictEqual(repairHotkeys(settings, 10, () => 'recovered-id'), true)
  assert.strictEqual(Array.isArray(settings.hotkeys), true)
  assert.strictEqual(settings.hotkeys[0].id, 'recovered-id')
  assert.strictEqual(settings.hotkeys[0].actions[1], undefined)
  assert.strictEqual(settings.hotkeysPre1160, legacy)
})

test('repair does not rewrite an already valid hotkey array', () => {
  const hotkeys = [{ accelerator: 'Ctrl+1', id: 'one', actions: [] }]
  const settings = { hotkeys }

  assert.strictEqual(repairHotkeys(settings, 10, () => 'unused'), false)
  assert.strictEqual(settings.hotkeys, hotkeys)
  assert.strictEqual(settings.hotkeysPre1160, undefined)
})

test('a missing or empty legacy object becomes an empty array', () => {
  const missing = {}
  const empty = { hotkeys: {} }

  assert.strictEqual(repairHotkeys(missing, 10, () => 'unused'), true)
  assert.deepStrictEqual(missing.hotkeys, [])
  assert.strictEqual(repairHotkeys(empty, 10, () => 'unused'), true)
  assert.deepStrictEqual(empty.hotkeys, [])
  assert.strictEqual(empty.hotkeysPre1160, undefined)
})
