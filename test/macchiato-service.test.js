const test = require('node:test')
const assert = require('node:assert')

const MacchiatoService = require('../src/services/MacchiatoService')

function fakeHid({ connected = true, volume = null, muted = false } = {}) {
  return {
    connected,
    volume,
    muted,
    adjustVolumeCalls: [],
    getState() {
      return { connected: this.connected, volume: this.volume, muted: this.muted }
    },
    adjustVolume(delta) {
      this.adjustVolumeCalls.push(delta)
      return true
    },
    setVolume(level) {
      this.volume = level
      return true
    },
    toggleMute() {
      this.muted = !this.muted
      return true
    },
    close() {}
  }
}

function fakeAudio(overrides = {}) {
  return {
    getRenderDevices: () => [],
    getDefaultRenderDevice: () => null,
    getRenderDeviceVolume: () => null,
    setRenderDeviceVolume: () => true,
    setRenderDeviceMuted: () => true,
    setDefaultRenderDevice: () => ({ ok: true }),
    startDefaultDeviceWatch: () => true,
    stopDefaultDeviceWatch: () => true,
    startEndpointVolumeWatch: () => true,
    stopEndpointVolumeWatch: () => true,
    ...overrides
  }
}

function makeService(audioDevice, device = fakeHid(), settings = {}) {
  const service = new MacchiatoService({
    getSettings: () => ({ audioDeviceMatch: 'Macchiato', ...settings }),
    audioDevice,
    createDevice: () => device
  })
  service.device = device
  return service
}

const audioDevices = [
  { id: 'dac', displayName: '耳机 (Macchiato)', isDefault: false },
  { id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: true }
]

test('relative system volume re-reads instead of guessing a level', () => {
  let reads = 0
  const service = makeService(fakeAudio({
    getRenderDeviceVolume: () => {
      reads++
      return { volume: 80, muted: false }
    }
  }))
  service.currentOutput = { id: 'spk', displayName: 'Speakers', isDac: false }
  service.systemVolume = { deviceId: '', volume: null, muted: false }

  assert.strictEqual(service.adjustVolume(1), true)
  assert.strictEqual(reads, 1)
  assert.strictEqual(service.systemVolume.volume, 81)
  service._cancelSystemVolumeWrite()

  const unreadable = makeService(fakeAudio({ getRenderDeviceVolume: () => null }))
  unreadable.currentOutput = { id: 'spk', displayName: 'Speakers', isDac: false }
  unreadable.systemVolume = { deviceId: '', volume: null, muted: false }
  assert.strictEqual(unreadable.adjustVolume(1), false)
  assert.strictEqual(unreadable.systemVolume.volume, null)
})

test('a connected DAC is controllable before its first volume report', () => {
  const device = fakeHid({ volume: null })
  const service = makeService(fakeAudio(), device)
  service.currentOutput = { id: 'dac', displayName: 'Macchiato', isDac: true }

  assert.strictEqual(service.hasActiveVolume, false)
  assert.strictEqual(service.canControlVolume, true)
  assert.strictEqual(service.adjustVolume(1), true)
  assert.deepStrictEqual(device.adjustVolumeCalls, [1])
})

test('volume read from another endpoint is never reused after a switch', () => {
  const service = makeService(fakeAudio({ getRenderDeviceVolume: () => null }))
  service.currentOutput = { id: 'endpoint-b', displayName: 'B', isDac: false }
  service.systemVolume = { deviceId: 'endpoint-a', volume: 42, muted: true }

  service._refreshSystemVolume(false)

  assert.deepStrictEqual(service.activeVolume, {
    source: 'system',
    displayName: 'B',
    volume: null,
    muted: false,
    available: false
  })
  assert.strictEqual(service.canControlVolume, true)
})

