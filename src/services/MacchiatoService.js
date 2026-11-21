const { EventEmitter } = require('events')

const MacchiatoDevice = require('../MacchiatoDevice')
const { AudioDevice } = require('tt-windows-utils')

// The COM notification is the primary signal; this reconciliation timer only
// exists because a session change can silently stop callbacks, and losing the
// tray hint forever would be worse than a slow refresh.
const AUDIO_RECONCILE_MS = 30000

const EMPTY_DEVICE_STATE = { connected: false, volume: null, muted: false }
const EMPTY_AUDIO_OUTPUT = { id: "", available: false, isDefault: false, displayName: "" }
const EMPTY_QUICK_SWITCH_OUTPUT = { ...EMPTY_AUDIO_OUTPUT, automatic: true }
const EMPTY_CURRENT_OUTPUT = { id: "", displayName: "", isDac: false }
const EMPTY_SYSTEM_VOLUME = { deviceId: "", volume: null, muted: false }
const SYSTEM_VOLUME_COALESCE_MS = 25

// Same fields the tray icon matches on, so the button and the icon cannot
// disagree about which endpoint belongs to the DAC.
function matchesAudioDevice(device, needle) {
  if (!device || !needle) return false
  const haystack = [device.displayName, device.deviceName, device.endpointName]
    .join(" ")
    .toLowerCase()
  return haystack.includes(needle)
}

function clampVolume(value) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, number))
}

/**
 * Owns everything about the current playback path: the iBasso Macchiato USB
 * device, the Windows endpoint it (or another output) is using, and the IPC the
 * renderer uses.
 *
 * The active volume comes from the DAC over HID while the Macchiato is the
 * default output, and from the Windows endpoint otherwise. Every surface uses
 * the same activeVolume object, so the wheel, OSD, panel and tray cannot drift.
 *
 * Events:
 *   change        (state)  active volume, mute or current output changed
 *   connected     ()       DAC opened
 *   disconnected  ()       DAC went away
 *   audio-match   (bool)   default playback endpoint started/stopped matching
 *   audio-output  (state)  DAC playback endpoint availability or default state
 */
class MacchiatoService extends EventEmitter {
  constructor({ getSettings, audioDevice = AudioDevice, createDevice = () => new MacchiatoDevice() }) {
    super()
    this.getSettings = getSettings
    this.audioDevice = audioDevice
    this.createDevice = createDevice
    this.device = null
    // null = not resolved yet, so the first probe always publishes a value.
    this.audioOutputMatches = null
    this.audioOutput = { ...EMPTY_AUDIO_OUTPUT }
    this.quickSwitchOutput = { ...EMPTY_QUICK_SWITCH_OUTPUT }
    this.currentOutput = { ...EMPTY_CURRENT_OUTPUT }
    this.systemVolume = { ...EMPTY_SYSTEM_VOLUME }
    this._reconcileTimer = null
    this._volumePollTimer = null
    this._volumeWatchId = null
    this._systemVolumeTimer = null
    this._pendingSystemVolume = null
    this._disposed = false
  }

  init() {
    this.device = this.createDevice()

    this.device.on('change', () => this._emitChange())
    this.device.on('connected', () => {
      console.log("Macchiato: DAC connected")
      this.emit('connected')
      this.refreshAudioOutput()
    })
    this.device.on('disconnected', () => {
      console.log("Macchiato: DAC disconnected")
      this.emit('disconnected')
      this.refreshAudioOutput()
    })

    this.device.open()
    this.device.startWatcher()
    this.startAudioWatch()
  }

  dispose() {
    this._disposed = true
    this._cancelSystemVolumeWrite()
    this.stopAudioWatch()
    if (this.device) this.device.close()
  }

  // ── Active volume ────────────────────────────────────────────────

  get connected() {
    return !!(this.device && this.device.connected)
  }

  get volume() {
    return this.device ? this.device.volume : null
  }

  get muted() {
    return !!(this.device && this.device.muted)
  }

