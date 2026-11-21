import React from "react"
import { SettingsOption } from "./SettingsOption"

const AUTO_QUICK_SWITCH = "__auto__"

// Keeps audio-device discovery and the quick-switch target isolated from the
// rest of the settings window. The panel consumes the same target through
// MacchiatoService; this page only edits the persisted preference.
export default class AudioSettings extends React.Component {
    constructor(props) {
        super(props)
        const savedTargetId = window.settings?.quickSwitchOutputId || ""
        this.state = {
            // Start with a placeholder for a saved target so the select never
            // shows a blank value or flips from Automatic after the first load.
            audioOutputs: savedTargetId ? [{
                id: savedTargetId,
                displayName: window.settings?.quickSwitchOutputName || savedTargetId
            }] : [],
            quickSwitchSelection: savedTargetId || AUTO_QUICK_SWITCH
        }
        this.loadGeneration = 0
        this.mounted = false
    }

    componentDidMount() {
        this.mounted = true
        this.loadAudioOutputs()
        window.addEventListener("focus", this.handleWindowFocus)
    }

    componentWillUnmount() {
        this.mounted = false
        this.loadGeneration++
        window.removeEventListener("focus", this.handleWindowFocus)
    }

    handleWindowFocus = () => {
        this.loadAudioOutputs()
    }

    loadAudioOutputs = () => {
        if (typeof window.getAudioOutputs !== "function") return
        const generation = ++this.loadGeneration

        // Load each source independently: a failing quick-switch query must not
        // blank the device list, and a failing device query should keep the
        // last known list instead of falling back to an empty dropdown.
        const outputsRequest = typeof window.getAudioOutputs === "function"
            ? Promise.resolve().then(() => window.getAudioOutputs()).catch(e => {
                if (this.mounted) console.log("Could not read audio outputs", e)
                return null
            })
            : Promise.resolve(null)
        const quickSwitchRequest = typeof window.getQuickSwitchOutput === "function"
            ? Promise.resolve().then(() => window.getQuickSwitchOutput()).catch(e => {
                if (this.mounted) console.log("Could not read the quick switch target", e)
                return null
            })
            : Promise.resolve(null)

        Promise.all([outputsRequest, quickSwitchRequest])
            .then(([outputs, quickSwitchOutput]) => {
                if (!this.mounted || generation !== this.loadGeneration) return

                const list = Array.isArray(outputs)
                    ? outputs.slice()
                    : this.state.audioOutputs.slice()
                let selectedId = this.state.quickSwitchSelection
                if (quickSwitchOutput) {
                    selectedId = quickSwitchOutput.automatic
                        ? AUTO_QUICK_SWITCH
                        : (quickSwitchOutput.id || AUTO_QUICK_SWITCH)
                }

                // Keep an offline saved target visible instead of silently
                // showing a different option in the dropdown.
                if (selectedId !== AUTO_QUICK_SWITCH &&
                    !list.some(output => output.id === selectedId)) {
                    list.unshift({
                        id: selectedId,
                        displayName: quickSwitchOutput?.displayName ||
                            window.settings?.quickSwitchOutputName || "",
                        unavailable: true
                    })
                }

                this.setState({
                    audioOutputs: list,
                    quickSwitchSelection: selectedId
                })
            })
            .catch(e => {
                if (this.mounted) console.log("Could not load audio settings", e)
            })
    }

    changeQuickSwitchOutput = (event) => {
        const selection = event.target.value
        if (selection === AUTO_QUICK_SWITCH) {
            this.setState({ quickSwitchSelection: AUTO_QUICK_SWITCH })
            window.sendSettings({ quickSwitchOutputId: "", quickSwitchOutputName: "" })
            return
        }

        const output = this.state.audioOutputs.find(item => item.id === selection)
        if (!output) return

        const quickSwitchOutputName = output.displayName || output.endpointName || output.deviceName || output.id
        this.setState({ quickSwitchSelection: selection })
        window.sendSettings({
            quickSwitchOutputId: selection,
            quickSwitchOutputName
        })
    }

    render() {
        const { T, renderToggle } = this.props
        const { audioOutputs, quickSwitchSelection } = this.state

        return (
            <div className="pageSection">
                <div className="sectionTitle">{T.t("SETTINGS_AUDIO_TITLE")}</div>

                <SettingsOption
                    title={T.t("SETTINGS_AUDIO_QUICK_SWITCH_TITLE")}
                    description={T.t("SETTINGS_AUDIO_QUICK_SWITCH_DESC")}
                    input={(
                        <select
                            value={quickSwitchSelection}
                            onFocus={this.loadAudioOutputs}
                            onChange={this.changeQuickSwitchOutput}
                        >
                            <option value={AUTO_QUICK_SWITCH}>{T.t("SETTINGS_AUDIO_QUICK_SWITCH_AUTO")}</option>
                            {audioOutputs.map(output => (
                                <option key={output.id} value={output.id}>
                                    {(output.displayName || output.endpointName || output.deviceName || output.id) +
                                        (output.unavailable ? " " + T.t("SETTINGS_AUDIO_QUICK_SWITCH_UNAVAILABLE") : "")}
                                </option>
                            ))}
                        </select>
                    )}
                />

                <SettingsOption
                    title={T.t("SETTINGS_AUDIO_VOLUME_PREVIEW_TITLE")}
                    description={T.t("SETTINGS_AUDIO_VOLUME_PREVIEW_DESC")}
                    input={renderToggle("volumePreviewSound")}
                />
            </div>
        )
    }
}
