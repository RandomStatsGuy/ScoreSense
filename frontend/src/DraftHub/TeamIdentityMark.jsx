import React from "react";
import IdentityCropMedia from "./IdentityCropMedia";
import { identityMediaUrl, initialsFromName, mergeTeamIdentity } from "./atmosphereCatalog";
import { hubTeamInitialsName, hubTeamLabel } from "./hubTeamLabel";

export default function TeamIdentityMark({
  team,
  identity,
  size = "md",
  showName = false,
  className = "",
}) {
  const look = mergeTeamIdentity(identity || team?.identity);
  const name = hubTeamLabel(team) || team?.name || "Team";
  const initialsName = hubTeamInitialsName(team) || team?.name || "Team";
  const photoUrl = identityMediaUrl(look, "photo");

  return (
    <span className={`hub-team-mark hub-team-mark--${size}${className ? ` ${className}` : ""}`}>
      <span
        className={`hub-team-mark-photo hub-team-photo--${look.photo_preset} hub-team-banner--${look.banner_preset}`}
      >
        {photoUrl ? (
          <IdentityCropMedia
            src={photoUrl}
            focus={look.photo_focus}
            className="hub-team-mark-img"
            alt={name}
          />
        ) : (
          <span className="hub-team-mark-initials" aria-hidden="true">{initialsFromName(initialsName)}</span>
        )}
      </span>
      {showName ? <span className="hub-team-mark-name">{name}</span> : null}
    </span>
  );
}
