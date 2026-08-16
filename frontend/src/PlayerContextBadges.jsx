import React from "react";
import Chip, { injuryChipTone } from "./Chip";
import ProjectionTrustLabel from "./ProjectionTrustLabel";
import {
  canLabelIncludedInProjection,
  commentaryOnlyLabel,
  formatInjuryAgeHours,
  formatOppPoints,
  mediaSignalLabel,
  mediaSignalTone,
  shouldShowProjectionAssumesActive,
} from "./playerContextDisplay";
import { canShowCurrentWeekMediaBadge } from "./mediaContext";

/**
 * Compact chips for weekly list rows — availability / opportunity / media
 * from the SCORE-30 compact player-context list (no excerpts/sources/drivers).
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
  const ageLabel = formatInjuryAgeHours(avail?.age_hours);
  const chips = [];

  if (avail?.status) {
    const ageHint = ageLabel ? ` · ${ageLabel} old` : "";
    chips.push(
      <span key="avail" className="player-context-badge-group">
        <Chip
          tone={injuryChipTone(avail.status)}
          className="player-context-badge"
          title={
            avail.practice
              ? `Availability: ${avail.status} · practice ${avail.practice}${ageHint}`
              : `Availability: ${avail.status}${ageHint}`
          }
        >
          {avail.status}
          {ageLabel ? (
            <span className="player-context-badge-meta">{ageLabel}</span>
          ) : null}
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
      chips.push(
        <span key="opp" className="player-context-badge-group">
          <Chip
            tone={Number(opp.points) >= 0 ? "positive" : "negative"}
            className="player-context-badge player-context-badge--opp"
            title={`Opportunity adjustment ${pts} pts`}
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
  // SCORE-30: title from signal + source_count only (no summary body on list).
  if (canShowCurrentWeekMediaBadge(media)) {
    const label = mediaSignalLabel(media.signal);
    const count = Number(media.source_count) || 0;
    chips.push(
      <span key="media" className="player-context-badge-group">
        <Chip
          tone={mediaSignalTone(media.signal)}
          className="player-context-badge player-context-badge--media"
          title={`${label}${count ? ` · ${count} source${count === 1 ? "" : "s"}` : ""} · ${commentaryLabel || "Commentary only"}`}
        >
          {label}
          {count > 0 ? (
            <span className="player-context-badge-meta">{count}</span>
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
