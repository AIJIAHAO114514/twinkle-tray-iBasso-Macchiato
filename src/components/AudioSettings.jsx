import React from "react"
import { SettingsOption } from "./SettingsOption"

// The audio page no longer configures a switch target: the panel button
// always targets the previously used output and falls back to the next
// device in the list. Only behavioral toggles remain here.
export default function AudioSettings({ T, renderToggle }) {
    return (
        <div className="pageSection">
            <div className="sectionTitle">{T.t("SETTINGS_AUDIO_TITLE")}</div>

            <SettingsOption
                title={T.t("SETTINGS_AUDIO_VOLUME_PREVIEW_TITLE")}
                description={T.t("SETTINGS_AUDIO_VOLUME_PREVIEW_DESC")}
                input={renderToggle("volumePreviewSound")}
            />
        </div>
    )
}
