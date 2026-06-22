/**
 * MacchiatoDevice.js
 * HID communication module for iBasso Macchiato USB DAC.
 *
 * Ported from the original C# MacchiatoDevice.cs:
 * - Volume read/write via HID reports
 * - Mute toggle
 * - Device connect/disconnect management
 *
 * Falls back to Mock mode if the node-hid native module is not installed.
 */

const { EventEmitter } = require('events');

// Load node-hid; fall back to mock mode if unavailable
let HID = null;
let isMockMode = true;
try {
  HID = require('node-hid');
  isMockMode = false;
  console.log('node-hid loaded (real device)');
} catch (e) {
  console.log('node-hid not available – using mock mode');
  console.log('  Install: npm install node-hid --save-optional');
}

// iBasso Macchiato USB VID/PID
const VENDOR_ID = 0x0661;
const PRODUCT_IDS = [0x0881, 0x0882];

// HID Report ID (matches original C# ReportId = 0x4B)
const REPORT_ID = 0x4B;

// Volume read command (matches original C# cmd byte sequence)
const READ_VOLUME_CMD = Buffer.from([
  REPORT_ID, 0x80, 0x3F, 0x08, 0x42, 0x10,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]);

// Build volume set command (matches original C# SetVolumeInternal)
// C# layout: buf[0]=ReportId, buf[1]=0x01, buf[2]=0x3F, buf[3]=0x08,
//            buf[4]=0x01, buf[5]=0x10, buf[6]=vol, buf[7]=vol
function buildSetVolumeCommand(volume) {
  const cmd = Buffer.alloc(64);
  const vol = Math.round(Math.max(0, Math.min(100, volume)));
  cmd[0] = REPORT_ID;  // 0x4B
  cmd[1] = 0x01;
  cmd[2] = 0x3F;
  cmd[3] = 0x08;
  cmd[4] = 0x01;
  cmd[5] = 0x10;
  cmd[6] = vol;
  cmd[7] = vol;        // C# writes volume twice
  return cmd;
}

class MacchiatoDevice extends EventEmitter {
  constructor() {
    super();
    this._device = null;
    this._volume = -1;
    this._muted = false;
    this._preMuteVolume = -1;
    this._connected = false;
    this._deviceName = '';
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 3;
    this._pollTimer = null;
    this._deviceWatcher = null;
    this._watcherErrorCount = 0;
  }

  // ── Properties ──
  get volume() { return this._volume; }
  get muted() { return this._muted; }
  get connected() { return this._connected; }
  get deviceName() { return this._deviceName; }
  get volumeUnknown() { return this._volume < 0; }

  // ── Find & open device ──
  findAndOpen() {
    // Mock mode: simulate a fake device
    if (isMockMode) {
      return this._openMock();
    }

    try {
      const devices = HID.devices();
      const target = devices.find(d =>
        d.vendorId === VENDOR_ID && PRODUCT_IDS.includes(d.productId)
      );

      if (!target) {
        console.log('iBasso Macchiato device not found');
        return false;
      }

      return this._open(target);
    } catch (e) {
      console.log('Device lookup failed:', e.message);
      return false;
    }
  }

  // Mock mode: simulate device connection
  _openMock() {
    this._connected = true;
    this._volume = 65;
    this._muted = false;
    this._deviceName = 'iBasso Macchiato (Mock)';
    console.log('Mock device ready: ' + this._deviceName + ' (vol: 65%)');
    this.emit('connected', { name: this._deviceName });
    this.emit('volume-changed', { volume: this._volume, muted: this._muted });
    return true;
  }

