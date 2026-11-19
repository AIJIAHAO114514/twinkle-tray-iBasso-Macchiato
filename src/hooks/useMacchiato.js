import { useEffect, useState } from "react"

const EMPTY = { connected: false, volume: null, muted: false }
const EMPTY_OUTPUT = { available: false, isDefault: false, displayName: "" }

// Single source of truth for the DAC state in the renderer. The main process
// pushes every change (our writes, the device's own knob, plug/unplug); asking
// once on mount covers the case where the panel opens before any event fires.
export default function useMacchiato() {
    const [state, setState] = useState(window.macchiatoState || EMPTY)
    const [audioOutput, setAudioOutput] = useState(window.macchiatoAudioOutput || EMPTY_OUTPUT)

    useEffect(() => {
        const stateHandler = (event) => setState(event.detail || EMPTY)
        const outputHandler = (event) => setAudioOutput(event.detail || EMPTY_OUTPUT)
        window.addEventListener("macchiatoStateChanged", stateHandler)
        window.addEventListener("macchiatoAudioOutputChanged", outputHandler)

        // Await instead of synchronous IPC calls: the renderer never blocks on
        // the main process, and a late answer simply lands after the first paint.
        let cancelled = false
        Promise.resolve(window.ipc.invoke("macchiato-get-state"))
            .then((initial) => {
                if (!cancelled && initial) setState(initial)
            })
            .catch((e) => console.log("Could not read the initial DAC state", e))
        Promise.resolve(window.ipc.invoke("macchiato-get-audio-output"))
            .then((initial) => {
                if (!cancelled && initial) setAudioOutput(initial)
            })
            .catch((e) => console.log("Could not read the DAC audio output", e))

        return () => {
            cancelled = true
            window.removeEventListener("macchiatoStateChanged", stateHandler)
            window.removeEventListener("macchiatoAudioOutputChanged", outputHandler)
        }
    }, [])

    return { ...state, audioOutput }
}
