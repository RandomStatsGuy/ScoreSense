import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { playerInitials, teamLogoUrl } from "./DraftHub/draftMedia";

const mediaCache = new Map();

export function usePlayerMedia(playerIds) {
  const key = useMemo(
    () => [...new Set((playerIds || []).filter(Boolean))].sort().join(","),
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
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const row = playerId && media ? media[playerId] : null;
  const teamAbbr = (row?.team || team || "").toUpperCase();
  const headshot = row?.headshot_url || null;
  const logo = row?.team_logo_url || teamLogoUrl(teamAbbr);

  return (
    <span className={`player-cell player-cell--${size} ${className}`.trim()}>
      <span className="player-cell-avatar" aria-hidden>
        {headshot && !imgFailed ? (
          <img
            className="player-cell-headshot"
            src={headshot}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : logo ? (
          <img className="player-cell-team-logo" src={logo} alt="" loading="lazy" />
        ) : (
          <span className="player-cell-initials">{playerInitials(name)}</span>
        )}
      </span>
      <span className="player-cell-text">
        <span className="player-cell-name">{name}</span>
        {showTeam && teamAbbr ? (
          <span className="player-cell-team">{teamAbbr}</span>
        ) : null}
      </span>
    </span>
  );
}
