import React, { Component } from "react"
import RangeInput from "./RangeInput"

// Volume row for the iBasso Macchiato DAC.
//
// Deliberately separate from Slider: a display slider maps a hardware level onto
// a monitor, this one drives a USB DAC over HID and carries mute state. Both
// share RangeInput for the actual control, so neither has to know about the
// other's semantics.
export default class MacchiatoSlider extends Component {

    constructor(props) {
        super(props)
        this.state = {
            level: this.clamp(props.volume)
        }
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
        this.commit(this.clamp(event.target.value))
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
                />
            </div>
        )
    }

}
