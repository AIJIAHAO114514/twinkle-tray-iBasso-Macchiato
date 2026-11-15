const { EventEmitter } = require('events')

const MacchiatoDevice = require('../MacchiatoDevice')
const { AudioDevice } = require('tt-windows-utils')

// The COM notification is the primary signal; this reconciliation timer only
// exists because a session change can silently stop callbacks, and losing the
// tray hint forever would be worse than a slow refresh.
const AUDIO_RECONCILE_MS = 30000

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
 */
class MacchiatoService extends EventEmitter {
  constructor({ getSettings }) {
    super()
    this.getSettings = getSettings
    this.device = null
    // null = not resolved yet, so the first probe always publishes a value.
    this.audioOutputMatches = null
    this._reconcileTimer = null
    this._disposed = false
  }

  init() {
    this.device = new MacchiatoDevice()

    this.device.on('change', state => this.emit('change', state))
    this.device.on('connected', () => {
      console.log("Macchiato: DAC connected")
      this.emit('connected')
      this.refreshAudioMatch()
    })
    this.device.on('disconnected', () => {
      console.log("Macchiato: DAC disconnected")
      this.emit('disconnected')
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
    ipcMain.on('macchiato-set-volume', (event, level) => this.setVolume(level))
    ipcMain.on('macchiato-toggle-mute', () => this.toggleMute())
  }

  // ── Default output device ────────────────────────────────────────

  startAudioWatch() {
    let watching = false
    try {
      watching = AudioDevice.startDefaultDeviceWatch(() => this.refreshAudioMatch())
    } catch (e) {
      console.log("Macchiato: could not subscribe to audio device changes:", e.message)
    }

    if (!watching) {
      console.log("Macchiato: falling back to polling for the default audio device")
    }

    this.refreshAudioMatch()
    this._reconcileTimer = setInterval(() => this.refreshAudioMatch(), AUDIO_RECONCILE_MS)
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

  refreshAudioMatch() {
    if (this._disposed) return

    let matched = false
    try {
      const device = AudioDevice.getDefaultRenderDevice()
      const needle = String(this.getSettings()?.audioDeviceMatch || "").trim().toLowerCase()
      if (device && needle) {
        const haystack = [device.displayName, device.deviceName, device.endpointName]
          .join(" ")
          .toLowerCase()
        matched = haystack.includes(needle)
      }
    } catch (e) {
      console.log("Macchiato: audio device query failed:", e.message)
    }

    if (matched === this.audioOutputMatches) return
    this.audioOutputMatches = matched
    this.emit('audio-match', matched)
  }
}

module.exports = MacchiatoService
