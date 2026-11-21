import React, { Component } from "react"
import RangeInput from "./RangeInput"

// Volume row for the active playback output.
//
// The transport behind it changes (DAC HID or Windows endpoint volume), but the
// row only deals with a level and a mute state. Display sliders stay separate
// through Slider; both share RangeInput for the actual control.
export default class MacchiatoSlider extends Component {

    constructor(props) {
        super(props)
        this.state = {
            level: this.clamp(props.volume)
        }
        this.pointerGestureActive = false
        this.pointerGestureChanged = false
    }

    componentWillUnmount() {
        window.removeEventListener("pointerup", this.handlePointerUp)
        window.removeEventListener("pointercancel", this.handlePointerUp)
    }

    // The DAC reports its own volume, so a change coming from the device (the
    // knob) has to win over the local value.
    componentDidUpdate(oldProps) {
        if (oldProps.volume !== this.props.volume) {
            this.setState({ level: this.clamp(this.props.volume) })
        }
    }

    clamp = (value) => {
        const number = Number(value)
        if (!Number.isFinite(number)) return 0
        return Math.min(100, Math.max(0, Math.round(number)))
    }

    commit = (level) => {
        this.setState({ level })
        if (this.props.onVolumeChange) this.props.onVolumeChange(level)
    }

    handleChange = (event) => {
        // Clearing the field must not write 0 to the device mid-edit.
        if (event.target.value === "") return
        // Only a pointer gesture on the track counts as a preview gesture.
        // Keyboard, number-box edits and wheel scrolling stay silent.
        if (this.pointerGestureActive) this.pointerGestureChanged = true
        this.commit(this.clamp(event.target.value))
    }

    // Preview exactly once on release, not on every intermediate drag value.
    // The window listener catches a pointer released outside the slider.
    handlePointerDown = () => {
        this.pointerGestureActive = true
        this.pointerGestureChanged = false
        window.addEventListener("pointerup", this.handlePointerUp, { once: true })
        window.addEventListener("pointercancel", this.handlePointerUp, { once: true })
    }

    handlePointerUp = () => {
        window.removeEventListener("pointerup", this.handlePointerUp)
        window.removeEventListener("pointercancel", this.handlePointerUp)

        const changed = this.pointerGestureChanged
        this.pointerGestureActive = false
        this.pointerGestureChanged = false
        if (changed && this.props.onVolumePreview) this.props.onVolumePreview()
    }

    handleWheel = (event) => {
        const step = this.props.scrollAmount ?? 1
        this.commit(this.clamp(this.state.level + Math.sign(event.deltaY) * -1 * step))
    }

    render() {
        return (
            <div className="monitor-item macchiato-item" onWheel={this.handleWheel}>
                <div className="name-row">
                    <div className="icon macchiato-mute" onClick={this.props.onToggleMute}>
                        <span>&#xE767;</span>
                    </div>
                    <div className="title">{this.props.label}</div>
                </div>
                <RangeInput
                    level={this.state.level}
                    min={0}
                    max={100}
                    muted={this.props.muted}
                    onChange={this.handleChange}
                    onPointerDown={this.handlePointerDown}
                />
            </div>
        )
    }

}
