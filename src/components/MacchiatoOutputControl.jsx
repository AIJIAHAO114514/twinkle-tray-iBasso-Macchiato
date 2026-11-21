import React, { useEffect, useRef, useState } from "react"

// Compact routing control above the active volume row. It is deliberately a
// separate component from MacchiatoSlider: switching the Windows output and
// changing the device volume are different actions with different failure
// modes, even though both refer to the current playback path.
//
// The switch action and the device menu are fully decoupled: the menu button
// is always rendered on its own, and the switch button only appears when a
// switchable target exists. The menu never disappears just because there is
// nothing to switch to.
//
// A switch in progress keeps the button exactly as it was: a visible
// in-progress label would read as flicker on such a fast action. A ref
// guards against double clicks without a re-render.
export default function MacchiatoOutputControl({ output, labels, onSelect, onOpenMenu }) {
    const pendingRef = useRef(false)
    const [failed, setFailed] = useState(false)

    // A successful change from anywhere (this button, Windows, another app)
    // clears the error state on its own.
    useEffect(() => {
        setFailed(false)
    }, [output.available, output.isDefault, output.displayName])

    const status = failed ? "failed" : "set"

    const handleMenuClick = async () => {
        if (!onOpenMenu) return
        try {
            await onOpenMenu()
        } catch (e) {
            console.log("Could not open the audio output menu", e)
        }
    }

    const handleClick = async () => {
        if (pendingRef.current || !onSelect) return

        pendingRef.current = true
        setFailed(false)
        try {
            const result = await onSelect()
            if (!result || result.ok !== true) setFailed(true)
        } catch (e) {
            console.log("Could not switch the audio output", e)
            setFailed(true)
        } finally {
            pendingRef.current = false
        }
    }

    const hasTarget = !!(output.id && output.available)

    return (
        <div className="macchiato-output">
            <div className="macchiato-output-label">{labels.title}</div>
            <div className="macchiato-output-actions">
                {hasTarget ? (
                    <button
                        type="button"
                        className="macchiato-output-action"
                        data-state={status}
                        title={output.displayName || undefined}
                        onClick={handleClick}
                    >
                        {labels[status]}
                    </button>
                ) : null}
                <button
                    type="button"
                    className="macchiato-output-menu"
                    title={labels.menu}
                    aria-label={labels.menu}
                    aria-haspopup="menu"
                    onClick={handleMenuClick}
                >
                    <span aria-hidden="true">&#xE700;</span>
                </button>
            </div>
        </div>
    )
}
