import React from "react";
import Chip, { injuryChipTone } from "./Chip";
import ProjectionTrustLabel from "./ProjectionTrustLabel";
import {
  canLabelIncludedInProjection,
  commentaryOnlyLabel,
  formatOppPoints,
  mediaSignalLabel,
  mediaSignalTone,
  shouldShowProjectionAssumesActive,
} from "./playerContextDisplay";
import { canShowCurrentWeekMediaBadge } from "./mediaContext";

/**
 * Compact chips for weekly list rows — availability / opportunity / media
 * from the cached player-context read model, with SCORE-24 trust labels.
 */
export default function PlayerContextBadges({
  context,
  slateMeta = null,
  className = "",
}) {
  if (!context) return null;

  const avail = context.availability;
  const opp = context.opportunity_adjustment;
  const media = context.media_context;
  const showIncluded = canLabelIncludedInProjection(context, slateMeta);
  const showAssumesActive = shouldShowProjectionAssumesActive(context);
  const commentaryLabel = commentaryOnlyLabel(media);
  const chips = [];

  if (avail?.status) {
    chips.push(
      <span key="avail" className="player-context-badge-group">
        <Chip
          tone={injuryChipTone(avail.status)}
          className="player-context-badge"
          title={
            avail.practice
              ? `Availability: ${avail.status} · practice ${avail.practice}`
              : `Availability: ${avail.status}`
          }
        >
          {avail.status}
        </Chip>
        {showAssumesActive ? (
          <ProjectionTrustLabel kind="assumes_active" className="projection-trust-label--compact" />
        ) : null}
      </span>,
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
        <span key="opp" className="player-context-badge-group">
          <Chip
            tone={Number(opp.points) >= 0 ? "positive" : "negative"}
            className="player-context-badge player-context-badge--opp"
            title={`Opportunity adjustment ${pts} pts${driverHint}`}
          >
            Opp {pts}
          </Chip>
          {showIncluded ? (
            <ProjectionTrustLabel kind="included" className="projection-trust-label--compact" />
          ) : null}
        </span>,
      );
    }
  }

  // SCORE-28: only current-week media gets a list badge — never historical.
  if (canShowCurrentWeekMediaBadge(media)) {
    const label = mediaSignalLabel(media.signal);
    chips.push(
      <span key="media" className="player-context-badge-group">
        <Chip
          tone={mediaSignalTone(media.signal)}
          className="player-context-badge player-context-badge--media"
          title={
            media.summary
              || `${label}${media.source_count ? ` · ${media.source_count} sources` : ""} · ${commentaryLabel || "Commentary only"}`
          }
        >
          {label}
          {Number(media.source_count) > 0 ? (
            <span className="player-context-badge-meta">{media.source_count}</span>
          ) : null}
        </Chip>
        {commentaryLabel ? (
          <ProjectionTrustLabel kind="commentary" className="projection-trust-label--compact" />
        ) : null}
      </span>,
    );
  }

  if (!chips.length) return null;

  return (
    <span className={`player-context-badges ${className}`.trim()} aria-label="Cached player context">
      {chips}
    </span>
  );
}
