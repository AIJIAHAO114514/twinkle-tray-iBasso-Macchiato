/**
 * MacchiatoDevice.js
 *
 * Volume control for the iBasso Macchiato USB DAC over raw HID reports.
 *
 * Protocol (fixed 64-byte report, report id 0x4B):
 *   read  : 4B 80 3F 08 42 10 00 ...
 *   write : 4B 01 3F 08 01 10 <vol> <vol> 00 ...
 *   reply : contains a 0x10 marker followed by the current volume (0-100)
 *
 * Everything here is asynchronous on purpose. The previous implementation
 * blocked the Electron main process with readTimeout() calls, which stalls
 * every window and IPC handler in the app.
 */

const { EventEmitter } = require('events');

const VENDOR_ID = 0x0661;
const PRODUCT_IDS = [0x0881, 0x0882];

const REPORT_ID = 0x4B;
const REPORT_LENGTH = 64;

const READ_VOLUME_COMMAND = Buffer.from([
  REPORT_ID, 0x80, 0x3F, 0x08, 0x42, 0x10,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

// hid.devices() enumerates every HID device through SetupAPI and costs ~11ms on
// a normal desktop (measured with 24 devices). Unplugging is already caught by
// the HID error event, so this poll only has to notice a *new* device: 3s keeps
// the cost at ~0.4% of one core instead of ~1.1%.
const DEVICE_WATCH_INTERVAL = 3000;   // hotplug polling
const STATE_REFRESH_INTERVAL = 3000;  // re-read volume so manual knob turns are picked up
const WRITE_SETTLE_MS = 250;          // ignore refreshes right after our own write
// A free-spinning wheel can produce >100 ticks per second; coalescing keeps the
// DAC from queueing a write per tick while the UI still updates instantly.
const WRITE_COALESCE_MS = 25;
const MAX_WRITE_FAILURES = 3;         // transient errors must not drop the link

function buildSetVolumeCommand(volume) {
  const command = Buffer.alloc(REPORT_LENGTH);
  const value = clampVolume(volume);
  command[0] = REPORT_ID;
  command[1] = 0x01;
  command[2] = 0x3F;
  command[3] = 0x08;
  command[4] = 0x01;
  command[5] = 0x10;
  command[6] = value;
  command[7] = value;
  return command;
}

function clampVolume(volume) {
  const value = Math.round(Number(volume));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Extract the volume out of a device reply.
 * The exact offset depends on the firmware revision, so prefer the position
 * used by the set command (byte 7) and only then fall back to scanning for the
 * 0x10 marker. Returns null when the report doesn't carry a volume.
 */
function parseVolumeReport(buffer) {
  if (!buffer || buffer.length < 8) return null;

  // Fast path: same layout as the set command.
  if (buffer[5] === 0x10 && buffer[6] <= 100 && buffer[6] === buffer[7]) {
    return buffer[6];
  }

  // Slow path: locate the marker, then take the byte that follows it.
  for (let i = 5; i < buffer.length - 1; i++) {
    if (buffer[i] !== 0x10) continue;
    if (buffer[i + 1] <= 100) return buffer[i + 1];
  }

  return null;
}

class MacchiatoDevice extends EventEmitter {
  constructor(options = {}) {
    super();

    this.id = options.id || null;
    this.name = options.name || 'iBasso Macchiato';

    this.hid = null;
    this.devicePath = null;
    this.connected = false;

    this.volume = null;          // null = not read yet
    this.muted = false;
    this.preMuteVolume = null;
    // Used when the firmware never answers a read request: relative changes
    // still work instead of silently doing nothing.
    this.fallbackVolume = 50;

    this._hidModule = undefined;
    this._lastWriteAt = 0;
    this._writeTimer = null;
    this._writeFailures = 0;
    this._refreshTimer = null;
    this._watchTimer = null;

    this._unsupported = false;   // node-hid missing
  }

  get available() {
    return !this._unsupported;
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      connected: this.connected,
      volume: this.volume,
      muted: this.muted
    };
  }

  _emitChange() {
    this.emit('change', this.getState());
  }

  _loadHid() {
    if (this._hidModule !== undefined) return this._hidModule;
    try {
      this._hidModule = require('node-hid');
    } catch (e) {
      this._hidModule = null;
      this._unsupported = true;
      console.log('Macchiato: node-hid is not available, volume control disabled');
    }
    return this._hidModule;
  }

  // ── Device discovery ──────────────────────────────────────────────

  static findDevice(hid) {
    if (!hid) return null;
    try {
      return hid.devices().find(device =>
        device.vendorId === VENDOR_ID &&
        PRODUCT_IDS.includes(device.productId)
      ) || null;
    } catch (e) {
      return null;
    }
  }

  open() {
    const hid = this._loadHid();
    if (!hid) return false;

    const target = MacchiatoDevice.findDevice(hid);
    if (!target) return false;

    this.closeHandle();

    try {
      this.hid = new hid.HID(target.path);
    } catch (e) {
      console.log('Macchiato: failed to open HID device:', e.message);
      this.hid = null;
      return false;
    }

    this.devicePath = target.path;
    this.connected = true;
    this.muted = false;
    this.preMuteVolume = null;
    this.volume = null;

    this.hid.on('data', buffer => this._handleReport(buffer));
    this.hid.on('error', error => {
      console.log('Macchiato: HID error:', error.message);
      this._handleDisconnect();
    });

    this.emit('connected', this.getState());
    this._emitChange();

    this.refresh();
    this._startRefreshTimer();
    return true;
  }

  closeHandle() {
    this._stopRefreshTimer();
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    this._writeFailures = 0;
    if (this.hid) {
      try { this.hid.close(); } catch (e) { /* already gone */ }
    }
    this.hid = null;
    this.devicePath = null;
  }

  close() {
    this.stopWatcher();
    this._handleDisconnect(true);
    this.removeAllListeners();
  }

  _handleDisconnect(quiet = false) {
    const wasConnected = this.connected;
    this.closeHandle();
    this.connected = false;
    this.volume = null;
    this.muted = false;
    this.preMuteVolume = null;
    if (wasConnected && !quiet) {
      this.emit('disconnected', this.getState());
    }
    if (wasConnected) this._emitChange();
  }

  // ── Hotplug watcher ──────────────────────────────────────────────

  startWatcher() {
    if (this._watchTimer) return;
    if (!this._loadHid()) return;

    this._watchTimer = setInterval(() => {
      const present = MacchiatoDevice.findDevice(this._hidModule) !== null;
      if (present && !this.connected) {
        this.open();
      } else if (!present && this.connected) {
        this._handleDisconnect();
      }
    }, DEVICE_WATCH_INTERVAL);
  }

  stopWatcher() {
    if (this._watchTimer) {
      clearInterval(this._watchTimer);
      this._watchTimer = null;
    }
  }

  // ── Volume I/O ───────────────────────────────────────────────────

  _write(buffer) {
    if (!this.hid) return false;
    try {
      this.hid.write(Array.from(buffer));
      this._lastWriteAt = Date.now();
      this._writeFailures = 0;
      return true;
    } catch (e) {
      this._writeFailures++;
      console.log(`Macchiato: HID write failed (${this._writeFailures}/${MAX_WRITE_FAILURES}):`, e.message);
      // A single failed transfer usually means the device was busy, not unplugged.
      if (this._writeFailures >= MAX_WRITE_FAILURES) this._handleDisconnect();
      return false;
    }
  }

  // Coalesces a burst of volume changes into one transfer carrying the final
  // value. The local state is already updated, so the UI never waits.
  _queueVolumeWrite() {
    if (this._writeTimer) return;
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      if (this.connected) this._write(buildSetVolumeCommand(this.volume));
    }, WRITE_COALESCE_MS);
  }

  // Mute is a discrete action: it has to land now, not after the coalescing
  // window, and it must carry whatever value the user just dialled in.
  _writeVolumeNow() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this.connected) return false;
    return this._write(buildSetVolumeCommand(this.volume));
  }

  refresh() {
    // Don't interleave a read with a write that just happened, or with one that
    // is still waiting for the coalescing window.
    if (this._writeTimer) return;
    if (Date.now() - this._lastWriteAt < WRITE_SETTLE_MS) return;
    if (!this.connected) return;
    this._write(READ_VOLUME_COMMAND);
  }

  _startRefreshTimer() {
    this._stopRefreshTimer();
    this._refreshTimer = setInterval(() => this.refresh(), STATE_REFRESH_INTERVAL);
  }

  _stopRefreshTimer() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  _handleReport(buffer) {
    const volume = parseVolumeReport(buffer);
    if (volume === null) return;

    if (this.muted) {
      // While muted the device reports 0; keep our remembered level instead.
      if (volume === 0) return;
      // The device left the muted state on its own (knob turned, or the mute
      // write never landed). Publish that even when the level itself did not
      // change, otherwise the tray and the panel keep showing "muted".
      this.muted = false;
      this.preMuteVolume = null;
      if (volume === this.volume) {
        this._emitChange();
        return;
      }
    }

    if (volume === this.volume) return;

    this.volume = volume;
    this.fallbackVolume = volume;
    this._emitChange();
  }

  setVolume(volume) {
    const target = clampVolume(volume);
    if (!this.connected) return false;

    this.volume = target;
    this.fallbackVolume = target;
    if (this.muted) {
      this.muted = false;
      this.preMuteVolume = null;
    }
    this._emitChange();
    this._queueVolumeWrite();
    return true;
  }

  adjustVolume(delta) {
    if (!this.connected) return false;
    if (this.volume === null) this.refresh();
    const base = this.volume === null ? this.fallbackVolume : this.volume;
    return this.setVolume(base + delta);
  }

  toggleMute() {
    if (!this.connected) return false;

    if (this.muted) {
      const restore = this.preMuteVolume === null ? (this.volume || 50) : this.preMuteVolume;
      this.muted = false;
      this.preMuteVolume = null;
      this.volume = restore;
      this.fallbackVolume = restore;
      this._emitChange();
      this._writeVolumeNow();
      return true;
    }

    const remembered = this.volume === null ? 50 : this.volume;
    // A queued write would land after the mute and undo it.
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    if (!this._write(buildSetVolumeCommand(0))) return false;

    this.preMuteVolume = remembered;
    this.muted = true;
    this._emitChange();
    return true;
  }
}

module.exports = MacchiatoDevice;
module.exports.parseVolumeReport = parseVolumeReport;
module.exports.buildSetVolumeCommand = buildSetVolumeCommand;
