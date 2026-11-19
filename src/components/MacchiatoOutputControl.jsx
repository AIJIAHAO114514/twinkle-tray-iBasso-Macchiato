import React, { useEffect, useState } from "react"

// Compact routing control above the DAC volume row. It is deliberately a
// separate component from MacchiatoSlider: switching the Windows output and
// changing the device volume are different actions with different failure
// modes, even though both belong to the same DAC.
export default function MacchiatoOutputControl({ output, labels, onSelect }) {
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)

    // A successful change from anywhere (this button, Windows, another app)
    // clears the error state on its own.
    useEffect(() => {
        setFailed(false)
    }, [output.available, output.isDefault, output.displayName])

    let status = "set"
    if (!output.available) status = "unavailable"
    else if (output.isDefault) status = "current"
    else if (pending) status = "switching"
    else if (failed) status = "failed"

    const handleClick = async () => {
        if (pending || !onSelect || status === "current" || status === "unavailable") return

        setPending(true)
        setFailed(false)
        try {
            const result = await onSelect()
            if (!result || result.ok !== true) setFailed(true)
        } catch (e) {
            console.log("Could not switch the DAC audio output", e)
            setFailed(true)
        } finally {
            setPending(false)
        }
    }

    return (
        <div className="macchiato-output">
            <div className="macchiato-output-label">{labels.title}</div>
            <button
                type="button"
                className="macchiato-output-action"
                data-state={status}
                disabled={status !== "set" && status !== "failed"}
                title={output.displayName || undefined}
                onClick={handleClick}
            >
                {labels[status]}
            </button>
        </div>
    )
}
