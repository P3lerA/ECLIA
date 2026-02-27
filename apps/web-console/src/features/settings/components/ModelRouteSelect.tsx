import React from "react";
import type { ModelRouteOption } from "../settingsUtils";

export type ModelRouteSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: ModelRouteOption[];
  disabled?: boolean;
  className?: string;
  defaultLabel?: string;
  includeDefaultOption?: boolean;
};

export function ModelRouteSelect(props: ModelRouteSelectProps) {
  const {
    value,
    onChange,
    options,
    disabled,
    className = "select",
    defaultLabel = "default (runtime active model)",
    includeDefaultOption = true
  } = props;
  const modelValue = String(value ?? "").trim();

  const optionSet = React.useMemo(() => new Set(options.map((o) => o.value)), [options]);
  const openaiOptions = React.useMemo(() => options.filter((o) => o.group === "OpenAI-compatible"), [options]);
  const anthropicOptions = React.useMemo(() => options.filter((o) => o.group === "Anthropic-compatible"), [options]);
  const codexOptions = React.useMemo(() => options.filter((o) => o.group === "Codex OAuth"), [options]);
  const showCustomModel = Boolean(modelValue && !optionSet.has(modelValue));

  return (
    <select className={className} value={modelValue} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {includeDefaultOption ? <option value="">{defaultLabel}</option> : null}

      {openaiOptions.length ? (
        <optgroup label="OpenAI-compatible">
          {openaiOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null}

      {anthropicOptions.length ? (
        <optgroup label="Anthropic-compatible">
          {anthropicOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null}

      {codexOptions.length ? (
        <optgroup label="Codex OAuth">
          {codexOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ) : null}

      {showCustomModel ? <option value={modelValue}>{`Custom: ${modelValue}`}</option> : null}
    </select>
  );
}
