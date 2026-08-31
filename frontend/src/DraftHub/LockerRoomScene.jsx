import React from "react";
import { lockerNameplate, mergeTeamIdentity } from "./atmosphereCatalog";
import { nflTeamColors } from "./nflTeamColors";
import { fmtSal } from "./rosterFormat";
import { normalizeHubPosition } from "./hubPositions";

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
      {/* hanger */}
      <path
        d="M60 2 q0 6 -7 8 l-1 2 h16 l-1 -2 q-7 -2 -7 -8"
        fill="none"
        stroke="rgba(238, 243, 251, 0.4)"
        strokeWidth="2.4"
      />
      {/* body */}
      <path
        d="M42 14 L52 10 Q60 16 68 10 L78 14 L98 26 L90 44 L82 38 L82 88 Q60 94 38 88 L38 38 L30 44 L22 26 Z"
        fill={`url(#${gradientId})`}
        stroke="rgba(0, 0, 0, 0.35)"
        strokeWidth="1.4"
      />
      {/* sleeve stripes */}
      <path d="M22 26 L30 44 L34 41 L26 24 Z" fill="rgba(255, 255, 255, 0.22)" />
      <path d="M98 26 L90 44 L86 41 L94 24 Z" fill="rgba(255, 255, 255, 0.22)" />
      {/* collar */}
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

/** Team-colored locker wall on My team. Lockers open on hover/focus to show
 *  the player's contract line. Purely decorative — roster truth stays in the
 *  contract table below. */
export default function LockerRoomScene({
  identity,
  roster = [],
  mediaById = {},
  children,
  className = "",
  preview = false,
}) {
  const look = mergeTeamIdentity(identity);
  if (look.room_theme !== "locker") {
    return children || null;
  }

  const byId = Object.fromEntries((roster || []).map((row) => [row.player_id, row]));
  const lockers = (look.locker_player_ids || [])
    .map((pid) => byId[pid])
    .filter((row) => row && String(row.roster_status || "active") === "active")
    .slice(0, 8);

  const slots = Array.from({ length: Math.max(6, lockers.length) }, (_, i) => lockers[i] || null);

  return (
    <div
      className={`hub-locker-room${preview ? " hub-locker-room--preview" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="hub-locker-room-scene">
        <div className="hub-locker-room-wall" aria-hidden={preview ? "true" : undefined}>
          {slots.map((player, i) => {
            if (!player) {
              return (
                <div key={`empty-${i}`} className="hub-locker hub-locker--empty">
                  <span className="hub-locker-nameplate hub-locker-nameplate--empty">—</span>
                  <span className="hub-locker-vent" />
                  <div className="hub-locker-inner">
                    <span className="hub-locker-rail" />
                  </div>
                </div>
              );
            }
            const colors = nflTeamColors(player.team);
            const media = mediaById[player.player_id] || {};
            const stats = lockerStats(player);
            return (
              <div key={player.player_id} className="hub-locker" tabIndex={preview ? -1 : 0}>
                <span
                  className="hub-locker-nameplate"
                  style={{ background: `linear-gradient(180deg, ${colors.plate}, ${colors.jersey[1]})` }}
                >
                  {lockerNameplate(player.player_name)}
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
                  <span className="hub-locker-stats" role="presentation">
                    <strong>
                      {lockerNameplate(player.player_name)}
                      {media.jersey_number ? ` · #${media.jersey_number}` : ""}
                    </strong>
                    {stats.line}
                  </span>
                </div>
              </div>
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
