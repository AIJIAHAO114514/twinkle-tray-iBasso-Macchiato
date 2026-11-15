import React from "react";
import { Component } from "react"
import RangeInput from "./RangeInput";

// Display slider: brightness, contrast, VCP features and HDR all render through
// this. Value handling (wheel, typing, dragging) lives here; the markup lives in
// RangeInput so the DAC slider can share it.
//
// Fully controlled: the value shown is always props.level. The previous version
// kept a parallel copy in state and only re-synced it when min or max changed,
// so a level changed from outside (OSD, hotkey, another window) was ignored and
// the next wheel tick started from a stale value.
export default class Slider extends Component {

    cap = (level) => {
        const min = (this.props.min || 0) * 1
        const max = (this.props.max || 100) * 1
        const value = Number(level)
        if (!Number.isFinite(value)) return min
        return Math.min(max, Math.max(min, value))
    }

    fireChange = (level) => {
        const capped = this.cap(level)
        if (capped === this.cap(this.props.level)) return
        if (this.props.onChange && typeof this.props.onChange == "function") {
            this.props.onChange(capped, this)
        }
    }

    handleChange = (event) => {
        // Let the numeric field be cleared while typing instead of snapping to min.
        if (event.target.value === "") return
        this.fireChange(event.target.value)
    }

    handleWheel = (event) => {
        if (this.props.scrolling === false) return false
        const step = (this.props.scrollAmount ?? 1) * -Math.sign(event.deltaY)
        this.fireChange((Number(this.props.level) || 0) + step)
    }

    getName = () => {
        if (this.props.name) {
            return (
                <div className="name-row">
                    <div className="icon" style={{ display: (this.props.icon === false ? "none" : "block") }}>{(this.props.monitortype == "wmi" ? <span>&#xE770;</span> : <span>&#xE7F4;</span>)}</div>
                    <div className="title">{this.props.name}</div>
                    {this.props.afterName}
                </div>
            )
        }
    }

    render() {
        return (
            <div className="monitor-item" onWheel={this.handleWheel}>
                {this.getName()}
                <RangeInput
                    level={this.cap(this.props.level)}
                    min={this.props.min}
                    max={this.props.max}
                    height={this.props.height}
                    onChange={this.handleChange}
                />
            </div>
        );
    }

};