test('refresh adopts the new endpoint only with its own reading', () => {
  const devices = [
    { id: 'endpoint-b', displayName: 'B', isDefault: true },
    { id: 'unused', displayName: 'Unused', isDefault: false }
  ]
  const audio = fakeAudio({
    getRenderDevices: () => devices,
    getRenderDeviceVolume: (id) => id === 'endpoint-b' ? { volume: 31, muted: false } : null
  })
  const service = makeService(audio)
  service.currentOutput = { id: 'endpoint-a', displayName: 'A', isDac: false }
  service.systemVolume = { deviceId: 'endpoint-a', volume: 70, muted: false }

  service.refreshAudioOutput()

  assert.strictEqual(service.systemVolume.deviceId, 'endpoint-b')
  assert.strictEqual(service.activeVolume.volume, 31)
  assert.strictEqual(service.activeVolume.available, true)
})

test('malformed native device entries are ignored instead of crashing', () => {
  const devices = [undefined, { id: '', displayName: 'empty' }, {
    id: 'endpoint-a',
    displayName: 'Speakers',
    isDefault: true
  }]
  const service = makeService(fakeAudio({
    getRenderDevices: () => devices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  }))

  assert.doesNotThrow(() => service.refreshAudioOutput())
  assert.strictEqual(service.currentOutput.id, 'endpoint-a')
  assert.strictEqual(service.getAudioOutputs().length, 1)
})

test('rapid system-volume changes coalesce into the final value', async () => {
  const writes = []
  const service = makeService(fakeAudio({
    setRenderDeviceVolume: (id, level) => {
      writes.push({ id, level })
      return true
    }
  }))
  service.currentOutput = { id: 'endpoint-a', displayName: 'A', isDac: false }
  service.systemVolume = { deviceId: 'endpoint-a', volume: 20, muted: false }

  service._setSystemVolume(21)
  service._setSystemVolume(22)
  service._setSystemVolume(23)

  assert.strictEqual(service.activeVolume.volume, 23)
  assert.deepStrictEqual(writes, [])
  await new Promise(resolve => setTimeout(resolve, 45))
  assert.deepStrictEqual(writes, [{ id: 'endpoint-a', level: 23 }])
})

test('switching outputs cancels a pending write to the old endpoint', async () => {
  const writes = []
  const service = makeService(fakeAudio({
    setRenderDeviceVolume: (id, level) => {
      writes.push({ id, level })
      return true
    }
  }))
  service.currentOutput = { id: 'endpoint-a', displayName: 'A', isDac: false }
  service.systemVolume = { deviceId: 'endpoint-a', volume: 20, muted: false }

  service._setSystemVolume(80)
  service._setCurrentOutput({ id: 'endpoint-b', displayName: 'B', isDac: false })

  assert.strictEqual(service._pendingSystemVolume, null)
  await new Promise(resolve => setTimeout(resolve, 45))
  assert.deepStrictEqual(writes, [])
})

test('a failed endpoint watcher falls back to polling until switched', (t) => {
  const service = makeService(fakeAudio({
    startEndpointVolumeWatch: () => false
  }))
  t.after(() => service._stopVolumeWatch())

  service._syncVolumeWatch('endpoint-a')

  assert.strictEqual(service._volumeWatchId, null)
  assert.notStrictEqual(service._volumePollTimer, null)
})

test('quick switch target falls back to the matched DAC', () => {
  const service = makeService(fakeAudio())
  const target = service.getQuickSwitchOutputState(audioDevices)

  assert.deepStrictEqual(target, {
    id: 'dac',
    available: true,
    isDefault: false,
    displayName: '耳机 (Macchiato)',
    automatic: true
  })
})

test('an explicit quick switch target overrides the DAC fallback', () => {
  const service = makeService(fakeAudio(), fakeHid(), {
    quickSwitchOutputId: 'realtek',
    quickSwitchOutputName: '扬声器 (Realtek)'
  })
  const target = service.getQuickSwitchOutputState(audioDevices)

  assert.strictEqual(target.id, 'realtek')
  assert.strictEqual(target.displayName, '扬声器 (Realtek)')
  assert.strictEqual(target.isDefault, true)
  assert.strictEqual(target.automatic, false)
})

