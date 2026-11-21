"use strict";
const WindowUtils = require("bindings")("windows_window_utils");
const BrightnessKeys = require("bindings")("windows_brightness_keys");
const PowerEvents = require("bindings")("windows_power_events");
const MediaStatus = require("bindings")("windows_media_status");
const AppStartup = require("bindings")("windows_app_startup");
const WindowMaterial = require("bindings")("windows_window_material");
const DisplayBrightness = require("bindings")("windows_display_brightness");
const AudioDevice = require("bindings")("windows_audio_device");
const KeyState = require("bindings")("windows_key_state");

module.exports = {
    BrightnessKeys: {
        register: BrightnessKeys.register,
        unregister: BrightnessKeys.unregister,
        getKey: BrightnessKeys.getKey
    },
    WindowUtils: {
        setWindowPos: WindowUtils.setWindowPos,
        getWindowPos: WindowUtils.getWindowPos,
        getClientPos: WindowUtils.getClientPos,
        setForegroundWindow: WindowUtils.setForegroundWindow,
        getForegroundWindow: WindowUtils.getForegroundWindow,
        getWindowLong: WindowUtils.getWindowLong,
        getWindowFullscreen: WindowUtils.getWindowFullscreen
    },
    PowerEvents: {
        registerPowerSettingNotifications: PowerEvents.registerPowerSettingNotifications,
        unregisterPowerSettingNotifications: PowerEvents.unregisterPowerSettingNotifications,
        getPowerSetting: PowerEvents.getPowerSetting,
    },
    MediaStatus: {
        getPlaybackStatus: MediaStatus.getPlaybackStatus,
        getPlaybackInfo: MediaStatus.getPlaybackInfo
    },
    AppStartup: {
        enable: AppStartup.enable,
        disable: AppStartup.disable
    },
    DisplayBrightness: {
        getBrightness: DisplayBrightness.getBrightness,
        setBrightness: DisplayBrightness.setBrightness
    },
    AudioDevice: {
        // { endpointName, deviceName, displayName, id } or null
        getDefaultRenderDevice: AudioDevice.getDefaultRenderDevice,
        // Every active playback endpoint, with isDefault on the eConsole one.
        getRenderDevices: AudioDevice.getRenderDevices,
        // Switches the default playback endpoint; no elevation required.
        setDefaultRenderDevice: AudioDevice.setDefaultRenderDevice,
        // { volume: 0-100, muted } for the given endpoint, or null.
        getRenderDeviceVolume: AudioDevice.getRenderDeviceVolume,
        setRenderDeviceVolume: AudioDevice.setRenderDeviceVolume,
        setRenderDeviceMuted: AudioDevice.setRenderDeviceMuted,
        // Watches volume/mute changes for one endpoint.
        startEndpointVolumeWatch: AudioDevice.startEndpointVolumeWatch,
        stopEndpointVolumeWatch: AudioDevice.stopEndpointVolumeWatch,
        // Fires whenever the default playback endpoint changes; returns false
        // when COM refuses to register, so callers can fall back to polling.
        startDefaultDeviceWatch: AudioDevice.startDefaultDeviceWatch,
        stopDefaultDeviceWatch: AudioDevice.stopDefaultDeviceWatch
    },
    KeyState: {
        isKeyPressed: KeyState.isKeyPressed
    },
    WindowMaterial: {
        setWindowMaterial: (hwnd, materialType = 1, cornersType = 2, darkModeSupported = true) => {
            return WindowMaterial.setWindowMaterial(hwnd, materialType, cornersType, (darkModeSupported ? 1 : 0))
        },
        setWindowAttribute: WindowMaterial.setWindowAttribute,
        setWindowCorners: (hwnd, cornerType = 0) => {
            return WindowMaterial.setWindowAttribute(hwnd, 33, cornerType)
        },
        setDarkModeSupported: (hwnd, enabled = 1) => {
            return WindowMaterial.setWindowAttribute(hwnd, 20, enabled)
        },
        setTransitionSupported: (hwnd, enabled = 1) => {
            return WindowMaterial.setWindowAttribute(hwnd, 3, enabled)
        }
    }
}
