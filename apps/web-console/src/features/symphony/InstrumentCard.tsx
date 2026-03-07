import React from "react";
import type { InstrumentDetail } from "../../core/api/symphony";

const STATUS_LABELS: Record<string, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  error: "Error"
};

/**
 * Compact preview card for a single Symphony instrument.
 * Click opens the detail modal — the card itself is deliberately minimal.
 */
export function InstrumentCard(props: {
  data: InstrumentDetail;
  onClick: () => void;
}) {
  const { data, onClick } = props;

  return (
    <button
      className="instrumentCard"
      onClick={onClick}
      type="button"
      aria-label={`Configure ${data.name}`}
    >
      <div className="instrumentCard-head">
        <span className="instrumentCard-name">{data.name}</span>
        <span className={`instrumentCard-status ${data.status}`} data-status={data.status}>
          <span className="instrumentCard-statusDot" />
          {STATUS_LABELS[data.status] ?? data.status}
        </span>
      </div>

      <div className="instrumentCard-body">
        {data.triggers.map((t, i) => (
          <React.Fragment key={`t${i}`}>
            {i > 0 && <span className="instrumentCard-sep">+</span>}
            <span className="instrumentCard-pill trigger">{t.kind}</span>
          </React.Fragment>
        ))}
        {data.actions.length > 0 && <span className="instrumentCard-arrow">&#x2192;</span>}
        {data.actions.map((a, i) => (
          <React.Fragment key={`a${i}`}>
            {i > 0 && <span className="instrumentCard-sep">+</span>}
            <span className="instrumentCard-pill action">{a.kind}</span>
          </React.Fragment>
        ))}
      </div>

      {!data.enabled && (
        <div className="instrumentCard-disabled">Disabled</div>
      )}
    </button>
  );
}
