import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { PAINT_WIDTH, headshotCandidates, lookupPlayerMedia, paintMediaUrl, playerInitials, teamLogoUrl } from "./DraftHub/draftMedia";
import { usePlayerCardOptional } from "./PlayerCardContext";

const mediaCache = new Map();

export function usePlayerMedia(playerIds) {
  const key = useMemo(
    () => [...new Set((playerIds || []).map((id) => String(id || "").trim()).filter(Boolean))].sort().join(","),
    [playerIds],
  );
  const [media, setMedia] = useState(() => {
    const out = {};
    for (const id of key.split(",").filter(Boolean)) {
      if (mediaCache.has(id)) out[id] = mediaCache.get(id);
    }
    return out;
  });

  useEffect(() => {
    const ids = key.split(",").filter(Boolean);
    if (!ids.length) return undefined;
    const missing = ids.filter((id) => !mediaCache.has(id));
    if (!missing.length) {
      const cached = {};
      ids.forEach((id) => {
        cached[id] = mediaCache.get(id);
      });
      setMedia(cached);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `/api/players/media?ids=${encodeURIComponent(missing.join(","))}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const batch = data.media || {};
        Object.entries(batch).forEach(([id, row]) => mediaCache.set(id, row));
        if (!cancelled) {
          const merged = {};
          ids.forEach((id) => {
            merged[id] = mediaCache.get(id) || batch[id] || null;
          });
          setMedia(merged);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return media;
}

export default function PlayerCell({
  name,
  team,
  playerId,
  media,
  size = "md",
  showTeam = true,
  className = "",
  clickable = false,
  position,
  season,
  week,
  applyInjuryAdjustments,
  narrativeScope = "weekly",
  onPlayerClick,
}) {
  const [shotIndex, setShotIndex] = useState(0);
  const playerCard = usePlayerCardOptional();
  const row = lookupPlayerMedia(media, playerId);
  const teamAbbr = (row?.team || team || "").toUpperCase();
  const paintWidth = size === "lg" ? PAINT_WIDTH.mark : PAINT_WIDTH.avatar;
  const shots = headshotCandidates(row, [], { width: paintWidth });
  const headshot = shots[shotIndex] || null;
  const logo = paintMediaUrl(row?.team_logo_url, paintWidth) || teamLogoUrl(teamAbbr, { width: paintWidth });

  useEffect(() => {
    setShotIndex(0);
  }, [playerId, row?.headshot_url, row?.espn_headshot_url]);

  const canOpen = Boolean(clickable && playerId && (onPlayerClick || playerCard));
  const handleOpen = (event) => {
    event?.stopPropagation?.();
    const payload = {
      playerId,
      name,
      team: teamAbbr || team,
      position,
      season,
      week,
      applyInjuryAdjustments,
      scope: narrativeScope,
    };
    if (onPlayerClick) onPlayerClick(payload);
    else playerCard?.openPlayerCard(payload);
  };

  const inner = (
    <>
      <span className="player-cell-avatar" aria-hidden>
        {headshot ? (
          <img
            className="player-cell-headshot"
            src={headshot}
            alt=""
            loading="lazy"
            onError={() => setShotIndex((index) => index + 1)}
          />
        ) : logo ? (
          <img className="player-cell-team-logo" src={logo} alt="" loading="lazy" />
        ) : (
          <span className="player-cell-initials">{playerInitials(name)}</span>
        )}
      </span>
      <span className="player-cell-text">
        <span className="player-cell-name">{name}</span>
        {position || (showTeam && teamAbbr) ? (
          <span className="player-cell-meta">
            {[position, teamAbbr].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
    </>
  );

  if (canOpen) {
    const onKeyDown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen(event);
      }
    };
    return (
      <span
        role="button"
        tabIndex={0}
        className={`player-cell player-cell--${size} player-cell--clickable ${className}`.trim()}
        onClick={handleOpen}
        onKeyDown={onKeyDown}
        aria-label={`Open ${name} details`}
      >
        {inner}
      </span>
    );
  }

  return (
    <span className={`player-cell player-cell--${size} ${className}`.trim()}>
      {inner}
    </span>
  );
}
