import type { ReactNode } from "react";
import type { ToolDef, ToolName } from "../../../../core/tools/ToolRegistry";
import { SettingDisclosure } from "../../components/SettingDisclosure";

export type ToolSettingItemProps = {
  tool: ToolDef;
  enabled: boolean;
  onToggle: (name: ToolName, enabled: boolean) => void;

  /** Optional tool-specific settings UI shown when expanded. */
  details?: ReactNode;
};

/**
 * Tool settings item.
 *
 * Collapsed: one-line title + enable switch.
 * Expanded: details/config (currently: description + id).
 */
export function ToolSettingItem(props: ToolSettingItemProps) {
  const { tool, enabled, onToggle, details } = props;

  return (
    <SettingDisclosure
      title={tool.label}
      ariaLabel={`Tool settings: ${tool.label}`}
      right={
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(tool.name, e.target.checked)}
          aria-label={`Enable tool: ${tool.label}`}
        />
      }
    >

      {details ? <div>{details}</div> : null}
      <div className="devNoteText muted" style={{ marginTop: 0 }}>
        {tool.description}
      </div>
    </SettingDisclosure>
  );
}