  get activeVolume() {
    return this._activeVolume()
  }

  get hasActiveVolume() {
    return this._activeVolume().available
  }

  // Whether a volume command can be routed right now. A HID device is
  // controllable before its first volume report arrives, so this deliberately
  // does not require a readable level.
  get canControlVolume() {
    return this._activeVolume().source === "dac"
      ? this.connected
      : !!this.currentOutput.id
  }

  _activeVolume() {
    // HID is the preferred path while the Macchiato is the selected output.
    // If its HID handle is gone, the endpoint volume is still usable.
    if (this.currentOutput.isDac && this.connected) {
      return {
        source: "dac",
        displayName: this.audioOutput.displayName || this.currentOutput.displayName,
        volume: this.device.volume,
        muted: this.device.muted,
        available: this.device.volume !== null
      }
    }

    // Readings belong to one endpoint. Until the new endpoint answers, report
    // "not available" instead of lending it the previous device's level.
    const matchesCurrent = !!this.currentOutput.id &&
      this.systemVolume.deviceId === this.currentOutput.id
    return {
      source: "system",
      displayName: this.currentOutput.displayName,
      volume: matchesCurrent ? this.systemVolume.volume : null,
      muted: matchesCurrent ? this.systemVolume.muted : false,
      available: matchesCurrent && this.systemVolume.volume !== null
    }
  }

  getState() {
    const deviceState = this.device ? this.device.getState() : { ...EMPTY_DEVICE_STATE }
    return {
      ...deviceState,
      currentOutput: { ...this.currentOutput },
      quickSwitchOutput: { ...this.quickSwitchOutput },
      systemVolume: { ...this.systemVolume },
      activeVolume: this._activeVolume()
    }
  }

  _emitChange() {
    this.emit('change', this.getState())
  }

  adjustVolume(delta) {
    const active = this._activeVolume()
    if (active.source === "dac") {
      return this.device ? this.device.adjustVolume(delta) : false
    }

    // A newly selected endpoint may not have answered yet. Re-read instead of
    // guessing 50%, which would make the first wheel tick jump the volume.
    let base = active.volume
    if (base === null) {
      this._refreshSystemVolume(false)
      base = this._activeVolume().volume
    }
    if (base === null) return false
    return this._setSystemVolume(base + delta)
  }

  setVolume(level) {
    const active = this._activeVolume()
    if (active.source === "dac") {
      return this.device ? this.device.setVolume(level) : false
    }
    return this._setSystemVolume(level)
  }

  toggleMute() {
    const active = this._activeVolume()
    if (active.source === "dac") {
      return this.device ? this.device.toggleMute() : false
    }

    if (!this.currentOutput.id) return false
    // The cached mute flag only belongs to the endpoint it was read from.
    if (this.systemVolume.deviceId !== this.currentOutput.id) {
      this._refreshSystemVolume(false)
    }
    const current = this._activeVolume()
    const nextMuted = !(current.available && current.muted)
    let ok = false
    try {
      ok = this.audioDevice.setRenderDeviceMuted(this.currentOutput.id, nextMuted)
    } catch (e) {
      console.log("Macchiato: could not change system mute:", e.message)
    }
    if (!ok) return false

    this.systemVolume = {
      deviceId: this.currentOutput.id,
      volume: current.available ? current.volume : null,
      muted: nextMuted
    }
    this._emitChange()
    return true
  }

  _setSystemVolume(level) {
    if (!this.currentOutput.id) return false
    const target = clampVolume(level)

    // Update the UI immediately. The native write is coalesced below so a
    // free-spinning wheel cannot open a COM session per tick.
    this._pendingSystemVolume = { deviceId: this.currentOutput.id, target }
    this.systemVolume = {
      deviceId: this.currentOutput.id,
      volume: target,
      muted: false
    }
    this._emitChange()
    this._queueSystemVolumeWrite()
    return true
  }

