import React from "react";
import { runtime } from "../../../../core/runtime";
import type { ToolName } from "../../../../core/tools/ToolRegistry";
import type { SettingsDraft } from "../../settingsTypes";
import { WebToolSettings } from "./WebToolSettings";
import { ToolSettingItem } from "./ToolSettingItem";

export type ToolsSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  // Dev config state (used by some tool-specific settings).
  cfgLoading: boolean;
  cfgBaseAvailable: boolean;

  // Web tool provider profiles (dev-only; keys are never returned).
  cfgWebProfiles: Array<{ id: string; apiKeyConfigured: boolean }>;
  dirtyDevWeb: boolean;
  webValid: boolean;
};

export function ToolsSection(props: ToolsSectionProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, cfgWebProfiles, dirtyDevWeb, webValid } = props;
  const tools = runtime.tools.list();

  const enabled = React.useMemo(() => new Set<ToolName>(draft.enabledTools), [draft.enabledTools]);

  const toggle = (name: ToolName, nextEnabled: boolean) => {
    setDraft((d) => {
      const set = new Set<ToolName>(d.enabledTools);
      if (nextEnabled) set.add(name);
      else set.delete(name);

      // Keep stable order based on the registry.
      const ordered = runtime.tools.list().map((t) => t.name);
      const next = ordered.filter((n) => set.has(n));

      return { ...d, enabledTools: next };
    });
  };

  return (
    <>
      <div className="settings-subtitle">Tools</div>

      <div>
        {tools.map((t) => (
          <ToolSettingItem
            key={t.name}
            tool={t}
            enabled={enabled.has(t.name)}
            onToggle={toggle}
            details={
              t.name === "web" ? (
                <WebToolSettings
                  draft={draft}
                  setDraft={setDraft}
                  cfgLoading={cfgLoading}
                  cfgBaseAvailable={cfgBaseAvailable}
                  cfgWebProfiles={cfgWebProfiles}
                  dirtyDevWeb={dirtyDevWeb}
                  webValid={webValid}
                />
              ) : null
            }
          />
        ))}
      </div>
    </>
  );
}
