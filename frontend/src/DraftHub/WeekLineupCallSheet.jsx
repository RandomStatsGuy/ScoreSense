import React, { useEffect, useRef, useState } from "react";
import { fmtNum } from "../format";
import {
  PAINT_WIDTH,
  headshotCandidates,
  lookupPlayerMedia,
  paintMediaUrl,
  playerFaceInitials,
  teamLogoUrl,
} from "./draftMedia";
import {
  WEEK_BOARD_COPY,
  callFaceMeta,
  callPpgNote,
  callStartLinkProps,
  callTitle,
  formatDefVsFact,
  formatKickoffFact,
  formatPriorPpgFact,
  formatVegasFact,
  keepCallLabel,
  lineupCallAction,
  priorPpgSeason,
  startCallLabel,
} from "./weekBoard";

function fmtPts(value) {
  return value == null || value === "" ? WEEK_BOARD_COPY.emptyFact : fmtNum(value, 1);
}

function CallFace({ player, media, role, going = false, paintWidth = PAINT_WIDTH.mark }) {
  const [shotIndex, setShotIndex] = useState(0);
  const row = lookupPlayerMedia(media, player?.player_id);
  const shots = headshotCandidates(row, [], { width: paintWidth });
  const headshot = shots[shotIndex] || null;
  const logo = paintMediaUrl(row?.team_logo_url, paintWidth)
    || teamLogoUrl(player?.team, { width: paintWidth });
  const name = player?.player_name || player?.player_id || "";
  const initials = playerFaceInitials(player);

  useEffect(() => {
    setShotIndex(0);
  }, [player?.player_id, row?.headshot_url, row?.espn_headshot_url]);

  return (
    <div className={`hub-wcc-ticket-who${going ? " is-go" : ""}`}>
      {headshot ? (
        <img
          className="hub-wcc-ticket-face"
          src={headshot}
          alt=""
          onError={() => setShotIndex((n) => n + 1)}
        />
      ) : logo ? (
        <img className="hub-wcc-ticket-face" src={logo} alt="" />
      ) : (
        <span className="hub-wcc-ticket-face is-fallback" aria-hidden="true">
          {initials}
        </span>
      )}
      <p className="hub-wcc-ticket-role">{role}</p>
      <h3>{name || WEEK_BOARD_COPY.emptySlotName}</h3>
      <p className="hub-wcc-ticket-meta">{callFaceMeta(player)}</p>
    </div>
  );
}

function FactLane({ player, season }) {
  const pos = String(player?.position || "").toUpperCase();
  const facts = [
    { id: "vegas", label: WEEK_BOARD_COPY.vegas, value: formatVegasFact(player) },
    {
      id: "ppg",
      label: WEEK_BOARD_COPY.priorPpg(player?.prior_ppg_season ?? priorPpgSeason(season)),
      value: formatPriorPpgFact(player),
    },
    { id: "dvp", label: WEEK_BOARD_COPY.defVs(pos || "pos"), value: formatDefVsFact(player) },
    { id: "kick", label: WEEK_BOARD_COPY.kickoff, value: formatKickoffFact(player) },
  ];
  return (
    <div className="hub-wcc-ticket-lane">
      {facts.map((fact) => (
        <div key={fact.id} className="hub-wcc-ticket-stat">
          <span>{fact.label}</span>
          <b>{fact.value}</b>
        </div>
      ))}
    </div>
  );
}

export default function WeekLineupCallSheet({
  decision,
  starter,
  bench,
  media = {},
  season,
  week,
  canEdit = false,
  lineupLocked = false,
  sleeperLeagueId = "",
  busy = false,
  onClose,
  onApply,
}) {
  const closeRef = useRef(null);
  const prevFocusRef = useRef(null);
  const titleId = "hub-wcc-ticket-title";
  const callAction = lineupCallAction({ canEdit, lineupLocked, sleeperLeagueId });
  const title = callTitle(decision);
  const startLabel = startCallLabel(decision);
  const keepLabel = keepCallLabel(decision);
  const delta = decision?.delta_p50;
  const sleeperHref = callAction.kind === "sleeper" ? callAction.href : "";
  const canApply = callAction.kind === "apply" && onApply;
  const locked = callAction.kind === "locked";

  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      const prev = prevFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const startBody = (
    <>
      <span>{startLabel}</span>
      {delta != null ? <span>+{fmtPts(delta)}</span> : null}
    </>
  );

  return (
    <div
      className="hub-wcc-ticket-back"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        className="hub-wcc-ticket"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="hub-wcc-ticket-poster">
          <div className="hub-wcc-ticket-poster-top">
            <div>
              <p className="hub-wcc-ticket-kicker">
                {WEEK_BOARD_COPY.callKicker(decision?.starter_slot)}
              </p>
              <h2 id={titleId}>{title}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="hub-wcc-ticket-close"
              aria-label={WEEK_BOARD_COPY.closeCall}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className="hub-wcc-ticket-faces">
            <CallFace player={starter} media={media} role={WEEK_BOARD_COPY.sitRole} />
            <div className="hub-wcc-ticket-delta">
              <strong>{delta != null ? `+${fmtPts(delta)}` : WEEK_BOARD_COPY.emptyFact}</strong>
              <span>{WEEK_BOARD_COPY.weekPts}</span>
            </div>
            <CallFace player={bench} media={media} role={WEEK_BOARD_COPY.startRole} going />
          </div>
        </div>
        <div className="hub-wcc-ticket-lanes">
          <FactLane player={starter} season={season} />
          <FactLane player={bench} season={season} />
        </div>
        <div className="hub-wcc-ticket-foot">
          <p className="hub-wcc-ticket-note">{callPpgNote(week)}</p>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            {keepLabel}
          </button>
          {sleeperHref ? (
            <a
              className="hub-wcc-ticket-start"
              {...callStartLinkProps({ href: sleeperHref, busy })}
              target="_blank"
              rel="noreferrer"
              title={callAction.reason}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {startBody}
            </a>
          ) : (
            <button
              type="button"
              className="hub-wcc-ticket-start"
              title={callAction.reason}
              disabled={locked || busy || !canApply}
              onClick={() => {
                if (canApply) onApply(decision);
              }}
            >
              {startBody}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
