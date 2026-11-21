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

test('without a record the switch target is the next device in the list', () => {
  const audio = fakeAudio({
    getRenderDevices: () => audioDevices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio)

  service.refreshAudioOutput()

  // The default (realtek) is the second entry, so "next in list" wraps to dac.
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'dac')
  assert.strictEqual(service.getState().quickSwitchOutput.available, true)
  assert.strictEqual(service.getState().quickSwitchOutput.displayName, '耳机 (Macchiato)')
})

test('switching outputs records the previous one as the switch target', async () => {
  const audio = fakeAudio({
    getRenderDevices: () => audioDevices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio)

  service.refreshAudioOutput()
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'dac')

  const result = await service.setDefaultOutput('dac')

  assert.strictEqual(result.ok, true)
  // The device we just left becomes the "switch back" target.
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'realtek')
  assert.strictEqual(service.getState().quickSwitchOutput.displayName, '扬声器 (Realtek)')
})

test('an external default change also records the previous output', () => {
  let devices = [
    { id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: true },
    { id: 'dac', displayName: '耳机 (Macchiato)', isDefault: false }
  ]
  const audio = fakeAudio({
    getRenderDevices: () => devices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio)

  service.refreshAudioOutput()
  assert.strictEqual(service.lastUsedOutput, null)

  // Windows (or another app) moves the default elsewhere.
  devices = [
    { id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: false },
    { id: 'dac', displayName: '耳机 (Macchiato)', isDefault: true }
  ]
  service.refreshAudioOutput()

  assert.strictEqual(service.lastUsedOutput.id, 'realtek')
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'realtek')

  // An unchanged default must not re-record anything.
  const before = service.lastUsedOutput
  service.refreshAudioOutput()
  assert.strictEqual(service.lastUsedOutput, before)
})

test('an unplugged previous output falls back to the next device', () => {
  const audio = fakeAudio({
    getRenderDevices: () => audioDevices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio, fakeHid(), {
    lastAudioOutputId: 'gone-endpoint',
    lastAudioOutputName: 'USB DAC'
  })

  service.refreshAudioOutput()

  assert.strictEqual(service.getState().quickSwitchOutput.id, 'dac')
})

test('a recorded previous output overrides the next-in-list fallback', () => {
  const devices = [
    { id: 'headphones', displayName: '耳机', isDefault: false },
    { id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: true },
    { id: 'dac', displayName: '耳机 (Macchiato)', isDefault: false }
  ]
  const audio = fakeAudio({
    getRenderDevices: () => devices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio, fakeHid(), {
    lastAudioOutputId: 'headphones',
    lastAudioOutputName: '耳机'
  })

  service.refreshAudioOutput()

  // Next-in-list from realtek would be dac; the record wins.
  assert.strictEqual(service.getState().quickSwitchOutput.id, 'headphones')
  assert.strictEqual(service.getState().quickSwitchOutput.displayName, '耳机')
})

test('a single-device list leaves no switch target', () => {
  const devices = [{ id: 'realtek', displayName: '扬声器 (Realtek)', isDefault: true }]
  const audio = fakeAudio({
    getRenderDevices: () => devices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = makeService(audio)

  service.refreshAudioOutput()

  assert.deepStrictEqual(service.getState().quickSwitchOutput, {
    id: '',
    available: false,
    isDefault: false,
    displayName: ''
  })
})

test('the previous output is reported for persistence on every change', async () => {
  const recorded = []
  const audio = fakeAudio({
    getRenderDevices: () => audioDevices,
    getRenderDeviceVolume: () => ({ volume: 50, muted: false })
  })
  const service = new MacchiatoService({
    getSettings: () => ({ audioDeviceMatch: 'Macchiato' }),
    audioDevice: audio,
    createDevice: () => fakeHid(),
    onLastUsedOutput: (output) => recorded.push(output)
  })
  service.device = fakeHid()

  service.refreshAudioOutput()
  assert.deepStrictEqual(recorded, [])

  await service.setDefaultOutput('dac')
  assert.deepStrictEqual(recorded, [
    { id: 'realtek', displayName: '扬声器 (Realtek)' }
  ])

  await service.setDefaultOutput('realtek')
  assert.deepStrictEqual(recorded, [
    { id: 'realtek', displayName: '扬声器 (Realtek)' },
    { id: 'dac', displayName: '耳机 (Macchiato)' }
  ])
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
