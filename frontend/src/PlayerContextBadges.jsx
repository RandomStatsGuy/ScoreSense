import React from "react";
import Chip, { injuryChipTone } from "./Chip";
import {
  formatOppPoints,
  mediaSignalLabel,
  mediaSignalTone,
} from "./playerContextDisplay";

/**
 * Compact chips for weekly list rows — availability / opportunity / media
 * from the cached player-context read model.
 */
export default function PlayerContextBadges({ context, className = "" }) {
  if (!context) return null;

  const avail = context.availability;
  const opp = context.opportunity_adjustment;
  const media = context.media_context;
  const chips = [];

  if (avail?.status) {
    chips.push(
      <Chip
        key="avail"
        tone={injuryChipTone(avail.status)}
        className="player-context-badge"
        title={
          avail.practice
            ? `Availability: ${avail.status} · practice ${avail.practice}`
            : `Availability: ${avail.status}`
        }
      >
        {avail.status}
      </Chip>,
    );
  }

  if (opp?.included) {
    const pts = formatOppPoints(opp.points);
    if (pts) {
      const driverHint =
        Array.isArray(opp.drivers) && opp.drivers.length
          ? ` · drivers: ${opp.drivers.slice(0, 3).join(", ")}`
          : "";
      chips.push(
        <Chip
          key="opp"
          tone={Number(opp.points) >= 0 ? "positive" : "negative"}
          className="player-context-badge player-context-badge--opp"
          title={`Opportunity adjustment ${pts} pts${driverHint}`}
        >
          Opp {pts}
        </Chip>,
      );
    }
  }

  if (media?.state === "current" && media?.signal) {
    const label = mediaSignalLabel(media.signal);
    chips.push(
      <Chip
        key="media"
        tone={mediaSignalTone(media.signal)}
        className="player-context-badge player-context-badge--media"
        title={
          media.summary
            || `${label}${media.source_count ? ` · ${media.source_count} sources` : ""} · does not affect projection`
        }
      >
        {label}
        {Number(media.source_count) > 0 ? (
          <span className="player-context-badge-meta">{media.source_count}</span>
        ) : null}
      </Chip>,
    );
  }

  if (!chips.length) return null;

  return (
    <span className={`player-context-badges ${className}`.trim()} aria-label="Cached player context">
      {chips}
    </span>
  );
}
