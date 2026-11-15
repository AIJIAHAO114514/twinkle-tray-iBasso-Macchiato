import React from "react"
import { displayLevel } from "./utilts/monitor.util"

// Presentational only: the range track, its filled progress and the numeric box.
// Both the display slider and the DAC volume slider render this, which keeps the
// markup in one place. All value handling stays in the caller.
export default function RangeInput(props) {
    const min = (props.min === undefined ? 0 : props.min) * 1
    const max = (props.max === undefined ? 100 : props.max) * 1
    const level = Math.min(max, Math.max(min, (props.level === undefined ? 0 : props.level) * 1))
    const percent = (max === min ? 0 : ((level - min) * (100 / (max - min)))) + "%"

    const progressStyle = (props.muted ? { width: percent, background: "var(--muted-color)" } : { width: percent })
    const valueStyle = (props.muted ? { color: "var(--muted-color)" } : undefined)

    return (
        <div className="input--range" data-height={props.height}>
            <div className="rangeGroup">
                <input
                    type="range"
                    min={min}
                    max={max}
                    value={level}
                    data-percent={displayLevel(level) + "%"}
                    onChange={props.onChange}
                    className="range"
                />
                <div className="progress" style={progressStyle}></div>
            </div>
            <input
                type="number"
                min={min}
                max={max}
                value={displayLevel(level)}
                onChange={props.onChange}
                className="val"
                style={valueStyle}
            />
        </div>
    )
}
