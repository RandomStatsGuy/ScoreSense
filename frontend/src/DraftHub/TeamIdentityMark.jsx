import React from "react";
import HubMediaImg from "./HubMediaImg";
import { initialsFromName, mergeTeamIdentity } from "./atmosphereCatalog";
import { hubTeamLabel } from "./hubTeamLabel";

export default function TeamIdentityMark({
  team,
  identity,
  size = "md",
  showName = false,
  className = "",
}) {
  const look = mergeTeamIdentity(identity || team?.identity);
  const name = hubTeamLabel(team) || team?.name || "Team";
  const photoUrl = look.photo_url || (look.photo_media_id ? `/api/hub/media/${look.photo_media_id}` : null);

  return (
    <span className={`hub-team-mark hub-team-mark--${size}${className ? ` ${className}` : ""}`}>
      <span
        className={`hub-team-mark-photo hub-team-photo--${look.photo_preset} hub-team-banner--${look.banner_preset}`}
        aria-hidden="true"
      >
        {photoUrl ? (
          <HubMediaImg src={photoUrl} alt="" className="hub-team-mark-img" />
        ) : (
          <span className="hub-team-mark-initials">{initialsFromName(name)}</span>
        )}
      </span>
      {showName ? <span className="hub-team-mark-name">{name}</span> : null}
    </span>
  );
}
