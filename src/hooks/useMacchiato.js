import { useEffect, useState } from "react"

const EMPTY = { connected: false, volume: null, muted: false }

// Single source of truth for the DAC state in the renderer. The main process
// pushes every change (our writes, the device's own knob, plug/unplug); asking
// once on mount covers the case where the panel opens before any event fires.
export default function useMacchiato() {
    const [state, setState] = useState(window.macchiatoState || EMPTY)

    useEffect(() => {
        const handler = (event) => setState(event.detail || EMPTY)
        window.addEventListener("macchiatoStateChanged", handler)

        // Await instead of a synchronous IPC call: the renderer never blocks on
        // the main process, and a late answer simply lands after the first paint.
        let cancelled = false
        Promise.resolve(window.ipc.invoke("macchiato-get-state"))
            .then((initial) => {
                if (!cancelled && initial) setState(initial)
            })
            .catch((e) => console.log("Could not read the initial DAC state", e))

        return () => {
            cancelled = true
            window.removeEventListener("macchiatoStateChanged", handler)
        }
    }, [])

    return state
}