  _open(deviceInfo) {
    try {
      if (this._device) this.closeDevice();

      this._device = new HID.HID(deviceInfo.path);
      this._connected = true;
      this._reconnectAttempts = 0;
      this._deviceName = deviceInfo.product || 'iBasso Macchiato';

      console.log(`Connected: ${this._deviceName} (VID:${deviceInfo.vendorId}, PID:${deviceInfo.productId})`);

      // Read initial volume asynchronously
      this._readVolumeAsync();

      // Start listening for device data
      this._startListening();

      this.emit('connected', { name: this._deviceName });
      return true;
    } catch (e) {
      console.log('Connection failed:', e.message);
      this._connected = false;
      return false;
    }
  }

  // ── Read volume ──
  async _readVolumeAsync() {
    if (!this._device) return;
    try {
      // Drain HID input buffer
      await this._drainBuffer();

      // Send read command
      try {
        this._device.write(Array.from(READ_VOLUME_CMD));
      } catch (e) {
        console.log('Read volume write failed:', e.message);
        return;
      }

      // Read response (multiple attempts)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const buffer = this._device.readTimeout(50);
          if (!buffer || buffer.length < 6) continue;

          // Look for 0x10 marker and extract volume value
          for (let i = 0; i <= buffer.length - 2; i++) {
            if (buffer[i] === 0x10) {
              this._volume = Math.max(0, Math.min(100, buffer[i + 1]));
              this.emit('volume-changed', {
                volume: this._volume,
                muted: this._muted
              });
              return;
            }
          }
        } catch (e) {
          if (e.message && e.message.includes('timeout')) continue;
          throw e;
        }
      }
    } catch (e) {
      console.log('  Volume read failed:', e.message);
    }
  }

  // Synchronous read (called by UI thread via IPC sync)
  readVolume() {
    if (!this._device) return;
    try {
      this._drainBufferSync();
      this._device.write(Array.from(READ_VOLUME_CMD));

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const buffer = this._device.readTimeout(50);
          if (!buffer || buffer.length < 6) continue;

          for (let i = 0; i <= buffer.length - 2; i++) {
            if (buffer[i] === 0x10) {
              this._volume = Math.max(0, Math.min(100, buffer[i + 1]));
              this.emit('volume-changed', {
                volume: this._volume,
                muted: this._muted
              });
              return;
            }
          }
        } catch (e) {
          if (e.message && e.message.includes('timeout')) continue;
          throw e;
        }
      }
    } catch (e) {
      console.log('  Volume read failed:', e.message);
    }
  }

  // ── Write volume ──
  setVolume(vol) {
    const targetVolume = Math.max(0, Math.min(100, Math.round(vol)));

    if (isMockMode) {
      this._volume = targetVolume;
      if (targetVolume > 0) this._muted = false;

      this.emit('volume-changed', { volume: this._volume, muted: this._muted });
      return true;
    }

    if (!this._device) {
      console.log('Device not connected, cannot set volume');
      return false;
    }
    try {
      const cmd = buildSetVolumeCommand(targetVolume);
      this._device.write(Array.from(cmd));

      this._volume = targetVolume;
      if (targetVolume > 0 && this._muted) {
        this._muted = false;
      }


      this.emit('volume-changed', { volume: this._volume, muted: this._muted });
      return true;
    } catch (e) {
      console.log('Set volume failed:', e.message);
      return false;
    }
  }

  // Adjust volume relative to current level
  adjustVolume(delta) {
    if (this._volume < 0) {
      // 热插拔重连后音量可能尚未异步读取完毕，先同步读取再调节
      this.readVolume();
      if (this._volume < 0) return false;
    }
    const newVol = Math.max(0, Math.min(100, this._volume + delta));
    return this.setVolume(newVol);
  }

  // ── Mute toggle ──
  toggleMute() {
    if (isMockMode) {
      this._muted = !this._muted;

      this.emit('volume-changed', { volume: this._volume, muted: this._muted });
      return true;
    }

    if (!this._device) return false;

    if (this._muted) {
      const restoreVol = this._preMuteVolume >= 0 ? this._preMuteVolume : 50;
      this._muted = false;
      this._preMuteVolume = -1;
      this.setVolume(restoreVol);
    } else {
      this._preMuteVolume = this._volume;
      this._muted = true;
      const cmd = buildSetVolumeCommand(0);
      try {
        this._device.write(Array.from(cmd));
      } catch (e) {
        console.log('Toggle mute write failed:', e.message);
        this._muted = false;  // revert state on failure
        this.emit('volume-changed', { volume: this._volume, muted: this._muted });
        return false;
      }
    }

    this.emit('volume-changed', { volume: this._volume, muted: this._muted });
    return true;
  }

  setMute(muted) {
    if (muted === this._muted) return;
    this.toggleMute();
  }

  // ── Buffer drain ──
  async _drainBuffer() {
    return new Promise((resolve) => {
      if (!this._device) return resolve();
      try {
        for (let i = 0; i < 10; i++) {
          try {
            this._device.readTimeout(5);
          } catch (e) {
            break;
          }
        }
      } catch (e) { /* ignore */ }
      resolve();
    });
  }

  _drainBufferSync() {
    if (!this._device) return;
    try {
      for (let i = 0; i < 10; i++) {
        try {
          this._device.readTimeout(5);
        } catch (e) {
          break;
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ── Device data listener ──
  _startListening() {
    if (!this._device) return;
    // Volume only changes via our own setVolume() calls — no polling needed.
    // Initial read was done in _readVolumeAsync() during _open().
  }

  _startPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (this._device && this._connected) {
        this.readVolume();
      }
    }, 500);  // poll every 500ms
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ── Device hotplug watcher ──
  startDeviceWatcher() {
    this._stopDeviceWatcher();

    // Mock mode: HID unavailable, skip real device detection
    if (isMockMode) {
      console.log('Device watcher: mock mode – hotplug detection disabled');
      return;
    }

    this._deviceWatcher = setInterval(() => {
      try {
        const devices = HID.devices();
        this._watcherErrorCount = 0;
        const found = devices.some(d =>
          d.vendorId === VENDOR_ID && PRODUCT_IDS.includes(d.productId)
        );

        if (found && !this._connected) {
          console.log('Device inserted');
          this.findAndOpen();
        } else if (!found && this._connected) {
          console.log('Device removed');
          this._connected = false;
          this._volume = -1;
          this._preMuteVolume = -1;
          this._stopPolling();
          this.closeDevice();
          this.emit('disconnected');
        }
      } catch (e) {
        this._watcherErrorCount++;
        if (this._watcherErrorCount <= 3) {
          console.log('Device watcher error (attempt ' + this._watcherErrorCount + '):', e.message);
        } else {
          console.log('Device watcher error (suppressed):', e.message);
        }
      }
    }, 500);
  }

  _stopDeviceWatcher() {
    if (this._deviceWatcher) {
      clearInterval(this._deviceWatcher);
      this._deviceWatcher = null;
    }
  }

  // ── Reconnect ──
  tryReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.log(`Reconnect failed – max attempts (${this._maxReconnectAttempts})`);
      return false;
    }
    this._reconnectAttempts++;
    console.log(`Reconnect attempt ${this._reconnectAttempts}`);
    this.closeDevice();
    if (this.findAndOpen()) {
      this._reconnectAttempts = 0;
      return true;
    }
    return false;
  }

  // ── Close HID handle only (keep watcher & polling alive) ──
  closeDevice() {
    if (!isMockMode && this._device) {
      try {
        this._device.close();
      } catch (e) { /* ignore */ }
    }
    this._device = null;
    this._connected = false;
    this._volume = -1;
    this._preMuteVolume = -1;
  }

  // ── Full close (HID handle + watcher + polling) ──
  close() {
    this._stopPolling();
    this._stopDeviceWatcher();
    this.closeDevice();
  }

  // ── Release resources ──
  dispose() {
    this.close();
    this.removeAllListeners();
  }
}

module.exports = MacchiatoDevice;
