import React from "react";
import type { SettingsDraft } from "../../settingsTypes";
import { SettingsToggleRow } from "../../components/SettingsToggleRow";

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

      <SettingsToggleRow
        title="Disable background texture"
        description={webgl2Text}
        checked={draft.textureDisabled}
        onCheckedChange={(checked) => setDraft((d) => ({ ...d, textureDisabled: checked }))}
        ariaLabel="Disable background texture"
      />
    </div>
  );
}