test('an offline quick switch target keeps its saved name and is unavailable', () => {
  const service = makeService(fakeAudio(), fakeHid(), {
    quickSwitchOutputId: 'offline-device',
    quickSwitchOutputName: 'USB DAC'
  })
  const target = service.getQuickSwitchOutputState(audioDevices)

  assert.deepStrictEqual(target, {
    id: 'offline-device',
    available: false,
    isDefault: false,
    displayName: 'USB DAC',
    automatic: false
  })
})

test('a renamed endpoint ID is recovered by its saved display name', () => {
  const service = makeService(fakeAudio(), fakeHid(), {
    quickSwitchOutputId: 'old-endpoint-id',
    quickSwitchOutputName: '耳机 (Macchiato)'
  })
  const devices = [
    { id: 'new-endpoint-id', displayName: '耳机 (Macchiato)', isDefault: false },
    { id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: true }
  ]

  const target = service.getQuickSwitchOutputState(devices)

  assert.strictEqual(target.id, 'new-endpoint-id')
  assert.strictEqual(target.available, true)
  assert.strictEqual(target.automatic, false)
})

test('clearing the target restores automatic matching', () => {
  const settings = {
    quickSwitchOutputId: 'realtek',
    quickSwitchOutputName: '扬声器 (Realtek)'
  }
  const service = makeService(fakeAudio(), fakeHid(), settings)

  settings.quickSwitchOutputId = ''
  settings.quickSwitchOutputName = ''
  const target = service.getQuickSwitchOutputState(audioDevices)

  assert.strictEqual(target.id, 'dac')
  assert.strictEqual(target.automatic, true)
})

test('changing the quick switch setting refreshes the panel target', () => {
  const settings = {}
  const audio = fakeAudio({
    getRenderDevices: () => audioDevices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio, fakeHid(), settings)

  service.refreshAudioOutput()
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'dac')

  settings.quickSwitchOutputId = 'realtek'
  settings.quickSwitchOutputName = '扬声器 (Realtek)'
  service.refreshAudioOutput()
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'realtek')
  assert.strictEqual(service.getState().quickSwitchOutput.displayName, '扬声器 (Realtek)')
})

test('volume preview is a separate pointer-release signal', () => {
  const handlers = {}
  const ipcMain = {
    handle: (channel, handler) => { handlers[channel] = handler },
    on: (channel, handler) => { handlers[channel] = handler }
  }
  const levels = []
  let previews = 0
  const service = makeService(fakeAudio())
  service.currentOutput = { id: 'spk', displayName: 'Speakers', isDac: false }
  service.setVolume = (level) => {
    levels.push(level)
    return true
  }

  service.addIpc(ipcMain, { onVolumeInput: () => { previews++ } })

  handlers['macchiato-set-volume'](null, 37)
  assert.deepStrictEqual(levels, [37])
  assert.strictEqual(previews, 0)

  handlers['macchiato-preview-volume']()
  assert.strictEqual(previews, 1)

  // Wheel and number-entry changes only write the level; no preview signal.
  handlers['macchiato-set-volume'](null, 38)
  assert.deepStrictEqual(levels, [37, 38])
  assert.strictEqual(previews, 1)

  // A failed write must not be followed by a preview beep.
  service.setVolume = () => false
  handlers['macchiato-set-volume'](null, 39)
  handlers['macchiato-preview-volume']()
  assert.strictEqual(previews, 1)

  // Preview also requires a controllable output.
  service.setVolume = (level) => {
    levels.push(level)
    return true
  }
  handlers['macchiato-set-volume'](null, 40)
  service.currentOutput = { id: '', displayName: '', isDac: false }
  handlers['macchiato-preview-volume']()
  assert.strictEqual(previews, 1)
})