  _queueSystemVolumeWrite() {
    if (this._systemVolumeTimer) return

    this._systemVolumeTimer = setTimeout(() => {
      this._systemVolumeTimer = null
      const pending = this._pendingSystemVolume
      this._pendingSystemVolume = null
      if (!pending || this._disposed || pending.deviceId !== this.currentOutput.id) return

      let ok = false
      try {
        ok = this.audioDevice.setRenderDeviceVolume(pending.deviceId, pending.target)
      } catch (e) {
        console.log("Macchiato: could not change system volume:", e.message)
      }
      if (!ok) this._refreshSystemVolume()
    }, SYSTEM_VOLUME_COALESCE_MS)
  }

  _cancelSystemVolumeWrite() {
    if (this._systemVolumeTimer) {
      clearTimeout(this._systemVolumeTimer)
      this._systemVolumeTimer = null
    }
    this._pendingSystemVolume = null
  }

  // ── Renderer API ─────────────────────────────────────────────────

  addIpc(ipcMain, { onVolumeInput } = {}) {
    // invoke/handle instead of a synchronous sendSync: the renderer never has to
    // block waiting for the main process.
    ipcMain.handle('macchiato-get-state', () => this.getState())
    ipcMain.handle('macchiato-get-audio-output', () => this.getAudioOutputState())
    ipcMain.handle('macchiato-get-audio-outputs', () => this.getAudioOutputs())
    ipcMain.handle('macchiato-get-quick-switch-output', () => this.getQuickSwitchOutputState())
    ipcMain.handle('macchiato-set-default-output', (event, deviceId) => this.setDefaultOutput(deviceId))
    let lastVolumeInputOk = false
    ipcMain.on('macchiato-set-volume', (event, level) => {
      lastVolumeInputOk = this.setVolume(level)
    })
    // The slider sends this once on pointer release. Keeping it separate from
    // the level write means wheel, keyboard and number input stay silent.
    ipcMain.on('macchiato-preview-volume', () => {
      const changed = lastVolumeInputOk
      lastVolumeInputOk = false
      if (changed && this.canControlVolume && onVolumeInput) onVolumeInput()
    })
    ipcMain.on('macchiato-toggle-mute', () => this.toggleMute())
  }

  // ── Default output device ────────────────────────────────────────

  startAudioWatch() {
    let watching = false
    try {
      watching = this.audioDevice.startDefaultDeviceWatch(() => this.refreshAudioOutput())
    } catch (e) {
      console.log("Macchiato: could not subscribe to audio device changes:", e.message)
    }

    if (!watching) {
      console.log("Macchiato: falling back to polling for the default audio device")
    }

    this.refreshAudioOutput()
    this._reconcileTimer = setInterval(() => this.refreshAudioOutput(), AUDIO_RECONCILE_MS)
  }

  stopAudioWatch() {
    if (this._reconcileTimer) {
      clearInterval(this._reconcileTimer)
      this._reconcileTimer = null
    }
    this._stopVolumeWatch()
    try {
      this.audioDevice.stopDefaultDeviceWatch()
    } catch (e) { /* module may be gone during shutdown */ }
  }

  getAudioOutputState() {
    return { ...this.audioOutput }
  }

  // Every active Windows playback endpoint. This is shared by the quick-switch
  // button and the full device menu, so both always see the same device list.
  getAudioOutputs() {
    try {
      const devices = typeof this.audioDevice.getRenderDevices === "function"
        ? this.audioDevice.getRenderDevices()
        : [this.audioDevice.getDefaultRenderDevice()]
      // Treat malformed native entries as absent rather than letting one bad
      // endpoint turn every find/map on the list into a TypeError.
      return Array.isArray(devices)
        ? devices.filter(device => device && typeof device.id === "string" && device.id)
        : []
    } catch (e) {
      console.log("Macchiato: audio device query failed:", e.message)
      return []
    }
  }

