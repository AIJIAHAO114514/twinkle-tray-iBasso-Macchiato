const test = require('node:test')
const assert = require('node:assert')

const MacchiatoDevice = require('../src/MacchiatoDevice')
const { parseVolumeReport, buildSetVolumeCommand } = MacchiatoDevice

// A device instance with the HID layer replaced, so the state machine can be
// exercised without hardware.
function fakeDevice({ volume = 50, muted = false } = {}) {
  const device = new MacchiatoDevice()
  device.connected = true
  device.volume = volume
  device.muted = muted
  device.writes = []
  device._write = (buffer) => {
    device.writes.push(Array.from(buffer).slice(0, 8))
    return true
  }
  return device
}

test('parseVolumeReport reads the documented reply layout', () => {
  const report = Buffer.from([0x4b, 0x01, 0x3f, 0x08, 0x01, 0x10, 65, 65])
  assert.strictEqual(parseVolumeReport(report), 65)
})

test('parseVolumeReport falls back to scanning for the 0x10 marker', () => {
  const report = Buffer.from([0x4b, 0x80, 0x3f, 0x08, 0x42, 0x00, 0x10, 42, 0, 0])
  assert.strictEqual(parseVolumeReport(report), 42)
})

test('parseVolumeReport ignores reports without a volume', () => {
  assert.strictEqual(parseVolumeReport(Buffer.from([0x4b, 0, 0, 0, 0, 0, 0, 0])), null)
  assert.strictEqual(parseVolumeReport(Buffer.from([0x4b, 0, 0])), null)
  assert.strictEqual(parseVolumeReport(null), null)
})

test('buildSetVolumeCommand clamps and mirrors the level', () => {
  assert.deepStrictEqual(Array.from(buildSetVolumeCommand(65).slice(0, 8)), [0x4b, 0x01, 0x3f, 0x08, 0x01, 0x10, 65, 65])
  assert.strictEqual(buildSetVolumeCommand(500)[6], 100)
  assert.strictEqual(buildSetVolumeCommand(-20)[6], 0)
  assert.strictEqual(buildSetVolumeCommand('abc')[6], 0)
  assert.strictEqual(buildSetVolumeCommand(63.6)[6], 64)
})

test('mute remembers the level and unmute restores it', () => {
  const device = fakeDevice({ volume: 40 })

  assert.strictEqual(device.toggleMute(), true)
  assert.strictEqual(device.muted, true)
  assert.strictEqual(device.preMuteVolume, 40)
  assert.strictEqual(device.writes.at(-1)[6], 0)

  assert.strictEqual(device.toggleMute(), true)
  assert.strictEqual(device.muted, false)
  assert.strictEqual(device.volume, 40)
  assert.strictEqual(device.writes.at(-1)[6], 40)
})

test('setting a level clears the muted state', () => {
  const device = fakeDevice({ volume: 40 })
  device.toggleMute()
  device.setVolume(55)

  assert.strictEqual(device.muted, false)
  assert.strictEqual(device.volume, 55)
})

test('adjustVolume moves relative to the last known level', () => {
  const device = fakeDevice({ volume: 40 })
  device.adjustVolume(2)
  assert.strictEqual(device.volume, 42)

  device.adjustVolume(-10)
  assert.strictEqual(device.volume, 32)

  device.adjustVolume(-100)
  assert.strictEqual(device.volume, 0)
})

test('adjustVolume uses the fallback level before the first read', () => {
  const device = fakeDevice({ volume: null })
  device.fallbackVolume = 50

  device.adjustVolume(2)
  assert.strictEqual(device.volume, 52)
})

test('a muted device ignores its own zero reports', () => {
  const device = fakeDevice({ volume: 40 })
  device.toggleMute()

  let changes = 0
  device.on('change', () => changes++)

  device._handleReport(Buffer.from([0x4b, 0x01, 0x3f, 0x08, 0x01, 0x10, 0, 0]))
  assert.strictEqual(device.muted, true)
  assert.strictEqual(changes, 0)
})

test('a non-zero report while muted un-mutes and publishes the change', () => {
  const device = fakeDevice({ volume: 40 })
  device.toggleMute()

  let state = null
  device.on('change', (next) => { state = next })

  device._handleReport(Buffer.from([0x4b, 0x01, 0x3f, 0x08, 0x01, 0x10, 30, 30]))
  assert.strictEqual(device.muted, false)
  assert.strictEqual(device.volume, 30)
  assert.deepStrictEqual(state, device.getState())
})

test('un-muting from a report does not swallow the change when the level is unchanged', () => {
  const device = fakeDevice({ volume: 40 })
  device.toggleMute()

  let changes = 0
  device.on('change', () => changes++)

  // Same level as remembered: the mute flag still has to be published.
  device._handleReport(Buffer.from([0x4b, 0x01, 0x3f, 0x08, 0x01, 0x10, 40, 40]))
  assert.strictEqual(device.muted, false)
  assert.strictEqual(changes, 1)
})

test('setVolume on a disconnected device does nothing', () => {
  const device = fakeDevice({ volume: 40 })
  device.connected = false

  assert.strictEqual(device.setVolume(10), false)
  assert.strictEqual(device.volume, 40)
})
