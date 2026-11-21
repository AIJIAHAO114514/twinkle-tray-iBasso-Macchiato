import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import Slider from "./Slider";
import DDCCISliders from "./DDCCISliders"
import HDRSliders from "./HDRSliders";
import TranslateReact from "../TranslateReact"
import getMonitorName from "../utils/BrightnessPanel/getMonitorName";
import MacchiatoSlider from "./MacchiatoSlider";
import MacchiatoOutputControl from "./MacchiatoOutputControl";
import useMacchiato from "../hooks/useMacchiato";
import { usesGammaSlider, isAdjustableDisplay } from "./utilts/monitor.util";

const BrightnessPanel = memo(function BrightnessPanel() {

  const [state, setState] = useState({
    // The preload may receive monitor data before this component registers
    // its event listener, so begin with the latest available snapshot.
    monitors: window.allMonitors || {},
    hideDisplays: window.settings?.hideDisplays || {},
    linkedLevelsActive: false,
    names: {},
    sleeping: false,
    isRefreshing: window.isRefreshing
  })
  const [doBackgroundEvent, setDoBackgroundEvent] = useState(false)
  const [levelsChanged, setLevelsChanged] = useState(false)
  const [init, setInit] = useState(false)
  // Last level written per monitor id. This used to be a state array that was
  // never populated, so `brightness != undefined` was always true and every sync
  // wrote to every display, including the ones the user had not touched.
  const lastLevelsRef = useRef({})
  const [T] = useState(new TranslateReact({}, {}))
  const [, setLocalizationVersion] = useState(0)
  // Which OSD the main process asked for. DAC values come from useMacchiato.
  const [overlayState, setOverlayState] = useState(window.overlayState || { kind: null })
  const dac = useMacchiato()

  const numMonitors = useMemo(() => {
    let localNumMonitors = 0
    for (let key in state.monitors) {
      if ((isAdjustableDisplay(state.monitors[key]) || state.monitors[key].hdr === "active") && !(state.hideDisplays?.[key] === true)) localNumMonitors++;
    }
    return localNumMonitors
  }, [state.monitors, state.hideDisplays])

  // These were plain locals in the render body, which meant every render reset
  // them: the settings handler created a new interval whose handle was stored in
  // a throwaway binding (so the effect cleanup could never clear it), and the
  // height guard always compared against -1.
  const updateIntervalRef = useRef(null)
  const panelHeightRef = useRef(-1)

  // Enable/Disable linked levels
  const toggleLinkedLevels = () => {
    const linkedLevelsActive = (state.linkedLevelsActive ? false : true)
    setState(prev => ({ ...prev, linkedLevelsActive }))
    window.sendSettings({
      linkedLevelsActive
    })
  }

  // Handle <Slider> changes
  const handleChange = (level, slider) => {
    // Copy the monitors that actually change instead of mutating the objects
    // React already holds.
    const monitors = { ...state.monitors }
    if (numMonitors && state.linkedLevelsActive) {
      for (let key in monitors) {
        monitors[key] = { ...monitors[key], brightness: level }
      }
    } else if (numMonitors > 0) {
      const hwid = slider.props.hwid
      if (monitors[hwid]) monitors[hwid] = { ...monitors[hwid], brightness: level }
    }
    setState(prev => ({ ...prev, monitors }))
    setLevelsChanged(true)
    if (state.updateInterval === 999) syncBrightness()
    window.pauseMonitorUpdates()
  }

  // Update monitor info
  const recievedMonitors = (e) => {
    let newMonitors = { ...e.detail }
    // A refresh can report levels that differ from what we last wrote, so drop
    // the cache and let the next sync re-apply everything once.
    lastLevelsRef.current = {}
    // Reset panel height so it's recalculated
    panelHeightRef.current = -1
    setState(prev => ({
      ...prev,
      monitors: newMonitors
    }))
    // Delay initial adjustments
    if (!init) setTimeout(() => { setInit(true) }, 333)
  }

  const updateMinMax = (inMonitors = false) => {
    if (numMonitors > 0) {
      let newMonitors = Object.assign((inMonitors ? inMonitors : state.monitors), {})
      for (let key in newMonitors) {
        for (let remap in state.remaps) {
          if (newMonitors[key].name == remap) {
            newMonitors[key].min = state.remaps[remap].min
            newMonitors[key].max = state.remaps[remap].max
          }
        }
      }
      setLevelsChanged(true)
      if (inMonitors) {
        return inMonitors
      } else {
        setState(prev => ({
          ...prev,
          monitors: newMonitors
        }))
        setDoBackgroundEvent(true)
      }
    }
  }

  // Update settings
  const recievedSettings = (e) => {
    const settings = e.detail
    const linkedLevelsActive = (settings.linkedLevelsActive ?? false)
    const sleepAction = (settings.sleepAction ?? "none")
    const updateInterval = (settings.updateInterval || 500) * 1
    const remaps = (settings.remaps || {})
    const names = (settings.names || {})
    const hideDisplays = (settings.hideDisplays || {})
    setLevelsChanged(true)
    setState(prev => ({
      ...prev,
      linkedLevelsActive,
      remaps,
      names,
      hideDisplays,
      updateInterval,
      sleepAction
    }))
    resetBrightnessInterval()
    updateMinMax()
    setDoBackgroundEvent(true)
  }

  const recievedSleep = (e) => {
    setState(prev => ({ ...prev, sleeping: e.detail }))
  }



  // Send new brightness to monitors, if changed
  const syncBrightness = () => {
    const monitors = state.monitors
    if (init && levelsChanged && (window.showPanel || doBackgroundEvent) && numMonitors) {
      setDoBackgroundEvent(false)
      setLevelsChanged(false)
      try {
        for (let idx in monitors) {
          const monitor = monitors[idx]
          if (!isAdjustableDisplay(monitor)) continue
          if (lastLevelsRef.current[monitor.id] === monitor.brightness) continue
          lastLevelsRef.current[monitor.id] = monitor.brightness
          window.updateBrightness(monitor.id, monitor.brightness)
        }
      } catch (e) {
        console.error("Could not update brightness")
      }
    }
  }

  const resetBrightnessInterval = () => {
    if (updateIntervalRef.current) clearInterval(updateIntervalRef.current)
    updateIntervalRef.current = setInterval(() => syncBrightness(), (state.updateInterval || 500))
  }

  const handleIsRefreshingUpdate = (e) => setState(prev => ({ ...prev, isRefreshing: e.detail }))
  const handleOverlayState = (e) => setOverlayState(e.detail || { kind: null })

  useEffect(() => {
    resetBrightnessInterval()
    return () => {
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current)
      updateIntervalRef.current = null
    }
  }, [state.monitors, numMonitors, doBackgroundEvent, levelsChanged, init])


  useEffect(() => {
    const handleMonitorsUpdated = (e) => recievedMonitors(e)
    const handleSettingsUpdated = (e) => recievedSettings(e)
    const handleLocalizationUpdated = (e) => {
      T.setLocalizationData(e.detail.desired, e.detail.default)
      setLocalizationVersion(version => version + 1)
    }
    const handleSleepUpdated = (e) => recievedSleep(e)
    const handleRefreshingUpdated = (e) => handleIsRefreshingUpdate(e)
    const handleOverlayUpdated = (e) => handleOverlayState(e)

    window.addEventListener("monitorsUpdated", handleMonitorsUpdated)
    window.addEventListener("settingsUpdated", handleSettingsUpdated)
    window.addEventListener("localizationUpdated", handleLocalizationUpdated)
    window.addEventListener("sleepUpdated", handleSleepUpdated)
    window.addEventListener("isRefreshing", handleRefreshingUpdated)
    window.addEventListener("overlayStateChanged", handleOverlayUpdated)

    // Update brightness every interval, if changed
    window.requestSettings()
    window.requestMonitors()
    window.ipc.send('request-localization')
    window.reactReady = true

    return () => {
      window.removeEventListener("monitorsUpdated", handleMonitorsUpdated)
      window.removeEventListener("settingsUpdated", handleSettingsUpdated)
      window.removeEventListener("localizationUpdated", handleLocalizationUpdated)
      window.removeEventListener("sleepUpdated", handleSleepUpdated)
      window.removeEventListener("isRefreshing", handleRefreshingUpdated)
      window.removeEventListener("overlayStateChanged", handleOverlayUpdated)
    }
  }, [])

  useEffect(() => {
    const height = window.document.getElementById("panel").offsetHeight
    if (panelHeightRef.current === height) return
    panelHeightRef.current = height
    window.sendHeight(height)
  })

  const getMonitors = () => {
    if (!state.monitors || numMonitors == 0) {
      if (state.isRefreshing) {
        return (<div className="no-displays-message" style={{ textAlign: "center", paddingBottom: "15px" }}>{T.t("GENERIC_DETECTING_DISPLAYS")}</div>)
      }
      return (<div className="no-displays-message">{T.t("GENERIC_NO_COMPATIBLE_DISPLAYS")}</div>)
    } else {
      if (state.linkedLevelsActive) {
        // Combine all monitors
        let lastValidMonitor
        for(const key in state.monitors) {
          const monitor = state.monitors[key]
          if(monitor.type == "wmi" || monitor.type == "studio-display" || monitor.type == "software" || (monitor.type == "ddcci" && monitor.brightnessType) || monitor.hdr === "active" || usesGammaSlider(monitor)) {
           lastValidMonitor = monitor 
          }
        }
        if (lastValidMonitor) {
          const monitor = lastValidMonitor
          return (
            <Slider name={T.t("GENERIC_ALL_DISPLAYS")} id={monitor.id} level={monitor.brightness} min={0} max={100} num={monitor.num} monitortype={monitor.type} hwid={monitor.key} key={monitor.key} onChange={handleChange} scrollAmount={window.settings?.scrollFlyoutAmount} />
          )
        }
        return (<div className="no-displays-message">{T.t("GENERIC_NO_COMPATIBLE_DISPLAYS")}</div>)
      } else {
        // Show all valid monitors individually
        const sorted = Object.values(state.monitors).slice(0).sort((a, b) => {
          const aSort = (a.order === undefined ? 999 : a.order * 1)
          const bSort = (b.order === undefined ? 999 : b.order * 1)
          return aSort - bSort
        })
        let useFeatures = false
        // Check if we should use the extended DDC/CI layout or simple layout
        for (const { hwid } of sorted) {
          const monitorFeatures = window.settings?.monitorFeatures?.[hwid[1]]
          for (const vcp in monitorFeatures) {
            if (vcp == "0x10" || vcp == "0x13" || vcp == "0xD6") {
              continue; // Skip if brightness or power state
            }
            const feature = monitorFeatures[vcp]
            if (feature) {
              // Feature is active
              // Now we check if there are any settings active for the feature
              const featureSettings = window.settings.monitorFeaturesSettings?.[hwid[1]]
              if (!(featureSettings?.[vcp]?.linked)) {
                // Isn't linked
                useFeatures = true
              }
            }
          }
        }

        return sorted.map((monitor) => {
          if ((!isAdjustableDisplay(monitor) && monitor.hdr !== "active") || window.settings?.hideDisplays?.[monitor.key] === true) {
            return (<div key={monitor.key}></div>)
          } else {
            if (monitor.type == "wmi" || monitor.type == "studio-display" || monitor.type == "software" || (monitor.type == "ddcci" && monitor.brightnessType) || monitor.hdr === "active" || usesGammaSlider(monitor)) {

              let hasFeatures = true
              let featureCount = 0
              const monitorFeatures = window.settings?.monitorFeatures?.[monitor.hwid[1]]
              const features = ["0x12", "0xD6", "0x62"]
              if (monitor.features) {
                features.forEach(f => {
                  // Check monitor features
                  if (monitor.features[f] && monitor.features[f].length > 1) {
                    // Check that user has enabled feature
                    if (monitorFeatures && monitorFeatures[f]) {
                      // Track feature
                      hasFeatures = true
                      featureCount++
                    }
                  }
                })
              }
              let showHDRSliders = false
              if((monitor.hdr === "active" || window.settings?.hdrDisplays?.[monitor.key]) && !(window.settings?.sdrAsMainSliderDisplays?.[monitor.key])) {
                // Has HDR slider enabled
                hasFeatures = true
                useFeatures = true
                showHDRSliders = true
              }
              const powerOff = () => {
                window.ipc.send("sleep-display", monitor.hwid.join("#"))
                monitor.features["0xD6"][0] = (monitor.features["0xD6"][0] >= 4 ? 1 : settings.ddcPowerOffValue)
              }
              const showPowerButton = () => {
                const customFeatureEnabled = window.settings?.monitorFeaturesSettings?.[monitor?.hwid[1]]?.["0xD6"]
                if (monitorFeatures?.["0xD6"] && (monitor.features?.["0xD6"] || customFeatureEnabled)) {
                  return (<div className="feature-power-icon simple" onClick={powerOff}><span className="icon vfix">&#xE7E8;</span><span>{(monitor.features?.["0xD6"][0] >= 4 ? T.t("PANEL_LABEL_TURN_ON") : T.t("PANEL_LABEL_TURN_OFF"))}</span></div>)
                }
              }

              // Check if it's an HDR display and only supports SDR brightness adjustment.
              const isHDROnlySDR = (monitor.hdr === "active" || monitor.hdr === "supported") && monitor.type === "none" && !usesGammaSlider(monitor);
              
              if (!useFeatures || !hasFeatures) {
                // For HDR displays that only support SDR, the HDR slider is displayed directly instead of the regular brightness slider.
                if (isHDROnlySDR) {
                  return (
                    <div className="monitor-sliders extended" key={monitor.key}>
                      <div className="monitor-item" style={{ height: "auto", paddingBottom: "18px" }}>
                        <div className="name-row">
                          <div className="icon"><span>&#xE7F4;</span></div>
                          <div className="title">{getMonitorName(monitor, state.names)}</div>
                          { showPowerButton() }
                        </div>
                      </div>
                      <HDRSliders monitor={monitor} scrollAmount={window.settings?.scrollFlyoutAmount} />
                    </div>
                  )
                }
                return (
                  <div className="monitor-sliders" key={monitor.key}>
                    <Slider name={getMonitorName(monitor, state.names)} id={monitor.id} level={monitor.brightness} min={0} max={100} num={monitor.num} monitortype={monitor.type} hwid={monitor.key} key={monitor.key} onChange={handleChange} afterName={showPowerButton()} scrollAmount={window.settings?.scrollFlyoutAmount} />
                  </div>
                )
              } else {
                return (
                  <div className="monitor-sliders extended" key={monitor.key}>
                    <div className="monitor-item" style={{ height: "auto", paddingBottom: "18px" }}>
                      <div className="name-row">
                        <div className="icon">{(monitor.type == "wmi" ? <span>&#xE770;</span> : <span>&#xE7F4;</span>)}</div>
                        <div className="title">{getMonitorName(monitor, state.names)}</div>
                        {showPowerButton()}
                      </div>
                    </div>
                    {/* For HDR displays that only support SDR, hide the regular brightness slider. */}
                    { !isHDROnlySDR && (
                      <div className="feature-row feature-brightness">
                        <div className="feature-icon"><span className="icon vfix">&#xE706;</span></div>
                        <Slider id={monitor.id} level={monitor.brightness} min={0} max={100} num={monitor.num} monitortype={monitor.type} hwid={monitor.key} key={monitor.key} onChange={handleChange} scrollAmount={window.settings?.scrollFlyoutAmount} />
                      </div>
                    )}
                    <DDCCISliders monitor={monitor} monitorFeatures={monitorFeatures} scrollAmount={window.settings?.scrollFlyoutAmount} />
                    {showHDRSliders ? <HDRSliders monitor={monitor} scrollAmount={window.settings?.scrollFlyoutAmount} /> : null}
                  </div>
                )
              }
            }
          }
        })
      }
    }
  }

  // The row follows the active output: DAC HID while the Macchiato is the
  // default, Windows endpoint volume for every other device.
  const activeVolume = dac.activeVolume
  // Both HID and endpoint-backed volume use the Windows playback device name.
  const activeLabel = activeVolume.displayName || T.t("PANEL_MACCHIATO_AUDIO_OUTPUT")
  const quickSwitchOutput = dac.quickSwitchOutput
  // Use the same Windows endpoint name shown in the settings dropdown.
  const quickSwitchName = quickSwitchOutput.displayName || T.t("PANEL_MACCHIATO_AUDIO_OUTPUT")
  const hasQuickSwitchOutput = !!quickSwitchOutput.id
  const hasCurrentOutput = !!dac.currentOutput?.id
  // The menu is generic, so it stays available even when there is no
  // switchable target (no recorded previous device, DAC unplugged, etc.).
  const showOutputControl = hasQuickSwitchOutput || hasCurrentOutput || dac.connected || dac.audioOutput.available
  const getActiveVolumeSlider = () => (
    <MacchiatoSlider
      label={activeLabel}
      volume={activeVolume.volume}
      muted={activeVolume.muted}
      onVolumeChange={(value) => window.ipc.send("macchiato-set-volume", value)}
      onVolumePreview={() => window.ipc.send("macchiato-preview-volume")}
      onToggleMute={() => window.ipc.send("macchiato-toggle-mute")}
      scrollAmount={window.settings?.scrollFlyoutAmount}
    />
  )

  const getVolumeOsd = () => (
    <div className="monitor-sliders" key="active-volume-osd">{getActiveVolumeSlider()}</div>
  )

  return (
    <div className="window-base" data-theme={window.settings.theme || "default"} id="panel" data-refreshing={state.isRefreshing}>
      <div className="titlebar">
        <div className="title">{T.t("PANEL_TITLE")}</div>
        <div className="icons">
          {
            numMonitors > 1 &&
            <div
              title={T.t("PANEL_BUTTON_LINK_LEVELS")}
              data-active={state.linkedLevelsActive}
              onClick={toggleLinkedLevels}
              className="link">
              &#xE71B;
            </div>
          }
          {
            window.settings.sleepAction !== "none" &&
            <div
              title={T.t("PANEL_BUTTON_TURN_OFF_DISPLAYS")}
              className="off"
              onClick={window.turnOffDisplays}>
              &#xF71D;
            </div>
          }
          <div title={T.t("GENERIC_SETTINGS")} className="settings" onClick={window.openSettings}>&#xE713;</div>
        </div>
      </div>
      {state.sleeping ? (<div></div>) : (overlayState.kind === "volume" ? getVolumeOsd() : getMonitors())}
      {state.sleeping || overlayState.kind !== null || (!showOutputControl && !activeVolume.available) ? null : (
        <div className="macchiato-section">
          <hr className="macchiato-separator" />
          {showOutputControl ? (
            <MacchiatoOutputControl
              output={quickSwitchOutput}
              labels={{
                title: T.t("PANEL_MACCHIATO_AUDIO_OUTPUT"),
                set: T.t("PANEL_MACCHIATO_SET_DEFAULT", quickSwitchName),
                failed: T.t("PANEL_MACCHIATO_SWITCH_FAILED"),
                menu: T.t("PANEL_MACCHIATO_AUDIO_OUTPUT_MENU")
              }}
              onSelect={() => window.ipc.invoke("macchiato-set-default-output", quickSwitchOutput.id)}
              onOpenMenu={() => window.ipc.invoke("macchiato-open-audio-output-menu")}
            />
          ) : null}
          {activeVolume.available ? (
            <div className="monitor-sliders" key="active-volume-panel">{getActiveVolumeSlider()}</div>
          ) : null}
        </div>
      )}
      <div id="mica">
        <div className="displays" style={{ visibility: window.micaState.visibility }}>
          <div className="blur">
            <img alt="" src={window.micaState.src} width="2560" height="1440" />
          </div>
        </div>
        <div className="noise"></div>
      </div>
    </div>
  )
})

export default BrightnessPanel