  _findMatchingAudioEndpoint(devices = this.getAudioOutputs()) {
    const needle = String(this.getSettings()?.audioDeviceMatch || "").trim().toLowerCase()
    if (!needle) return null

    const matches = devices.filter(device => matchesAudioDevice(device, needle))
    // If several endpoints match, prefer the one Windows already uses.
    return matches.find(device => device.isDefault) || matches[0] || null
  }

  // The panel's one-click switch target. An explicit setting wins; otherwise
  // fall back to the Macchiato endpoint so existing installs keep their button.
  _buildQuickSwitchOutput(devices) {
    const settings = this.getSettings() || {}
    const configuredId = String(settings.quickSwitchOutputId || "").trim()
    const configuredName = String(settings.quickSwitchOutputName || "").trim()
    let target = configuredId
      ? devices.find(device => device.id === configuredId)
      : this._findMatchingAudioEndpoint(devices)

    // Windows can re-enumerate an endpoint under a new ID after a driver or
    // port change. Keep a saved target usable when its display name still
    // matches exactly.
    if (!target && configuredId && configuredName) {
      const needle = this._normalizeAudioName(configuredName)
      target = devices.find(device =>
        this._normalizeAudioName(device.displayName) === needle
      )
    }

    if (!target) {
      return {
        id: configuredId,
        available: false,
        isDefault: false,
        displayName: configuredName,
        automatic: !configuredId
      }
    }

    return {
      id: target.id,
      available: true,
      isDefault: !!target.isDefault,
      displayName: target.displayName || "",
      automatic: !configuredId
    }
  }

  _normalizeAudioName(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ")
  }

  getQuickSwitchOutputState(devices = this.getAudioOutputs()) {
    return this._buildQuickSwitchOutput(devices)
  }

  _setCurrentOutput(next) {
    const output = next || { ...EMPTY_CURRENT_OUTPUT }
    if (this.currentOutput.id !== output.id) this._cancelSystemVolumeWrite()
    this.currentOutput = output
  }

  refreshAudioOutput() {
    if (this._disposed) return

    const before = JSON.stringify(this.getState())
    const devices = this.getAudioOutputs()
    const dacEndpoint = this._findMatchingAudioEndpoint(devices)
    const current = devices.find(device => device.isDefault) || null

    this._setCurrentOutput(current
      ? {
          id: current.id,
          displayName: current.displayName || "",
          isDac: !!(dacEndpoint && current.id === dacEndpoint.id)
        }
      : null)

    this._applyAudioOutput(dacEndpoint
      ? {
          id: dacEndpoint.id,
          available: true,
          isDefault: !!dacEndpoint.isDefault,
          displayName: dacEndpoint.displayName || ""
        }
      : { ...EMPTY_AUDIO_OUTPUT })
    this.quickSwitchOutput = this._buildQuickSwitchOutput(devices)

    this._syncVolumeWatch(current?.id || null)
    this._refreshSystemVolume(false)

    if (before !== JSON.stringify(this.getState())) this._emitChange()
  }

  _applyAudioOutput(next) {
    const previous = this.audioOutput
    const outputChanged = previous.id !== next.id ||
      previous.available !== next.available ||
      previous.isDefault !== next.isDefault ||
      previous.displayName !== next.displayName

    this.audioOutput = next
    if (outputChanged) this.emit('audio-output', this.getAudioOutputState())

    const matched = next.isDefault
    if (matched !== this.audioOutputMatches) {
      this.audioOutputMatches = matched
      this.emit('audio-match', matched)
    }
  }

  _syncVolumeWatch(deviceId) {
    if (this._volumeWatchId === deviceId) return
    this._stopVolumeWatch()
    this._volumeWatchId = deviceId
    if (!deviceId) return

    let watching = false
    try {
      watching = this.audioDevice.startEndpointVolumeWatch(deviceId, () => this._refreshSystemVolume())
    } catch (e) {
      console.log("Macchiato: could not watch endpoint volume:", e.message)
    }

    if (!watching) {
      // Do not keep the id: a later reconcile should retry registration. Until
      // then, 1s polling covers volume keys without a noticeable cost.
      this._volumeWatchId = null
      this._volumePollTimer = setInterval(() => this._refreshSystemVolume(), 1000)
    }
  }

