import React from "react";
import type { SettingsDraft } from "../../settingsTypes";

export type SkillsSectionProps = {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;

  cfgLoading: boolean;
  cfgBaseAvailable: boolean;

  skillsAvailable: Array<{ name: string; summary: string }>;
};

export function SkillsSection(props: SkillsSectionProps) {
  const { draft, setDraft, cfgLoading, cfgBaseAvailable, skillsAvailable } = props;

  const devDisabled = cfgLoading || !cfgBaseAvailable;

  return (
    <>
        {!cfgBaseAvailable ? (
          <div className="devNoteText muted">Config service unavailable. Start the backend (pnpm dev:all) to edit skills.</div>
        ) : skillsAvailable.length === 0 ? (
          <div className="devNoteText muted">
            No skills discovered. Create a folder like <code>skills/my-skill/</code> with a <code>skill.md</code> inside.
          </div>
        ) : (
          <div className="stack">
            {skillsAvailable.map((s) => {
              const enabled = draft.skillsEnabled.includes(s.name);

              return (
                <div key={s.name} className="row">
                  <div className="row-left">
                    <div className="row-main">{s.name}</div>
                    <div className="row-sub muted">{s.summary || "(no summary)"}</div>
                  </div>

                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setDraft((d) => {
                        const cur = Array.isArray(d.skillsEnabled) ? d.skillsEnabled : [];
                        const next = new Set(cur);
                        if (on) next.add(s.name);
                        else next.delete(s.name);
                        return { ...d, skillsEnabled: Array.from(next).sort((a, b) => a.localeCompare(b)) };
                      });
                    }}
                    aria-label={`Enable skill ${s.name}`}
                    disabled={devDisabled}
                  />
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}
