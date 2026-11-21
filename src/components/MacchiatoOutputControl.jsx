import React, { useEffect, useState } from "react"

// Compact routing control above the active volume row. It is deliberately a
// separate component from MacchiatoSlider: switching the Windows output and
// changing the device volume are different actions with different failure
// modes, even though both refer to the current playback path.
export default function MacchiatoOutputControl({ output, labels, onSelect, onOpenMenu }) {
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

    const handleMenuClick = async () => {
        if (!onOpenMenu) return
        try {
            await onOpenMenu()
        } catch (e) {
            console.log("Could not open the audio output menu", e)
        }
    }

    // "Already current" and "target missing" have no switch action, so the
    // status and the menu icon share one control: the whole row highlights and
    // opens the menu as a single hit target. With no target at all the control
    // is still shown as a neutral output picker, so the menu never disappears
    // just because the DAC is unplugged.
    const hasTarget = !!output.id
    const menuOnly = !hasTarget || status === "current" || status === "unavailable"
    const pickerLabel = hasTarget ? labels[status] : labels.menu
    const pickerTitle = hasTarget ? (output.displayName || labels.menu) : labels.menu
    const pickerAriaLabel = hasTarget ? `${labels.menu}: ${labels[status]}` : labels.menu

    const handleClick = async () => {
        if (pending || !onSelect) return

        setPending(true)
        setFailed(false)
        try {
            const result = await onSelect()
            if (!result || result.ok !== true) setFailed(true)
        } catch (e) {
            console.log("Could not switch the audio output", e)
            setFailed(true)
        } finally {
            setPending(false)
        }
    }

    return (
        <div className="macchiato-output">
            <div className="macchiato-output-label">{labels.title}</div>
            <div className="macchiato-output-actions">
                {menuOnly ? (
                    <button
                        type="button"
                        className="macchiato-output-picker"
                        title={pickerTitle}
                        aria-haspopup="menu"
                        aria-label={pickerAriaLabel}
                        onClick={handleMenuClick}
                    >
                        <span className="macchiato-output-status">{pickerLabel}</span>
                        <span className="macchiato-output-menu-icon" aria-hidden="true">&#xE700;</span>
                    </button>
                ) : (
                    <React.Fragment>
                        <button
                            type="button"
                            className="macchiato-output-action"
                            data-state={status}
                            disabled={status === "switching"}
                            title={output.displayName || undefined}
                            onClick={handleClick}
                        >
                            {labels[status]}
                        </button>
                        <button
                            type="button"
                            className="macchiato-output-menu"
                            title={labels.menu}
                            aria-label={labels.menu}
                            onClick={handleMenuClick}
                        >
                            <span aria-hidden="true">&#xE700;</span>
                        </button>
                    </React.Fragment>
                )}
            </div>
        </div>
    )
}
