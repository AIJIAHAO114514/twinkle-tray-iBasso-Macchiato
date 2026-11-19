const { EventEmitter } = require('events')

const MacchiatoDevice = require('../MacchiatoDevice')
const { AudioDevice } = require('tt-windows-utils')

// The COM notification is the primary signal; this reconciliation timer only
// exists because a session change can silently stop callbacks, and losing the
// tray hint forever would be worse than a slow refresh.
const AUDIO_RECONCILE_MS = 30000

const EMPTY_AUDIO_OUTPUT = { available: false, isDefault: false, displayName: "" }

// Same fields the tray icon matches on, so the button and the icon cannot
// disagree about which endpoint belongs to the DAC.
function matchesAudioDevice(device, needle) {
  if (!device || !needle) return false
  const haystack = [device.displayName, device.deviceName, device.endpointName]
    .join(" ")
    .toLowerCase()
  return haystack.includes(needle)
}

/**
 * Owns everything about the iBasso Macchiato: the USB device, the "is it the
 * default playback endpoint" question, and the IPC the renderer uses.
 *
 * The main process only wires events to UI concerns (tooltip, tray image, OSD),
 * which keeps all device knowledge in one place and the glue in electron.js
 * down to a handful of lines.
 *
 * Events:
 *   change        (state)  volume or mute changed, from us or from the knob
 *   connected     ()       device opened
 *   disconnected  ()       device went away
 *   audio-match   (bool)   default playback endpoint started/stopped matching
 *   audio-output  (state)  DAC playback endpoint availability or default state
 */
class MacchiatoService extends EventEmitter {
  constructor({ getSettings }) {
    super()
    this.getSettings = getSettings
    this.device = null
    // null = not resolved yet, so the first probe always publishes a value.
    this.audioOutputMatches = null
    this.audioOutput = { ...EMPTY_AUDIO_OUTPUT }
    this._reconcileTimer = null
    this._disposed = false
  }

  init() {
    this.device = new MacchiatoDevice()

    this.device.on('change', state => this.emit('change', state))
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
    this.stopAudioWatch()
    if (this.device) this.device.close()
  }

  // ── Device ───────────────────────────────────────────────────────

  get connected() {
    return !!(this.device && this.device.connected)
  }

  get volume() {
    return this.device ? this.device.volume : null
  }

  get muted() {
    return !!(this.device && this.device.muted)
  }

  getState() {
    if (!this.device) return { connected: false, volume: null, muted: false }
    return this.device.getState()
  }

  adjustVolume(delta) {
    if (!this.device) return false
    return this.device.adjustVolume(delta)
  }

  setVolume(level) {
    if (!this.device) return false
    return this.device.setVolume(level)
  }

  toggleMute() {
    if (!this.device) return false
    return this.device.toggleMute()
  }

  // ── Renderer API ─────────────────────────────────────────────────

  addIpc(ipcMain) {
    // invoke/handle instead of a synchronous sendSync: the renderer never has to
    // block waiting for the main process.
    ipcMain.handle('macchiato-get-state', () => this.getState())
    ipcMain.handle('macchiato-get-audio-output', () => this.getAudioOutputState())
    ipcMain.handle('macchiato-set-default-output', () => this.setDefaultOutput())
    ipcMain.on('macchiato-set-volume', (event, level) => this.setVolume(level))
    ipcMain.on('macchiato-toggle-mute', () => this.toggleMute())
  }

  // ── Default output device ────────────────────────────────────────

  startAudioWatch() {
    let watching = false
    try {
      watching = AudioDevice.startDefaultDeviceWatch(() => this.refreshAudioOutput())
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
    try {
      AudioDevice.stopDefaultDeviceWatch()
    } catch (e) { /* module may be gone during shutdown */ }
  }

  getAudioOutputState() {
    return { ...this.audioOutput }
  }

  _findMatchingAudioEndpoint() {
    const needle = String(this.getSettings()?.audioDeviceMatch || "").trim().toLowerCase()
    if (!needle) return null

    let devices = []
    try {
      devices = typeof AudioDevice.getRenderDevices === "function"
        ? AudioDevice.getRenderDevices()
        : [AudioDevice.getDefaultRenderDevice()].filter(Boolean)
    } catch (e) {
      console.log("Macchiato: audio device query failed:", e.message)
      return null
    }

    const matches = devices.filter(device => matchesAudioDevice(device, needle))
    // If several endpoints match, prefer the one Windows already uses.
    return matches.find(device => device.isDefault) || matches[0] || null
  }

  refreshAudioOutput() {
    if (this._disposed) return

    const endpoint = this._findMatchingAudioEndpoint()
    const next = endpoint
      ? { available: true, isDefault: !!endpoint.isDefault, displayName: endpoint.displayName || "" }
      : { ...EMPTY_AUDIO_OUTPUT }

    const previous = this.audioOutput
    const outputChanged = previous.available !== next.available ||
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

  // Kept as the public refresh entry point for settings changes.
  refreshAudioMatch() {
    this.refreshAudioOutput()
  }

  async setDefaultOutput() {
    const endpoint = this._findMatchingAudioEndpoint()
    if (!endpoint) {
      return { ok: false, code: "not-found", message: "Macchiato playback endpoint not found" }
    }

    let result
    try {
      result = AudioDevice.setDefaultRenderDevice(endpoint.id)
    } catch (e) {
      return { ok: false, code: "failed", message: e.message }
    }

    if (!result || result.ok !== true) {
      return { ok: false, code: "failed", message: result?.message || "Could not switch output" }
    }

    // Reflect the change immediately; the COM notification confirms it a moment
    // later, and the reconciliation timer corrects us if Windows silently refused.
    this.audioOutput = {
      available: true,
      isDefault: true,
      displayName: endpoint.displayName || ""
    }
    this.emit('audio-output', this.getAudioOutputState())
    if (this.audioOutputMatches !== true) {
      this.audioOutputMatches = true
      this.emit('audio-match', true)
    }
    setTimeout(() => this.refreshAudioOutput(), 400)

    return { ok: true, displayName: endpoint.displayName || "" }
  }
}

module.exports = MacchiatoService