  _stopVolumeWatch() {
    if (this._volumePollTimer) {
      clearInterval(this._volumePollTimer)
      this._volumePollTimer = null
    }
    try {
      this.audioDevice.stopEndpointVolumeWatch()
    } catch (e) { /* module may be gone during shutdown */ }
    this._volumeWatchId = null
  }

  _refreshSystemVolume(emit = true) {
    if (!this.currentOutput.id) {
      if (this.systemVolume.deviceId || this.systemVolume.volume !== null || this.systemVolume.muted) {
        this.systemVolume = { ...EMPTY_SYSTEM_VOLUME }
        if (emit) this._emitChange()
      }
      return
    }

    // A coalesced write has not reached Windows yet. Do not replace the
    // optimistic value with the old endpoint level in the meantime.
    if (this._pendingSystemVolume?.deviceId === this.currentOutput.id) return

    let reading = null
    try {
      reading = this.audioDevice.getRenderDeviceVolume(this.currentOutput.id)
    } catch (e) {
      console.log("Macchiato: could not read system volume:", e.message)
    }
    if (!reading) return

    const next = {
      deviceId: this.currentOutput.id,
      volume: reading.volume,
      muted: !!reading.muted
    }
    if (next.deviceId === this.systemVolume.deviceId &&
        next.volume === this.systemVolume.volume &&
        next.muted === this.systemVolume.muted) return

    this.systemVolume = next
    if (emit) this._emitChange()
  }

  // Kept as the public refresh entry point for settings changes.
  refreshAudioMatch() {
    this.refreshAudioOutput()
  }

  async setDefaultOutput(deviceId = null) {
    const devices = this.getAudioOutputs()
    const requestedId = typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : null
    const endpoint = requestedId
      ? devices.find(device => device.id === requestedId)
      : this._findMatchingAudioEndpoint(devices)

    if (!endpoint) {
      return {
        ok: false,
        code: "not-found",
        message: requestedId ? "Playback endpoint not found" : "Macchiato playback endpoint not found"
      }
    }

    let result
    try {
      result = this.audioDevice.setDefaultRenderDevice(endpoint.id)
    } catch (e) {
      return { ok: false, code: "failed", message: e.message }
    }

    if (!result || result.ok !== true) {
      return { ok: false, code: "failed", message: result?.message || "Could not switch output" }
    }

    // Reflect the change immediately. The selected endpoint can be any output,
    // but audioOutput must continue to describe the DAC specifically.
    const before = JSON.stringify(this.getState())
    const optimisticDevices = devices.map(device => ({
      ...device,
      isDefault: device.id === endpoint.id
    }))
    const dacEndpoint = this._findMatchingAudioEndpoint(optimisticDevices)
    const isDac = !!(dacEndpoint && dacEndpoint.id === endpoint.id)

    this._setCurrentOutput({
      id: endpoint.id,
      displayName: endpoint.displayName || "",
      isDac
    })
    this._applyAudioOutput(dacEndpoint
      ? {
          id: dacEndpoint.id,
          available: true,
          isDefault: !!dacEndpoint.isDefault,
          displayName: dacEndpoint.displayName || ""
        }
      : { ...EMPTY_AUDIO_OUTPUT })
    this.quickSwitchOutput = this._buildQuickSwitchOutput(optimisticDevices)

    this._syncVolumeWatch(endpoint.id)
    this._refreshSystemVolume(false)
    if (before !== JSON.stringify(this.getState())) this._emitChange()

    // The COM notification confirms it a moment later, and the reconciliation
    // timer corrects us if Windows silently refused.
    setTimeout(() => this.refreshAudioOutput(), 400)

    return { ok: true, displayName: endpoint.displayName || "" }
  }
}

module.exports = MacchiatoService
