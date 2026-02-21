import React from "react";
import type { SettingsDraft } from "../../settingsTypes";

export type AppearanceSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  webgl2Text: string;
};

export function AppearanceSection(props: AppearanceSectionProps) {
  const { draft, setDraft, webgl2Text } = props;

  return (
    <div>
      <div className="card-title">Appearance</div>

      <div className="row">
        <div className="row-left">
          <div className="row-main">Disable background texture</div>
          <div className="row-sub muted">{webgl2Text}</div>
        </div>

        <input
          type="checkbox"
          checked={draft.textureDisabled}
          onChange={(e) => setDraft((d) => ({ ...d, textureDisabled: e.target.checked }))}
          aria-label="Disable background texture"
        />
      </div>
    </div>
  );
}
