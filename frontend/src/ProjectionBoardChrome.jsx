import React from "react";
import { BOARD_COPY } from "./projectionsPresentation";
import { usePlayerCardOptional } from "./PlayerCardContext";

export function ProjectionBoardSignals({ signals = [], playerParams = null }) {
  const card = usePlayerCardOptional();
  if (!signals.length) return null;
  return (
    <div className="proj-signals" role="list" aria-label="Board signals">
      {signals.map((signal) => {
        const clickable = Boolean(signal.playerId && card);
        const Tag = clickable ? "button" : "div";
        return (
          <Tag
            key={signal.id}
            type={clickable ? "button" : undefined}
            role="listitem"
            className={`proj-signal${signal.tone ? ` proj-signal--${signal.tone}` : ""}${clickable ? " proj-signal--open" : ""}`}
            onClick={clickable ? () => card.openPlayerCard({
              ...(playerParams || {}),
              playerId: signal.playerId,
              name: signal.row?.Player || signal.row?.player_name || signal.playerName || signal.name,
              team: signal.row?.Team,
            }) : undefined}
          >
            <p className="proj-signal-kicker">{signal.kicker}</p>
            <p className="proj-signal-name">{signal.name}</p>
            <p className="proj-signal-value">{signal.value}</p>
          </Tag>
        );
      })}
    </div>
  );
}

export function ProjectionBoardHeader({
  kicker,
  title = BOARD_COPY.weeklyBoard,
  support,
  filters = [],
  activeFilter,
  onFilterChange,
}) {
  return (
    <div className="proj-board-head">
      <div className="proj-board-head-copy">
        {kicker ? <p className="proj-board-kicker">{kicker}</p> : null}
        <h2 className="proj-board-title">{title}</h2>
        {support ? <p className="proj-board-support">{support}</p> : null}
      </div>
      {filters.length ? (
        <div className="proj-board-filters" role="group" aria-label="Board filters">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`proj-board-filter${activeFilter === filter.id ? " is-active" : ""}`}
              aria-pressed={activeFilter === filter.id}
              onClick={() => onFilterChange?.(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectionBoardDisclosure({
  title,
  summary,
  children,
  tone,
}) {
  return (
    <details className={`proj-disclosure${tone ? ` proj-disclosure--${tone}` : ""}`}>
      <summary className="proj-disclosure-summary-row">
        <span className="proj-disclosure-title">{title}</span>
        <span className="proj-disclosure-copy">{summary}</span>
      </summary>
      <div className="proj-disclosure-body">{children}</div>
    </details>
  );
}
