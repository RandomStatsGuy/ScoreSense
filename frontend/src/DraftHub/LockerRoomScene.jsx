import React from "react";
import { lockerNameplate, mergeTeamIdentity } from "./atmosphereCatalog";

export default function LockerRoomScene({
  identity,
  roster = [],
  children,
  className = "",
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
    <div className={`hub-locker-room${className ? ` ${className}` : ""}`}>
      <div className="hub-locker-room-wall" aria-hidden="true">
        {slots.map((player, i) => (
          <div key={player?.player_id || `empty-${i}`} className="hub-locker">
            <span className="hub-locker-vent" />
            <span className="hub-locker-handle" />
            {player ? (
              <span className="hub-locker-nameplate">
                {lockerNameplate(player.player_name)}
              </span>
            ) : (
              <span className="hub-locker-nameplate hub-locker-nameplate--empty">—</span>
            )}
          </div>
        ))}
      </div>
      {children ? <div className="hub-locker-room-content">{children}</div> : null}
    </div>
  );
}
