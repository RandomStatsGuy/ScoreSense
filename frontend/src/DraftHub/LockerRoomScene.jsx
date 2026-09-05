import React from "react";
import { lockerNameplate, mergeTeamIdentity } from "./atmosphereCatalog";
import { nflTeamColors } from "./nflTeamColors";
import { fmtSal } from "./rosterFormat";
import { normalizeHubPosition } from "./hubPositions";
import { lockerWallPlayers } from "./lockerWall";

function JerseySvg({ colors, number, gradientId }) {
  const [c1, c2] = colors;
  return (
    <svg className="hub-locker-jersey" viewBox="0 0 120 96" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <path
        d="M60 2 q0 6 -7 8 l-1 2 h16 l-1 -2 q-7 -2 -7 -8"
        fill="none"
        stroke="rgba(238, 243, 251, 0.4)"
        strokeWidth="2.4"
      />
      <path
        d="M42 14 L52 10 Q60 16 68 10 L78 14 L98 26 L90 44 L82 38 L82 88 Q60 94 38 88 L38 38 L30 44 L22 26 Z"
        fill={`url(#${gradientId})`}
        stroke="rgba(0, 0, 0, 0.35)"
        strokeWidth="1.4"
      />
      <path d="M22 26 L30 44 L34 41 L26 24 Z" fill="rgba(255, 255, 255, 0.22)" />
      <path d="M98 26 L90 44 L86 41 L94 24 Z" fill="rgba(255, 255, 255, 0.22)" />
      <path d="M52 10 Q60 16 68 10 L66 14 Q60 19 54 14 Z" fill="rgba(0, 0, 0, 0.4)" />
      {number ? (
        <text
          x="60"
          y="60"
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize="30"
          fontWeight="800"
          fill="rgba(255, 255, 255, 0.92)"
          style={{ paintOrder: "stroke", stroke: "rgba(0, 0, 0, 0.35)", strokeWidth: "2px" }}
        >
          {number}
        </text>
      ) : null}
    </svg>
  );
}

function lockerStats(row) {
  const pos = normalizeHubPosition(row.position) || row.position || "";
  const yrs = Number(row.contract?.years_remaining ?? row.contract_years ?? 1);
  const salary = row.salary != null ? fmtSal(row.salary) : null;
  const pieces = [salary, `${yrs} yr${yrs === 1 ? "" : "s"}`].filter(Boolean);
  return { pos, line: pieces.join(" · ") };
}

/** Team-colored locker wall on My team. Lockers open the contract panel. */
export default function LockerRoomScene({
  identity,
  roster = [],
  mediaById = {},
  children,
  className = "",
  preview = false,
  wall = null,
  onSelectPlayer,
}) {
  const look = mergeTeamIdentity(identity);
  if (look.room_theme !== "locker") {
    return children || null;
  }

  const resolved = wall || lockerWallPlayers(roster, look.locker_player_ids);
  const lockers = resolved.players;

  return (
    <div
      className={`hub-locker-room${preview ? " hub-locker-room--preview" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="hub-locker-room-scene">
        <div className="hub-locker-room-wall" aria-hidden={preview ? "true" : undefined}>
          {lockers.map((player) => {
            const colors = nflTeamColors(player.team);
            const media = mediaById[player.player_id] || {};
            const stats = lockerStats(player);
            const name = lockerNameplate(player.player_name);
            const label = `${player.player_name} · ${stats.line}`;
            const inner = (
              <>
                <span
                  className="hub-locker-nameplate"
                  style={{ background: `linear-gradient(180deg, ${colors.plate}, ${colors.jersey[1]})` }}
                >
                  {name}
                </span>
                <span className="hub-locker-vent" />
                <div className="hub-locker-inner">
                  <span className="hub-locker-rail" />
                  <JerseySvg
                    colors={colors.jersey}
                    number={media.jersey_number}
                    gradientId={`locker-${player.player_id}`}
                  />
                  {media.headshot_url ? (
                    <img
                      className="hub-locker-headshot"
                      src={media.headshot_url}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : null}
                  <span className="hub-locker-pos">{stats.pos}</span>
                  <span className="hub-locker-stats">
                    <strong>
                      {name}
                      {media.jersey_number ? ` · #${media.jersey_number}` : ""}
                    </strong>
                    {stats.line}
                  </span>
                </div>
              </>
            );
            if (preview || !onSelectPlayer) {
              return (
                <div key={player.player_id} className="hub-locker">
                  {inner}
                </div>
              );
            }
            return (
              <button
                key={player.player_id}
                type="button"
                className="hub-locker"
                onClick={(event) => onSelectPlayer(player.player_id, event)}
                aria-label={`Contract for ${label}`}
              >
                {inner}
              </button>
            );
          })}
        </div>
        <div className="hub-locker-floor" aria-hidden="true">
          <span className="hub-locker-bench" />
        </div>
      </div>
      {children ? <div className="hub-locker-room-content">{children}</div> : null}
    </div>
  );
}
